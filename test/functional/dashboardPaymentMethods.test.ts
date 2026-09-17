import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import {
  ensureUserSeeded,
  getOrCreatePaymentMethod,
  findPaymentMethodByName,
  setDefaultPaymentMethod,
  getDefaultPaymentMethod,
} from "../../src/expenses/service";

const A = "551100070001";
const B = "551100070002";

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

test("criar, renomear e excluir forma de pagamento pelo dashboard", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/payment-methods/new`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ name: "Cartao Teste" }),
    });
    const created = findPaymentMethodByName(A, "Cartao Teste")!;
    assert.ok(created);

    await fetch(`${baseUrl}/dashboard/payment-methods/${created.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) },
      body: new URLSearchParams({ name: "Cartao Renomeado" }),
    });
    assert.ok(findPaymentMethodByName(A, "Cartao Renomeado"));

    await fetch(`${baseUrl}/dashboard/payment-methods/${created.id}/delete`, { method: "POST", headers: authHeaders(A) });
    assert.equal(findPaymentMethodByName(A, "Cartao Renomeado"), null);
  });
});

test("a pagina marca visualmente qual e a forma de pagamento padrao", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    const method = getOrCreatePaymentMethod(A, "Padrao Visivel");
    setDefaultPaymentMethod(A, method.id);

    const res = await fetch(`${baseUrl}/dashboard/payment-methods`, { headers: authHeaders(A) });
    const html = await res.text();
    const idx = html.indexOf("Padrao Visivel");
    const snippet = html.slice(idx, idx + 400);
    assert.ok(snippet.includes("Padrão"));
  });
});

// Pedido explicito do usuario: o dashboard tambem precisa de um jeito de
// escolher/trocar a forma de pagamento padrao (nao so por mensagem no
// WhatsApp, ver "Tornar padrão" em src/dashboard/paymentMethods.ts).
test("botao 'Tornar padrão' troca a forma de pagamento padrao pelo dashboard", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    const antiga = getOrCreatePaymentMethod(A, "Antiga Padrao");
    const nova = getOrCreatePaymentMethod(A, "Nova Padrao");
    setDefaultPaymentMethod(A, antiga.id);
    assert.equal(getDefaultPaymentMethod(A)?.id, antiga.id);

    await fetch(`${baseUrl}/dashboard/payment-methods/${nova.id}/set-default`, { method: "POST", headers: authHeaders(A) });
    assert.equal(getDefaultPaymentMethod(A)?.id, nova.id);

    const html = await (await fetch(`${baseUrl}/dashboard/payment-methods`, { headers: authHeaders(A) })).text();
    const idxNova = html.indexOf("Nova Padrao");
    assert.ok(html.slice(idxNova, idxNova + 400).includes("Padrão")); // a nova aparece marcada
    const idxAntiga = html.indexOf("Antiga Padrao");
    assert.ok(html.slice(idxAntiga, idxAntiga + 600).includes("Tornar padrão")); // a antiga volta a mostrar o botao
  });
});

test("SEGURANCA: numero B nao consegue marcar como padrao uma forma de pagamento de A", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    const method = getOrCreatePaymentMethod(A, "Protegida de A pra padrao");

    await fetch(`${baseUrl}/dashboard/payment-methods/${method.id}/set-default`, { method: "POST", headers: authHeaders(B) });
    assert.equal(getDefaultPaymentMethod(B), null); // nao adotou uma forma que nao e dela
    assert.notEqual(getDefaultPaymentMethod(A)?.id, method.id); // e nao mudou nada em A tambem
  });
});

test("SEGURANCA: numero B nao consegue renomear nem excluir forma de pagamento de A", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    const method = getOrCreatePaymentMethod(A, "Protegida de A");

    await fetch(`${baseUrl}/dashboard/payment-methods/${method.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(B) },
      body: new URLSearchParams({ name: "Hackeada" }),
    });
    assert.ok(findPaymentMethodByName(A, "Protegida de A"));

    await fetch(`${baseUrl}/dashboard/payment-methods/${method.id}/delete`, { method: "POST", headers: authHeaders(B) });
    assert.ok(findPaymentMethodByName(A, "Protegida de A"));
  });
});
