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

  confirmBillAlertPaid(dueToday.id, "2026-03-12");
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

// Recorrencia por INTERVALO (ex: "comprar racao a cada 45 dias") -- diferente
// de dia fixo do mes, conta a partir de HOJE (data de criacao/ultima
// confirmacao), nao de um dia de calendario especifico.
test("createBillAlert por intervalo: next_due_date comeca hoje + interval_days", () => {
  const bill = createBillAlert({ fromNumber: A, name: "ração a cada 45 dias", intervalDays: 45 });
  assert.equal(bill.recurrence_type, "interval");
  assert.equal(bill.interval_days, 45);
  assert.ok(bill.next_due_date); // calculado a partir de hoje (spDateString), nao fixo no teste
});

test("getDueBillAlerts: alerta por intervalo so pergunta quando next_due_date chega", () => {
  const bill = createBillAlert({ fromNumber: A, name: "trocar filtro", intervalDays: 30 });
  // forca uma data de vencimento conhecida pro teste, sem depender do "hoje" real
  confirmBillAlertPaid(bill.id, "2026-01-01"); // reseta next_due_date pra 2026-01-01 + 30 = 2026-01-31

  const notDueYet = getDueBillAlerts("2026-01-30");
  assert.ok(!notDueYet.some((b) => b.id === bill.id));

  const dueOnDay = getDueBillAlerts("2026-01-31");
  assert.ok(dueOnDay.some((b) => b.id === bill.id));

  const dueAfter = getDueBillAlerts("2026-02-05");
  assert.ok(dueAfter.some((b) => b.id === bill.id)); // ainda nao confirmado, continua valendo
});

test("confirmBillAlertPaid por intervalo: reinicia a contagem a partir de HOJE, nao do vencimento original", () => {
  const bill = createBillAlert({ fromNumber: A, name: "ração confirmar", intervalDays: 45 });
  confirmBillAlertPaid(bill.id, "2026-07-01"); // reseta next_due_date pra 2026-07-01 + 45 = 2026-08-15

  const updated = getBillAlertById(A, bill.id)!;
  assert.equal(updated.next_due_date, "2026-08-15");
  assert.equal(updated.snoozed_until, null);
});

test("snoozeBillAlert funciona igual pra alerta por intervalo", () => {
  const bill = createBillAlert({ fromNumber: A, name: "ração soneca", intervalDays: 10 });
  confirmBillAlertPaid(bill.id, "2026-09-01"); // next_due_date = 2026-09-11
  markBillAlertAsked(bill.id, "2026-09-11");
  snoozeBillAlert(bill.id, "2026-09-12");

  assert.ok(!getDueBillAlerts("2026-09-11").some((b) => b.id === bill.id));
  assert.ok(getDueBillAlerts("2026-09-12").some((b) => b.id === bill.id));
});
