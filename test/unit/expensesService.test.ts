import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureUserSeeded,
  listCategories,
  findCategoryByName,
  findCategoryByKeyword,
  findCategoryMentionedIn,
  getOrCreateCategory,
  renameCategory,
  deleteCategory,
  listPaymentMethods,
  getOrCreatePaymentMethod,
  deletePaymentMethod,
  getDefaultPaymentMethod,
  setDefaultPaymentMethod,
  learnKeyword,
  insertExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  findRecentExpense,
  updateExpenseCategory,
  addPendingCategorization,
  getNextPendingCategorization,
  clearPendingCategorization,
  getExpensesForMonth,
  getExpensesBetween,
  getCategoryTotalsForMonth,
  searchExpenses,
  getAllExpenses,
} from "../../src/expenses/service";

const A = "551100010001";
const B = "551100010002";

test("ensureUserSeeded cria as categorias e formas de pagamento padrao uma unica vez", () => {
  ensureUserSeeded(A);
  const firstRun = listCategories(A).length;
  ensureUserSeeded(A); // chamar de novo nao deve duplicar
  assert.equal(listCategories(A).length, firstRun);
  assert.ok(firstRun > 0);
  assert.ok(listPaymentMethods(A).length > 0);
});

test("categorias/formas de pagamento sao isoladas por numero: seed de A nao vaza pra B", () => {
  ensureUserSeeded(A);
  ensureUserSeeded(B);
  getOrCreateCategory(A, "Categoria só do A");
  const categoriesA = listCategories(A).map((c) => c.name);
  const categoriesB = listCategories(B).map((c) => c.name);
  assert.ok(categoriesA.includes("Categoria só do A"));
  assert.ok(!categoriesB.includes("Categoria só do A"));
});

test("findCategoryByName ignora acento/maiuscula e nao encontra categoria de outro numero", () => {
  ensureUserSeeded(A);
  assert.ok(findCategoryByName(A, "mercado"));
  assert.ok(findCategoryByName(A, "MERCADO"));
  const onlyInA = getOrCreateCategory(A, "ExclusivaDoA");
  assert.equal(findCategoryByName(B, "ExclusivaDoA"), null);
});

test("getOrCreateCategory reaproveita categoria existente em vez de duplicar", () => {
  const first = getOrCreateCategory(A, "Pets");
  const second = getOrCreateCategory(A, "pets");
  assert.equal(first.id, second.id);
});

test("renameCategory e deleteCategory respeitam o dono (nao mexem em categoria de outro numero)", () => {
  const catA = getOrCreateCategory(A, "SoDoA-rename");
  assert.equal(renameCategory(B, catA.id, "Hackeado"), false);
  assert.equal(findCategoryByName(A, "SoDoA-rename")?.id, catA.id);

  assert.equal(deleteCategory(B, catA.id), false);
  assert.ok(findCategoryByName(A, "SoDoA-rename"));
});

test("deleteCategory desfaz o vinculo em vez de deixar o gasto orfao quebrado", () => {
  const cat = getOrCreateCategory(A, "Temporaria");
  const payment = getOrCreatePaymentMethod(A, "Pix");
  insertExpense({ fromNumber: A, amount: 10, description: "teste", categoryId: cat.id, paymentMethodId: payment.id, date: "2026-01-01" });
  const expense = findRecentExpense(A, "teste")!;

  deleteCategory(A, cat.id);

  const reloaded = getExpenseById(A, expense.id)!;
  assert.equal(reloaded.category_id, null);
});

test("deletePaymentMethod desliga o padrao do usuario se era essa a forma excluida", () => {
  const method = getOrCreatePaymentMethod(A, "CartaoTeste");
  setDefaultPaymentMethod(A, method.id);
  assert.equal(getDefaultPaymentMethod(A)?.id, method.id);

  deletePaymentMethod(A, method.id);
  assert.equal(getDefaultPaymentMethod(A), null);
});

