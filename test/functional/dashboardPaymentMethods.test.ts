import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { ensureUserSeeded, getOrCreatePaymentMethod, findPaymentMethodByName, setDefaultPaymentMethod } from "../../src/expenses/service";

const A = "551100070001";
const B = "551100070002";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl);
  } finally {
    await server.close();
  }
}

test("criar, renomear e excluir forma de pagamento pelo dashboard", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/payment-methods/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Cartao Teste" }),
    });
    const created = findPaymentMethodByName(A, "Cartao Teste")!;
    assert.ok(created);

    await fetch(`${baseUrl}/dashboard/payment-methods/${created.id}?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Cartao Renomeado" }),
    });
    assert.ok(findPaymentMethodByName(A, "Cartao Renomeado"));

    await fetch(`${baseUrl}/dashboard/payment-methods/${created.id}/delete?phone=${A}`, { method: "POST" });
    assert.equal(findPaymentMethodByName(A, "Cartao Renomeado"), null);
  });
});

test("a pagina marca visualmente qual e a forma de pagamento padrao", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    const method = getOrCreatePaymentMethod(A, "Padrao Visivel");
    setDefaultPaymentMethod(A, method.id);

    const res = await fetch(`${baseUrl}/dashboard/payment-methods?phone=${A}`);
    const html = await res.text();
    const idx = html.indexOf("Padrao Visivel");
    const snippet = html.slice(idx, idx + 400);
    assert.ok(snippet.includes("Padrão"));
  });
});

test("SEGURANCA: numero B nao consegue renomear nem excluir forma de pagamento de A", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    const method = getOrCreatePaymentMethod(A, "Protegida de A");

    await fetch(`${baseUrl}/dashboard/payment-methods/${method.id}?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Hackeada" }),
    });
    assert.ok(findPaymentMethodByName(A, "Protegida de A"));

    await fetch(`${baseUrl}/dashboard/payment-methods/${method.id}/delete?phone=${B}`, { method: "POST" });
    assert.ok(findPaymentMethodByName(A, "Protegida de A"));
  });
});
