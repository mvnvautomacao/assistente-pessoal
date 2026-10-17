// Card 17 (RN01, RF01): getRecentExpensesList -- corte no ultimo dia do mes atual, ordem e includeFuture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateCategory, getRecentExpensesList, insertExpense } from "../../src/expenses/service";

let seq = 0;
const user = () => `5511000718${String(seq++).padStart(2, "0")}`;
const add = (n: string, description: string, date: string) =>
  insertExpense({ fromNumber: n, amount: 10, description, categoryId: getOrCreateCategory(n, "Outros").id, paymentMethodId: null, date });
const names = (rows: { description: string }[]) => rows.map((r) => r.description);

test("getRecentExpensesList: padrao corta no fim do mes; o que vence neste mes vem depois do que ja aconteceu", () => {
  const n = user();
  add(n, "antigo", "2026-09-30");
  add(n, "hoje", "2026-10-17");
  add(n, "ontem", "2026-10-16");
  add(n, "dia 25", "2026-10-25");
  add(n, "dia 31", "2026-10-31");
  add(n, "novembro", "2026-11-01");
  add(n, "ano que vem", "2027-01-10");
  assert.deepEqual(names(getRecentExpensesList(n, 10, {}, { today: "2026-10-17" })), ["hoje", "ontem", "antigo", "dia 25", "dia 31"]);
  assert.deepEqual(names(getRecentExpensesList(n, 3, {}, { today: "2026-10-17" })), ["hoje", "ontem", "antigo"], "o limite corta primeiro as futuras");
});

test("getRecentExpensesList: includeFuture traz tudo, as futuras do mais proximo ao mais distante", () => {
  const n = user();
  add(n, "hoje", "2026-10-17");
  add(n, "dez", "2026-12-17");
  add(n, "nov", "2026-11-17");
  assert.deepEqual(names(getRecentExpensesList(n, 10, {}, { today: "2026-10-17", includeFuture: true })), ["hoje", "nov", "dez"]);
});

test("getRecentExpensesList: um periodo (end) mostra tudo do recorte, inclusive meses futuros", () => {
  const n = user();
  add(n, "novembro", "2026-11-05");
  add(n, "outubro", "2026-10-05");
  assert.deepEqual(names(getRecentExpensesList(n, 10, { start: "2026-11-01", end: "2026-12-01" }, { today: "2026-10-17" })), ["novembro"]);
});

test("getRecentExpensesList: virada de mes e meses curtos (fevereiro bissexto)", () => {
  const n = user();
  add(n, "parcela fev", "2028-02-29");
  add(n, "parcela mar", "2028-03-01");
  assert.deepEqual(names(getRecentExpensesList(n, 10, {}, { today: "2028-02-10" })), ["parcela fev"], "29/02/2028 e o ultimo dia do mes");
  assert.deepEqual(names(getRecentExpensesList(n, 10, {}, { today: "2028-03-01" })), ["parcela mar", "parcela fev"]);
  assert.deepEqual(names(getRecentExpensesList(n, 10, {}, { today: "2027-12-31" })), [], "ano seguinte so a partir do mes dele");
});

test("getRecentExpensesList: isolado por numero", () => {
  const a = user();
  const b = user();
  add(a, "de A", "2026-10-17");
  add(b, "de B", "2026-10-17");
  assert.deepEqual(names(getRecentExpensesList(a, 10, {}, { today: "2026-10-17" })), ["de A"]);
});