test("findCategoryByKeyword e learnKeyword sao isolados por numero", () => {
  const catA = getOrCreateCategory(A, "Pet-keyword");
  learnKeyword(A, "racao", catA.id);
  assert.equal(findCategoryByKeyword(A, "comprei uma racao pro cachorro")?.id, catA.id);
  // B nunca aprendeu essa palavra-chave, mesmo que tenha uma categoria com nome parecido
  ensureUserSeeded(B);
  assert.equal(findCategoryByKeyword(B, "comprei uma racao pro cachorro"), null);
});

test("findCategoryMentionedIn so decide quando exatamente 1 categoria bate", () => {
  ensureUserSeeded(A);
  const onlyMatch = findCategoryMentionedIn(A, "acho que e mercado mesmo");
  assert.equal(onlyMatch?.name, "Mercado");
});

test("insertExpense/getExpenseById/updateExpense/deleteExpense fazem o ciclo completo", () => {
  const cat = getOrCreateCategory(A, "CicloCompleto");
  insertExpense({ fromNumber: A, amount: 50, description: "gasto ciclo", categoryId: cat.id, paymentMethodId: null, date: "2026-02-01" });
  const created = findRecentExpense(A, "gasto ciclo")!;
  assert.equal(created.amount, 50);

  updateExpense(A, created.id, { amount: 75, description: "gasto editado", date: "2026-02-02", categoryId: cat.id, paymentMethodId: null });
  const updated = getExpenseById(A, created.id)!;
  assert.equal(updated.amount, 75);
  assert.equal(updated.description, "gasto editado");
  assert.equal(updated.date, "2026-02-02");

  assert.equal(deleteExpense(A, created.id), true);
  assert.equal(getExpenseById(A, created.id), null);
});

test("updateExpense/deleteExpense/getExpenseById nunca alcancam gasto de outro numero", () => {
  insertExpense({ fromNumber: A, amount: 33, description: "so do A", categoryId: null, paymentMethodId: null, date: "2026-02-03" });
  const expense = findRecentExpense(A, "so do A")!;

  assert.equal(getExpenseById(B, expense.id), null);
  assert.equal(deleteExpense(B, expense.id), false);
  assert.equal(updateExpense(B, expense.id, { amount: 999, description: "hack", date: "2026-01-01", categoryId: null, paymentMethodId: null }), false);

  // continua intacto pro dono de verdade
  const stillA = getExpenseById(A, expense.id)!;
  assert.equal(stillA.amount, 33);
});

test("findRecentExpense: sem query pega o mais recente; com query, busca por descricao (so nesse numero)", () => {
  insertExpense({ fromNumber: A, amount: 1, description: "zzz-antigo", categoryId: null, paymentMethodId: null, date: "2026-03-01" });
  insertExpense({ fromNumber: A, amount: 2, description: "zzz-recente", categoryId: null, paymentMethodId: null, date: "2026-03-02" });
  assert.equal(findRecentExpense(A)?.description, "zzz-recente");
  assert.equal(findRecentExpense(A, "zzz-antigo")?.description, "zzz-antigo");
  assert.equal(findRecentExpense(B, "zzz-antigo"), null);
});

test("updateExpenseCategory troca so a categoria, mantendo o resto", () => {
  const cat1 = getOrCreateCategory(A, "CatOriginal");
  const cat2 = getOrCreateCategory(A, "CatNova");
  insertExpense({ fromNumber: A, amount: 44, description: "corrige categoria", categoryId: cat1.id, paymentMethodId: null, date: "2026-03-05" });
  const expense = findRecentExpense(A, "corrige categoria")!;
  updateExpenseCategory(expense.id, cat2.id);
  assert.equal(getExpenseById(A, expense.id)!.category_id, cat2.id);
});

