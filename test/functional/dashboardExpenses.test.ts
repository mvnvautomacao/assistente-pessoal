import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { ensureUserSeeded, findRecentExpense, getExpenseById } from "../../src/expenses/service";
import { spDateString } from "../../src/timeSP";

const A = "551100050001";
const B = "551100050002";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl);
  } finally {
    await server.close();
  }
}

test("dashboard sem ?phone mostra o portao de acesso, nao os dados", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    assert.ok(html.includes("Digite o número de WhatsApp"));
  });
});

test("criar gasto novo sem data usa hoje; com data (mesmo retroativa) usa a informada", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "50.00", description: "sem data especificada" }),
    });
    const today = spDateString();
    const created = findRecentExpense(A, "sem data especificada")!;
    assert.equal(created.date, today);

    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "30.00", description: "retroativa", date: "2020-05-10" }),
    });
    const retro = findRecentExpense(A, "retroativa")!;
    assert.equal(retro.date, "2020-05-10");
  });
});

test("editar gasto via dashboard atualiza valor/data/descricao", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "10.00", description: "vai ser editado" }),
    });
    const created = findRecentExpense(A, "vai ser editado")!;

    await fetch(`${baseUrl}/dashboard/expenses/${created.id}?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "99.90", description: "editado com sucesso", date: "2026-01-15" }),
    });

    const updated = getExpenseById(A, created.id)!;
    assert.equal(updated.amount, 99.9);
    assert.equal(updated.description, "editado com sucesso");
    assert.equal(updated.date, "2026-01-15");
  });
});

test("excluir gasto via dashboard remove do banco", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "5.00", description: "vai ser excluido" }),
    });
    const created = findRecentExpense(A, "vai ser excluido")!;

    await fetch(`${baseUrl}/dashboard/expenses/${created.id}/delete?phone=${A}`, { method: "POST" });
    assert.equal(getExpenseById(A, created.id), null);
  });
});

test("SEGURANCA: numero B nao consegue editar nem excluir gasto do numero A pela URL", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "77.00", description: "protegido de A" }),
    });
    const target = findRecentExpense(A, "protegido de A")!;

    // B tenta editar o gasto de A so trocando o ?phone= na URL
    await fetch(`${baseUrl}/dashboard/expenses/${target.id}?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "1.00", description: "hackeado", date: "2020-01-01" }),
    });
    assert.equal(getExpenseById(A, target.id)!.amount, 77);

    // B tenta excluir o gasto de A
    await fetch(`${baseUrl}/dashboard/expenses/${target.id}/delete?phone=${B}`, { method: "POST" });
    assert.ok(getExpenseById(A, target.id));
  });
});

test("SEGURANCA: descricao com HTML/script e escapada na listagem (sem XSS)", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    const malicious = `<script>alert('xss')</script>`;
    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "1.00", description: malicious }),
    });

    const res = await fetch(`${baseUrl}/dashboard?phone=${A}`);
    const html = await res.text();
    assert.ok(!html.includes(malicious), "a tag <script> nao pode aparecer crua no HTML");
    assert.ok(html.includes("&lt;script&gt;"), "deve aparecer escapada");
  });
});

test("normaliza o numero com o 9 extra: acessar com o formato completo acha os mesmos dados", async () => {
  await withServer(async (baseUrl) => {
    // "internal" e o formato salvo no banco (igual ao JID do WhatsApp, sem o 9
    // extra); "typed" e como uma pessoa digitaria o proprio numero normalmente.
    const internal = "551190005007";
    const typed = "551190005007";
    ensureUserSeeded(internal);

    await fetch(`${baseUrl}/dashboard/expenses/new?phone=${internal}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "22.00", description: "achavel pelos dois formatos" }),
    });

    const res = await fetch(`${baseUrl}/dashboard?phone=${typed}`);
    const html = await res.text();
    assert.ok(html.includes("achavel pelos dois formatos"));
  });
});
