import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateCategory, insertExpense } from "../../src/expenses/service";
import { setBudget, removeBudget, getBudget, listBudgets, checkBudgetAlert } from "../../src/expenses/budgets";
import { currentMonthRange } from "../../src/expenses/reportText";

const A = "551100020001";
const B = "551100020002";

test("setBudget cria e, se chamado de novo pra mesma categoria, atualiza (upsert) em vez de duplicar", () => {
  const cat = getOrCreateCategory(A, "Orcamento-upsert");
  setBudget(A, cat.id, 300);
  assert.equal(getBudget(A, cat.id), 300);
  setBudget(A, cat.id, 500);
  assert.equal(getBudget(A, cat.id), 500);
  assert.equal(listBudgets(A).filter((b) => b.category_id === cat.id).length, 1);
});

test("removeBudget apaga o limite; getBudget de categoria sem orcamento e null", () => {
  const cat = getOrCreateCategory(A, "Orcamento-remove");
  setBudget(A, cat.id, 100);
  assert.equal(removeBudget(A, cat.id), true);
  assert.equal(getBudget(A, cat.id), null);
  // remover de novo (ja removido) nao da erro, so retorna false
  assert.equal(removeBudget(A, cat.id), false);
});

test("orcamento e isolado por numero: B nao ve nem edita orcamento de A", () => {
  const catA = getOrCreateCategory(A, "Orcamento-isolado");
  setBudget(A, catA.id, 200);
  assert.equal(getBudget(B, catA.id), null);
  assert.equal(removeBudget(B, catA.id), false);
  assert.equal(getBudget(A, catA.id), 200); // continua intacto
});

test("checkBudgetAlert: sem orcamento definido, retorna null", () => {
  const cat = getOrCreateCategory(A, "SemOrcamento");
  assert.equal(checkBudgetAlert(A, cat.id, cat.name), null);
});

test("checkBudgetAlert: abaixo de 80%, nao alerta", () => {
  const cat = getOrCreateCategory(A, "Alerta-baixo");
  setBudget(A, cat.id, 1000);
  const { start } = currentMonthRange();
  insertExpense({ fromNumber: A, amount: 100, description: "gasto pequeno", categoryId: cat.id, paymentMethodId: null, date: start });
  assert.equal(checkBudgetAlert(A, cat.id, cat.name), null);
});

test("checkBudgetAlert: entre 80% e 100%, avisa mas sem tom de 'estourou'", () => {
  const cat = getOrCreateCategory(A, "Alerta-80");
  setBudget(A, cat.id, 100);
  const { start } = currentMonthRange();
  insertExpense({ fromNumber: A, amount: 85, description: "quase no limite", categoryId: cat.id, paymentMethodId: null, date: start });
  const alert = checkBudgetAlert(A, cat.id, cat.name);
  assert.ok(alert?.includes("⚠️"));
  assert.ok(!alert?.includes("🚨"));
});

test("checkBudgetAlert: passou de 100%, alerta de estouro", () => {
  const cat = getOrCreateCategory(A, "Alerta-estourou");
  setBudget(A, cat.id, 100);
  const { start } = currentMonthRange();
  insertExpense({ fromNumber: A, amount: 150, description: "estourou", categoryId: cat.id, paymentMethodId: null, date: start });
  const alert = checkBudgetAlert(A, cat.id, cat.name);
  assert.ok(alert?.includes("🚨"));
});

test("checkBudgetAlert so soma gastos do mes atual, nao conta gasto de mes passado", () => {
  const cat = getOrCreateCategory(A, "Alerta-mes-passado");
  setBudget(A, cat.id, 100);
  insertExpense({ fromNumber: A, amount: 500, description: "gasto antigo", categoryId: cat.id, paymentMethodId: null, date: "2020-01-01" });
  assert.equal(checkBudgetAlert(A, cat.id, cat.name), null);
});
