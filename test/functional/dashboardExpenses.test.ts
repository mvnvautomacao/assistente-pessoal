import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { ensureUserSeeded, findRecentExpense, getExpenseById, getOrCreatePaymentMethod, insertExpense } from "../../src/expenses/service";
import { insertIncome } from "../../src/incomes/service";
import { spDateString } from "../../src/timeSP";

const A = "551100050001";
const B = "551100050002";

async function withServer(
  fn: (baseUrl: string, authHeaders: (phone: string) => Record<string, string>) => Promise<void>
) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl, server.authHeaders);
  } finally {
    await server.close();
  }
}

test("dashboard sem sessao mostra a tela de login, nao os dados", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    assert.ok(html.includes("Entre com o número de WhatsApp"));
  });
});

test("criar gasto novo sem data usa hoje; com data (mesmo retroativa) usa a informada", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "50.00", description: "sem data especificada" }),
    });
    const today = spDateString();
    const created = findRecentExpense(A, "sem data especificada")!;
    assert.equal(created.date, today);

    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "30.00", description: "retroativa", date: "2020-05-10" }),
    });
    const retro = findRecentExpense(A, "retroativa")!;
    assert.equal(retro.date, "2020-05-10");
  });
});

test("editar gasto via dashboard atualiza valor/data/descricao", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "10.00", description: "vai ser editado" }),
    });
    const created = findRecentExpense(A, "vai ser editado")!;

    await fetch(`${baseUrl}/dashboard/expenses/${created.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "99.90", description: "editado com sucesso", date: "2026-01-15" }),
    });

    const updated = getExpenseById(A, created.id)!;
    assert.equal(updated.amount, 99.9);
    assert.equal(updated.description, "editado com sucesso");
    assert.equal(updated.date, "2026-01-15");
  });
});

test("excluir gasto via dashboard remove do banco", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "5.00", description: "vai ser excluido" }),
    });
    const created = findRecentExpense(A, "vai ser excluido")!;

    await fetch(`${baseUrl}/dashboard/expenses/${created.id}/delete`, { method: "POST", headers: authHeaders(A) });
    assert.equal(getExpenseById(A, created.id), null);
  });
});

test("SEGURANCA: numero B nao consegue editar nem excluir gasto do numero A logando como B", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "77.00", description: "protegido de A" }),
    });
    const target = findRecentExpense(A, "protegido de A")!;

    // B loga com a PROPRIA sessao (nao da mais pra so trocar um ?phone= na URL)
    // e tenta editar o gasto de A
    await fetch(`${baseUrl}/dashboard/expenses/${target.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(B) },
      body: new URLSearchParams({ amount: "1.00", description: "hackeado", date: "2020-01-01" }),
    });
    assert.equal(getExpenseById(A, target.id)!.amount, 77);

    // B tenta excluir o gasto de A
    await fetch(`${baseUrl}/dashboard/expenses/${target.id}/delete`, { method: "POST", headers: authHeaders(B) });
    assert.ok(getExpenseById(A, target.id));
  });
});

test("SEGURANCA: descricao com HTML/script e escapada na listagem (sem XSS)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    const malicious = `<script>alert('xss')</script>`;
    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ amount: "1.00", description: malicious }),
    });

    const res = await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(A) });
    const html = await res.text();
    assert.ok(!html.includes(malicious), "a tag <script> nao pode aparecer crua no HTML");
    assert.ok(html.includes("&lt;script&gt;"), "deve aparecer escapada");
  });
});

