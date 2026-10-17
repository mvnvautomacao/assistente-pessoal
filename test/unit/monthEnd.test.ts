// Card 16 (RN12 a RN14): dia efetivo do mes, ajuste de data inexistente e disparo de gasto fixo / alerta no ultimo dia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampToMonthEnd, daysInMonth, effectiveDayOfMonth, monthNamePt } from "../../src/timeSP";
import { createRecurringExpense, getDueRecurringExpenses } from "../../src/expenses/recurring";
import { createBillAlert, getDueBillAlerts } from "../../src/bills/service";

test("daysInMonth: todos os meses, 2027 (normal) e 2028 (bissexto)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2027, m)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28, "seculo nao bissexto");
  assert.equal(daysInMonth(2000, 2), 29);
});

test("effectiveDayOfMonth: min(dia, dias do mes); aceita YYYY-MM e YYYY-MM-DD", () => {
  assert.equal(effectiveDayOfMonth(31, "2026-04"), 30);
  assert.equal(effectiveDayOfMonth(31, "2026-04-15"), 30);
  assert.equal(effectiveDayOfMonth(31, "2027-02"), 28);
  assert.equal(effectiveDayOfMonth(31, "2028-02"), 29);
  assert.equal(effectiveDayOfMonth(30, "2028-02"), 29);
  assert.equal(effectiveDayOfMonth(30, "2026-10"), 30);
  assert.equal(effectiveDayOfMonth(31, "2026-10"), 31);
  assert.equal(effectiveDayOfMonth(5, "2026-02"), 5);
  assert.equal(monthNamePt(4), "abril");
  assert.equal(monthNamePt(12), "dezembro");
});

const NOW = new Date("2026-04-10T12:00:00-03:00");

test("clampToMonthEnd: 31/04, 30/02 e 29/02 em ano normal viram o ultimo dia, com o mesmo horario e aviso", () => {
  const abril = clampToMonthEnd("2026-04-31T09:00:00-03:00", NOW);
  assert.deepEqual(abril, { iso: "2026-04-30T09:00:00-03:00", adjusted: true, from: "2026-04-31", warning: "Abril só tem 30 dias, então marquei pro dia 30/04." });
  assert.equal(clampToMonthEnd("2026-04-31T09:00:00", NOW).iso, "2026-04-30T09:00:00", "sem offset tambem");
  assert.equal(clampToMonthEnd("2026-04-31", NOW).iso, "2026-04-30", "so data");
  const fev = clampToMonthEnd("2027-02-30T14:00:00-03:00", NOW);
  assert.equal(fev.iso, "2027-02-28T14:00:00-03:00");
  assert.equal(fev.warning, "Fevereiro só tem 28 dias, então marquei pro dia 28/02.");
  assert.equal(clampToMonthEnd("2027-02-29T14:00:00-03:00", NOW).iso, "2027-02-28T14:00:00-03:00");
  assert.equal(clampToMonthEnd("2027-02-31T14:00:00-03:00", NOW).iso, "2027-02-28T14:00:00-03:00");
});

test("clampToMonthEnd: 29/02 em ano bissexto e datas normais nao sao tocadas; dia 32, mes 13 e texto tambem nao", () => {
  assert.deepEqual(clampToMonthEnd("2028-02-29T14:00:00-03:00", NOW), { iso: "2028-02-29T14:00:00-03:00", adjusted: false });
  assert.equal(clampToMonthEnd("2028-02-30T14:00:00-03:00", NOW).iso, "2028-02-29T14:00:00-03:00");
  assert.equal(clampToMonthEnd("2026-04-30T09:00:00-03:00", NOW).adjusted, false);
  for (const bad of ["2026-04-32T09:00:00-03:00", "2026-13-05T09:00:00-03:00", "2026-00-05T09:00:00", "2026-04-00", "amanhã", "", "31/04"]) {
    assert.deepEqual(clampToMonthEnd(bad, NOW), { iso: bad, adjusted: false }, bad);
  }
});