test("fila de categorizacao pendente resolve na ordem certa (mais antigo primeiro) e e isolada por numero", () => {
  addPendingCategorization({ from_number: A, amount: 10, description: "p1", date: "2026-04-01", suggested_category: null, suggested_payment_method: null });
  addPendingCategorization({ from_number: A, amount: 20, description: "p2", date: "2026-04-02", suggested_category: null, suggested_payment_method: null });
  addPendingCategorization({ from_number: B, amount: 999, description: "de outro numero", date: "2026-04-01", suggested_category: null, suggested_payment_method: null });

  const first = getNextPendingCategorization(A)!;
  assert.equal(first.description, "p1");
  clearPendingCategorization(first.id);

  const second = getNextPendingCategorization(A)!;
  assert.equal(second.description, "p2");
  clearPendingCategorization(second.id);

  assert.equal(getNextPendingCategorization(A), null);
  assert.equal(getNextPendingCategorization(B)?.description, "de outro numero");
});

test("getExpensesForMonth / getExpensesBetween / getCategoryTotalsForMonth so trazem gastos do numero pedido", () => {
  const cat = getOrCreateCategory(A, "Mes-teste");
  insertExpense({ fromNumber: A, amount: 100, description: "mes-A-1", categoryId: cat.id, paymentMethodId: null, date: "2026-05-10" });
  insertExpense({ fromNumber: A, amount: 50, description: "mes-A-2", categoryId: cat.id, paymentMethodId: null, date: "2026-05-15" });
  insertExpense({ fromNumber: B, amount: 9999, description: "mes-B", categoryId: null, paymentMethodId: null, date: "2026-05-10" });

  const monthA = getExpensesForMonth(A, "2026-05");
  assert.equal(monthA.filter((e) => e.description.startsWith("mes-A")).length, 2);
  assert.ok(!monthA.some((e) => e.description === "mes-B"));

  const between = getExpensesBetween(A, "2026-05-01", "2026-05-31");
  assert.equal(between.filter((e) => e.description.startsWith("mes-A")).length, 2);

  const totals = getCategoryTotalsForMonth(A, "2026-05");
  const catTotal = totals.find((t) => t.name === "Mes-teste");
  assert.equal(catTotal?.total, 150);
});

test("searchExpenses busca por descricao em qualquer mes, ignorando maiuscula, e isolado por numero", () => {
  const cat = getOrCreateCategory(A, "Busca-teste");
  insertExpense({ fromNumber: A, amount: 30, description: "Farmácia São João", categoryId: cat.id, paymentMethodId: null, date: "2025-01-10" });
  insertExpense({ fromNumber: A, amount: 40, description: "farmacia popular", categoryId: cat.id, paymentMethodId: null, date: "2026-06-20" });
  insertExpense({ fromNumber: A, amount: 999, description: "mercado", categoryId: cat.id, paymentMethodId: null, date: "2026-06-21" });
  insertExpense({ fromNumber: B, amount: 999, description: "farmacia do B", categoryId: null, paymentMethodId: null, date: "2026-06-21" });

  const results = searchExpenses(A, "FARMACIA");
  assert.equal(results.length, 2); // acha nos dois meses diferentes (2025 e 2026)
  assert.ok(results.some((e) => e.description === "farmacia popular"));
  assert.ok(!results.some((e) => e.description === "mercado"));
  assert.ok(!results.some((e) => e.description === "farmacia do B")); // isolado por numero
});

test("getAllExpenses traz todo o historico (sem limite de mes), isolado por numero", () => {
  const F = "551100010099";
  const G = "551100010098";
  const cat = getOrCreateCategory(F, "Export-teste");
  insertExpense({ fromNumber: F, amount: 10, description: "ano passado", categoryId: cat.id, paymentMethodId: null, date: "2024-01-01" });
  insertExpense({ fromNumber: F, amount: 20, description: "esse ano", categoryId: cat.id, paymentMethodId: null, date: "2026-06-01" });
  insertExpense({ fromNumber: G, amount: 999, description: "de outro numero", categoryId: null, paymentMethodId: null, date: "2026-06-01" });

  const all = getAllExpenses(F);
  assert.equal(all.length, 2);
  assert.ok(!all.some((e) => e.description === "de outro numero"));
});
