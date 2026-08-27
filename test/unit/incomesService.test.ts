import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertIncome,
  getIncomeById,
  updateIncome,
  deleteIncome,
  findRecentIncome,
  getIncomeSummaryBetween,
  getIncomesForMonth,
  getAvailableIncomeMonths,
  getAllIncomes,
} from "../../src/incomes/service";

const A = "551100080001";
const B = "551100080002";

test("insertIncome/getIncomeById/updateIncome/deleteIncome fazem o ciclo completo", () => {
  const created = insertIncome({ fromNumber: A, amount: 3000, description: "salário", date: "2026-01-05" });
  assert.equal(getIncomeById(A, created.id)?.amount, 3000);

  updateIncome(A, created.id, { amount: 3200, description: "salário reajustado", date: "2026-01-06" });
  const updated = getIncomeById(A, created.id)!;
  assert.equal(updated.amount, 3200);
  assert.equal(updated.description, "salário reajustado");

  assert.equal(deleteIncome(A, created.id), true);
  assert.equal(getIncomeById(A, created.id), null);
});

test("updateIncome/deleteIncome/getIncomeById nunca alcancam entrada de outro numero", () => {
  const created = insertIncome({ fromNumber: A, amount: 500, description: "freela", date: "2026-01-10" });
  assert.equal(getIncomeById(B, created.id), null);
  assert.equal(updateIncome(B, created.id, { amount: 1, description: "hackeado", date: "2000-01-01" }), false);
  assert.equal(getIncomeById(A, created.id)?.amount, 500); // continua intacto
  assert.equal(deleteIncome(B, created.id), false);
  assert.ok(getIncomeById(A, created.id)); // continua existindo
});

test("findRecentIncome: sem query pega a mais recente; com query, busca por descricao (so nesse numero)", () => {
  const C = "551100080003";
  insertIncome({ fromNumber: C, amount: 100, description: "reembolso farmacia", date: "2026-02-01" });
  insertIncome({ fromNumber: C, amount: 200, description: "reembolso viagem", date: "2026-02-05" });

  assert.equal(findRecentIncome(C)?.description, "reembolso viagem"); // mais recente
  assert.equal(findRecentIncome(C, "farmacia")?.amount, 100);
  assert.equal(findRecentIncome(B, "reembolso"), null); // nao vaza de outro numero
});

test("getIncomeSummaryBetween soma so o periodo e o numero pedidos", () => {
  const D = "551100080004";
  insertIncome({ fromNumber: D, amount: 1000, description: "dentro do periodo 1", date: "2026-03-10" });
  insertIncome({ fromNumber: D, amount: 500, description: "dentro do periodo 2", date: "2026-03-20" });
  insertIncome({ fromNumber: D, amount: 999, description: "fora do periodo", date: "2026-04-01" });
  insertIncome({ fromNumber: B, amount: 999, description: "outro numero", date: "2026-03-15" });

  const summary = getIncomeSummaryBetween("2026-03-01", "2026-04-01", D);
  assert.equal(summary.total, 1500);
  assert.equal(summary.count, 2);
});

test("getIncomesForMonth / getAvailableIncomeMonths / getAllIncomes so trazem entradas do numero pedido", () => {
  const E = "551100080005";
  insertIncome({ fromNumber: E, amount: 10, description: "mes-E-1", date: "2026-05-10" });
  insertIncome({ fromNumber: E, amount: 20, description: "mes-E-2", date: "2026-06-10" });
  insertIncome({ fromNumber: B, amount: 9999, description: "mes-B", date: "2026-05-10" });

  const monthE = getIncomesForMonth(E, "2026-05");
  assert.equal(monthE.length, 1);
  assert.equal(monthE[0].description, "mes-E-1");

  const months = getAvailableIncomeMonths(E);
  assert.ok(months.includes("2026-05"));
  assert.ok(months.includes("2026-06"));

  const all = getAllIncomes(E);
  assert.equal(all.filter((i) => i.description.startsWith("mes-E")).length, 2);
  assert.ok(!all.some((i) => i.description === "mes-B"));
});