test("clampToMonthEnd (RN14): se o ultimo dia ja passou, vale o proximo mes com o dia pedido; vira o ano em dezembro", () => {
  // 30/04 as 15h e o usuario pede "dia 31 as 9h": 30/04 09:00 ja passou -> 31/05
  const now = new Date("2026-04-30T15:00:00-03:00");
  const r = clampToMonthEnd("2026-04-31T09:00:00-03:00", now);
  assert.equal(r.iso, "2026-05-31T09:00:00-03:00");
  assert.equal(r.warning, "Abril só tem 30 dias, e o dia 30/04 já passou, então marquei pro dia 31/05.");
  // mais tarde no mesmo dia (9h ainda por vir) fica em 30/04
  assert.equal(clampToMonthEnd("2026-04-31T20:00:00-03:00", now).iso, "2026-04-30T20:00:00-03:00");
  // fevereiro: dia 30 pedido, proximo mes (marco) tem 31 -> dia 30
  const fev = clampToMonthEnd("2027-02-30T09:00:00-03:00", new Date("2027-02-28T15:00:00-03:00"));
  assert.equal(fev.iso, "2027-03-30T09:00:00-03:00");
  // so data: o proprio dia ainda conta (fim do dia)
  assert.equal(clampToMonthEnd("2026-04-31", now).iso, "2026-04-30");
  assert.equal(clampToMonthEnd("2026-04-31", new Date("2026-05-01T08:00:00-03:00")).iso, "2026-05-31");
  // dezembro nao tem dia inexistente; novembro (30) -> dezembro (31)
  assert.equal(clampToMonthEnd("2026-11-31T09:00:00-03:00", new Date("2026-11-30T20:00:00-03:00")).iso, "2026-12-31T09:00:00-03:00");
  // virada de ano nao acontece (so fev, abr, jun, set, nov tem dia faltando), mas o codigo cobre dezembro -> janeiro
  assert.equal(clampToMonthEnd("2026-12-32T09:00:00-03:00", now).adjusted, false);
});

const U = "551100071600";

test("gasto fixo: dia 31 dispara no 30 em abril/jun/set/nov, no 28 ou 29 em fevereiro e no 31 nos demais; dia 30 em mes de 31 dispara no 30", () => {
  const fixo31 = createRecurringExpense({ fromNumber: U, description: "Fixo 31", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 31 });
  const fixo30 = createRecurringExpense({ fromNumber: U, description: "Fixo 30", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 30 });
  const due = (date: string) => getDueRecurringExpenses(date).filter((r) => r.from_number === U).map((r) => r.id);
  assert.deepEqual(due("2026-04-30"), [fixo31.id, fixo30.id], "abril: 31 e 30 no dia 30");
  assert.deepEqual(due("2026-04-29"), []);
  assert.deepEqual(due("2026-06-30"), [fixo31.id, fixo30.id]);
  assert.deepEqual(due("2026-09-30"), [fixo31.id, fixo30.id]);
  assert.deepEqual(due("2026-11-30"), [fixo31.id, fixo30.id]);
  assert.deepEqual(due("2027-02-28"), [fixo31.id, fixo30.id], "fevereiro normal");
  assert.deepEqual(due("2028-02-29"), [fixo31.id, fixo30.id], "fevereiro bissexto");
  assert.deepEqual(due("2028-02-28"), [], "bissexto: o 28 ainda nao e o ultimo dia");
  assert.deepEqual(due("2026-10-31"), [fixo31.id], "mes de 31 dias: 31 no 31");
  assert.deepEqual(due("2026-10-30"), [fixo30.id], "dia 30 em mes de 31 dias dispara no 30");
});

test("alerta de conta: dia 31 dispara so no ultimo dia do mes curto e no maximo uma vez por mes", () => {
  const bill = createBillAlert({ fromNumber: U, name: "Alerta 31", dayOfMonth: 31 });
  const due = (date: string) => getDueBillAlerts(date).filter((b) => b.from_number === U).map((b) => b.id);
  assert.deepEqual(due("2026-04-30"), [bill.id]);
  assert.deepEqual(due("2026-04-29"), []);
  assert.deepEqual(due("2027-02-28"), [bill.id]);
  assert.deepEqual(due("2028-02-29"), [bill.id]);
  assert.deepEqual(due("2026-10-31"), [bill.id]);
  assert.deepEqual(due("2026-10-30"), []);
  // o dia cadastrado coincide com o ultimo dia do mes (dia 30 em abril): dispara uma vez so, no dia 30
  const trinta = createBillAlert({ fromNumber: U, name: "Alerta 30", dayOfMonth: 30 });
  assert.deepEqual(due("2026-04-30").sort(), [bill.id, trinta.id].sort());
  assert.deepEqual(due("2028-02-29").sort(), [bill.id, trinta.id].sort(), "fevereiro bissexto: 30 cai no 29");
});
