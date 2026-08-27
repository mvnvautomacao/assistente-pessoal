import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRecurringExpense,
  getRecurringExpenseById,
  listRecurringExpenses,
  deactivateRecurringExpense,
  findActiveRecurringExpenseByDescription,
  markRecurringExpenseRunForMonth,
  getDueRecurringExpenses,
} from "../../src/expenses/recurring";

const A = "551100050001";
const B = "551100050002";

test("createRecurringExpense + listRecurringExpenses: isolado por numero", () => {
  createRecurringExpense({ fromNumber: A, description: "internet do A", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 10 });
  createRecurringExpense({ fromNumber: B, description: "internet do B", amount: 150, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });

  const listA = listRecurringExpenses(A);
  assert.ok(listA.some((r) => r.description === "internet do A"));
  assert.ok(!listA.some((r) => r.description === "internet do B"));
});

test("deactivateRecurringExpense respeita o dono e tira da listagem", () => {
  const created = createRecurringExpense({ fromNumber: A, description: "academia desativar", amount: 89.9, categoryId: null, paymentMethodId: null, dayOfMonth: 15 });

  assert.equal(deactivateRecurringExpense(B, created.id), false); // B nao consegue desativar gasto fixo de A
  assert.ok(listRecurringExpenses(A).some((r) => r.id === created.id));

  assert.equal(deactivateRecurringExpense(A, created.id), true);
  assert.ok(!listRecurringExpenses(A).some((r) => r.id === created.id));
});

test("findActiveRecurringExpenseByDescription busca por trecho do texto, ignorando desativados", () => {
  createRecurringExpense({ fromNumber: A, description: "assinatura streaming XYZ", amount: 39.9, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  const found = findActiveRecurringExpenseByDescription(A, "streaming");
  assert.equal(found?.description, "assinatura streaming XYZ");

  const created = getRecurringExpenseById(A, found!.id)!;
  deactivateRecurringExpense(A, created.id);
  assert.equal(findActiveRecurringExpenseByDescription(A, "streaming XYZ"), null);
});

test("getDueRecurringExpenses: so traz o que bate com o dia de hoje e ainda nao rodou nesse mes", () => {
  const dueToday = createRecurringExpense({ fromNumber: A, description: "vence hoje dia 12", amount: 20, categoryId: null, paymentMethodId: null, dayOfMonth: 12 });
  createRecurringExpense({ fromNumber: A, description: "vence outro dia", amount: 30, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });

  const due = getDueRecurringExpenses("2026-03-12");
  assert.ok(due.some((r) => r.id === dueToday.id));
  assert.ok(!due.some((r) => r.description === "vence outro dia"));

  markRecurringExpenseRunForMonth(dueToday.id, "2026-03");
  const dueAgainSameMonth = getDueRecurringExpenses("2026-03-12");
  assert.ok(!dueAgainSameMonth.some((r) => r.id === dueToday.id)); // ja rodou nesse mes

  const dueNextMonth = getDueRecurringExpenses("2026-04-12");
  assert.ok(dueNextMonth.some((r) => r.id === dueToday.id)); // mes seguinte, roda de novo
});

test("getDueRecurringExpenses: dia_of_month 31 lanca no ultimo dia de um mes mais curto", () => {
  const shortMonthRecurring = createRecurringExpense({
    fromNumber: A,
    description: "vence dia 31, mes curto",
    amount: 50,
    categoryId: null,
    paymentMethodId: null,
    dayOfMonth: 31,
  });

  // abril tem 30 dias: o gasto configurado pro dia 31 deve cair no dia 30
  const dueOnDay30 = getDueRecurringExpenses("2026-04-30");
  assert.ok(dueOnDay30.some((r) => r.id === shortMonthRecurring.id));

  // no dia 29 (nao e o ultimo dia do mes) ainda nao deve disparar
  const dueOnDay29 = getDueRecurringExpenses("2026-04-29");
  assert.ok(!dueOnDay29.some((r) => r.id === shortMonthRecurring.id));
});
