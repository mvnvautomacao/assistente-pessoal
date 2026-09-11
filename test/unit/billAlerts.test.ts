import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBillAlert,
  getBillAlertById,
  listBillAlerts,
  deactivateBillAlert,
  findActiveBillAlertByName,
  markBillAlertAsked,
  confirmBillAlertPaid,
  snoozeBillAlert,
  getDueBillAlerts,
} from "../../src/bills/service";

const A = "551100060001";
const B = "551100060002";

test("createBillAlert + listBillAlerts: isolado por numero", () => {
  createBillAlert({ fromNumber: A, name: "água do A", dayOfMonth: 5 });
  createBillAlert({ fromNumber: B, name: "água do B", dayOfMonth: 10 });

  const listA = listBillAlerts(A);
  assert.ok(listA.some((b) => b.name === "água do A"));
  assert.ok(!listA.some((b) => b.name === "água do B"));
});

test("deactivateBillAlert respeita o dono e tira da listagem", () => {
  const created = createBillAlert({ fromNumber: A, name: "luz desativar", dayOfMonth: 15 });

  assert.equal(deactivateBillAlert(B, created.id), false); // B nao consegue desativar alerta de A
  assert.ok(listBillAlerts(A).some((b) => b.id === created.id));

  assert.equal(deactivateBillAlert(A, created.id), true);
  assert.ok(!listBillAlerts(A).some((b) => b.id === created.id));
});

test("findActiveBillAlertByName busca por trecho do texto, ignorando desativados", () => {
  createBillAlert({ fromNumber: A, name: "internet fibra XYZ", dayOfMonth: 20 });
  const found = findActiveBillAlertByName(A, "fibra");
  assert.equal(found?.name, "internet fibra XYZ");

  const created = getBillAlertById(A, found!.id)!;
  deactivateBillAlert(A, created.id);
  assert.equal(findActiveBillAlertByName(A, "fibra XYZ"), null);
});

test("getDueBillAlerts: so pergunta o que bate com o dia de hoje e ainda nao foi confirmado nesse mes", () => {
  const dueToday = createBillAlert({ fromNumber: A, name: "vence hoje dia 12", dayOfMonth: 12 });
  createBillAlert({ fromNumber: A, name: "vence outro dia", dayOfMonth: 20 });

  const due = getDueBillAlerts("2026-03-12");
  assert.ok(due.some((b) => b.id === dueToday.id));
  assert.ok(!due.some((b) => b.name === "vence outro dia"));

  confirmBillAlertPaid(dueToday.id, "2026-03");
  const dueAgainSameMonth = getDueBillAlerts("2026-03-12");
  assert.ok(!dueAgainSameMonth.some((b) => b.id === dueToday.id)); // ja confirmado esse mes

  const dueNextMonth = getDueBillAlerts("2026-04-12");
  assert.ok(dueNextMonth.some((b) => b.id === dueToday.id)); // mes seguinte, pergunta de novo
});

test("getDueBillAlerts: day_of_month 31 pergunta no ultimo dia de um mes mais curto", () => {
  const shortMonthBill = createBillAlert({ fromNumber: A, name: "vence dia 31, mes curto", dayOfMonth: 31 });

  // abril tem 30 dias: o alerta configurado pro dia 31 deve cair no dia 30
  const dueOnDay30 = getDueBillAlerts("2026-04-30");
  assert.ok(dueOnDay30.some((b) => b.id === shortMonthBill.id));

  const dueOnDay29 = getDueBillAlerts("2026-04-29");
  assert.ok(!dueOnDay29.some((b) => b.id === shortMonthBill.id));
});

test("getDueBillAlerts: nao pergunta 2x no mesmo dia mesmo se o cron rodar de novo", () => {
  const bill = createBillAlert({ fromNumber: A, name: "so uma vez por dia", dayOfMonth: 7 });
  markBillAlertAsked(bill.id, "2026-05-07");

  const dueAgain = getDueBillAlerts("2026-05-07");
  assert.ok(!dueAgain.some((b) => b.id === bill.id));
});

test("getDueBillAlerts: soneca de 'lembra amanha' faz perguntar so na data adiada, nao antes", () => {
  const bill = createBillAlert({ fromNumber: A, name: "conta adiada", dayOfMonth: 9 });
  markBillAlertAsked(bill.id, "2026-06-09");
  snoozeBillAlert(bill.id, "2026-06-10");

  const stillNotDue = getDueBillAlerts("2026-06-09");
  assert.ok(!stillNotDue.some((b) => b.id === bill.id)); // mesmo dia que ja perguntou, nao de novo

  const dueOnSnoozedDate = getDueBillAlerts("2026-06-10");
  assert.ok(dueOnSnoozedDate.some((b) => b.id === bill.id)); // dia adiado, pergunta de novo

  const dueAfterSnoozedDate = getDueBillAlerts("2026-06-11");
  assert.ok(dueAfterSnoozedDate.some((b) => b.id === bill.id)); // depois do adiado tambem (nao passou nem foi confirmado)
});