test("normaliza o numero com o 9 extra: acessar com o formato completo acha os mesmos dados", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    // "internal" e o formato salvo no banco (igual ao JID do WhatsApp, sem o 9
    // extra); "typed" e como uma pessoa digitaria o proprio numero normalmente.
    const internal = "551190005007";
    const typed = "551190005007";
    ensureUserSeeded(internal);

    await fetch(`${baseUrl}/dashboard/expenses/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(internal) },
      body: new URLSearchParams({ amount: "22.00", description: "achavel pelos dois formatos" }),
    });

    const res = await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(typed) });
    const html = await res.text();
    assert.ok(html.includes("achavel pelos dois formatos"));
  });
});

// Achado da auditoria: dava pra buscar so por texto, sem filtrar por faixa de
// valor. Confirma que a rota GET aceita min/max (sozinhos ou combinados com q).
test("busca no dashboard filtra por faixa de valor (min/max)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const C = "551100050099";
    ensureUserSeeded(C);
    for (const [desc, amount] of [
      ["filtro barato", "10.00"],
      ["filtro medio", "50.00"],
      ["filtro caro", "500.00"],
    ] as const) {
      await fetch(`${baseUrl}/dashboard/expenses/new`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(C) },
        body: new URLSearchParams({ amount, description: desc }),
      });
    }

    const soAcimaDe100 = await (await fetch(`${baseUrl}/dashboard?min=100`, { headers: authHeaders(C) })).text();
    assert.ok(soAcimaDe100.includes("filtro caro"));
    assert.ok(!soAcimaDe100.includes("filtro barato"));
    assert.ok(!soAcimaDe100.includes("filtro medio"));

    const faixa = await (await fetch(`${baseUrl}/dashboard?min=20&max=100`, { headers: authHeaders(C) })).text();
    assert.ok(faixa.includes("filtro medio"));
    assert.ok(!faixa.includes("filtro barato"));
    assert.ok(!faixa.includes("filtro caro"));
  });
});

// Pedido do usuario: entradas precisam aparecer no painel inicial, abatendo os
// gastos de Pix/dinheiro; cartao so abate do limite (opcional -- sem limite,
// nada e exibido).
test("painel inicial: mostra entradas e saldo (Pix/dinheiro), e limite do cartao SO quando informado", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const S = "551100050201";
    ensureUserSeeded(S);
    const pix = getOrCreatePaymentMethod(S, "Pix");
    const card = getOrCreatePaymentMethod(S, "Cartão de crédito");
    const hoje = spDateString();
    insertIncome({ fromNumber: S, amount: 3000, description: "salario painel", date: hoje });
    insertExpense({ fromNumber: S, amount: 200, description: "gasto pix painel", categoryId: null, paymentMethodId: pix.id, date: hoje });
    insertExpense({ fromNumber: S, amount: 700, description: "gasto cartao painel", categoryId: null, paymentMethodId: card.id, date: hoje });

    let html = await (await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(S) })).text();
    assert.ok(html.includes("Entradas do mês"));
    assert.ok(html.includes("Saldo (entradas"));
    assert.ok(html.includes("2.800,00")); // 3000 - 200 (o cartao NAO abate)
    assert.ok(!html.includes("Limite disponível")); // sem limite informado, nada

    await fetch(`${baseUrl}/dashboard/payment-methods/${card.id}/limit`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(S) },
      body: new URLSearchParams({ limit: "2000" }),
    });
    html = await (await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(S) })).text();
    assert.ok(html.includes("Limite disponível — Cartão de crédito"));
    assert.ok(html.includes("1.300,00")); // 2000 - 700
    assert.ok(html.includes("2.800,00")); // saldo inalterado

    // campo vazio remove o limite
    await fetch(`${baseUrl}/dashboard/payment-methods/${card.id}/limit`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(S) },
      body: new URLSearchParams({ limit: "" }),
    });
    html = await (await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(S) })).text();
    assert.ok(!html.includes("Limite disponível"));
  });
});

test("painel inicial: sem nenhuma entrada no mes, nao mostra card de saldo", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const S2 = "551100050202";
    ensureUserSeeded(S2);
    const pix = getOrCreatePaymentMethod(S2, "Pix");
    insertExpense({ fromNumber: S2, amount: 10, description: "sem entrada", categoryId: null, paymentMethodId: pix.id, date: spDateString() });
    const html = await (await fetch(`${baseUrl}/dashboard`, { headers: authHeaders(S2) })).text();
    assert.ok(!html.includes("Entradas do mês"));
  });
});
