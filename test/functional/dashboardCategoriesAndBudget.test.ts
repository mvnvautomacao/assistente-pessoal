import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { ensureUserSeeded, getOrCreateCategory, findCategoryByName } from "../../src/expenses/service";
import { getBudget } from "../../src/expenses/budgets";

const A = "551100060001";
const B = "551100060002";

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl);
  } finally {
    await server.close();
  }
}

test("criar, renomear e excluir categoria pelo dashboard", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    await fetch(`${baseUrl}/dashboard/categories/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Categoria Nova" }),
    });
    const created = findCategoryByName(A, "Categoria Nova")!;
    assert.ok(created);

    await fetch(`${baseUrl}/dashboard/categories/${created.id}?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Categoria Renomeada" }),
    });
    assert.ok(findCategoryByName(A, "Categoria Renomeada"));
    assert.equal(findCategoryByName(A, "Categoria Nova"), null);

    await fetch(`${baseUrl}/dashboard/categories/${created.id}/delete?phone=${A}`, { method: "POST" });
    assert.equal(findCategoryByName(A, "Categoria Renomeada"), null);
  });
});

test("definir orcamento mensal pela tela de categorias, com virgula decimal", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    const cat = getOrCreateCategory(A, "Categoria com orcamento");

    await fetch(`${baseUrl}/dashboard/categories/${cat.id}/budget?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ monthly_limit: "250,50" }),
    });
    assert.equal(getBudget(A, cat.id), 250.5);
  });
});

test("deixar o campo de orcamento em branco remove o limite", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    const cat = getOrCreateCategory(A, "Categoria remove orcamento");
    await fetch(`${baseUrl}/dashboard/categories/${cat.id}/budget?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ monthly_limit: "100" }),
    });
    assert.equal(getBudget(A, cat.id), 100);

    await fetch(`${baseUrl}/dashboard/categories/${cat.id}/budget?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ monthly_limit: "" }),
    });
    assert.equal(getBudget(A, cat.id), null);
  });
});

test("SEGURANCA: numero B nao consegue renomear, excluir nem definir orcamento pra categoria de A", async () => {
  await withServer(async (baseUrl) => {
    ensureUserSeeded(A);
    ensureUserSeeded(B);
    const cat = getOrCreateCategory(A, "Categoria protegida");

    await fetch(`${baseUrl}/dashboard/categories/${cat.id}?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Hackeado" }),
    });
    assert.ok(findCategoryByName(A, "Categoria protegida"));
    assert.equal(findCategoryByName(A, "Hackeado"), null);

    await fetch(`${baseUrl}/dashboard/categories/${cat.id}/budget?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ monthly_limit: "1" }),
    });
    assert.equal(getBudget(A, cat.id), null); // B nao conseguiu setar orcamento nela

    await fetch(`${baseUrl}/dashboard/categories/${cat.id}/delete?phone=${B}`, { method: "POST" });
    assert.ok(findCategoryByName(A, "Categoria protegida")); // continua existindo
  });
});
