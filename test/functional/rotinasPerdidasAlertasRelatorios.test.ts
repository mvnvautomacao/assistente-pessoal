// Card 19, parte 2: alertas de conta fixa e relatorios semanal/mensal que perdem a hora. Relogio simulado (runDueDailyJobs recebe o "agora").
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import { ensureUserSeeded, getOrCreateCategory, insertExpense, setReportDayOfWeek } from "../../src/expenses/service";
import { confirmBillAlertPaid, createBillAlert, getBillAlertById, billLateFromDate, lastBillDueDate } from "../../src/bills/service";
import { getPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { lateNote, buildBillAlertQuestion } from "../../src/bills/checkinReply";
import { startBillAlertScheduler } from "../../src/bills/scheduler";
import { startExpenseReportScheduler, isLastDayOfMonth } from "../../src/expenses/reportScheduler";
import { markLegacyRuns, markUnrecoverableRuns, resetDailyJobsForTests, runDueDailyJobs } from "../../src/scheduler/dailyJobs";
import { getJobRun, resetJobRunsForTests } from "../../src/scheduler/jobRuns";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso);

let seq = 0;
function user(): string {
  const n = `55110009000${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  return n;
}

function setup(t: TestContext) {
  db.exec(`UPDATE bill_alerts SET active = 0`);
  db.exec(`UPDATE user_settings SET report_day_of_week = NULL`);
  resetJobRunsForTests();
  resetDailyJobsForTests();
  const sent: { to: string; text: string }[] = [];
  let fail = false;
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    if (fail) throw new Error("Evolution fora do ar (simulado)");
    sent.push({ to, text });
  });
  startBillAlertScheduler();
  startExpenseReportScheduler();
  return {
    sent,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

function alert(n: string, name: string, dayOfMonth: number, createdAt = "2026-01-01 12:00:00") {
  const row = createBillAlert({ fromNumber: n, name, dayOfMonth });
  db.prepare(`UPDATE bill_alerts SET created_at = ? WHERE id = ?`).run(createdAt, row.id);
  return row;
}

const textsOf = (sent: { to: string; text: string }[], n: string) => sent.filter((m) => m.to === n).map((m) => m.text);
const LIST = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";

test("Card 19 (regras puras): ciclo do ultimo vencimento, atraso e texto do complemento", () => {
  assert.deepEqual(lastBillDueDate(10, "2026-11-12"), { yearMonth: "2026-11", dueDate: "2026-11-10" });
  assert.deepEqual(lastBillDueDate(10, "2026-11-10"), { yearMonth: "2026-11", dueDate: "2026-11-10" });
  assert.deepEqual(lastBillDueDate(10, "2026-11-05"), { yearMonth: "2026-10", dueDate: "2026-10-10" }, "dia deste mes ainda nao chegou: ciclo do mes anterior");
  assert.deepEqual(lastBillDueDate(31, "2026-05-02"), { yearMonth: "2026-04", dueDate: "2026-04-30" }, "dia 31 em mes curto");
  assert.deepEqual(lastBillDueDate(31, "2027-03-05"), { yearMonth: "2027-02", dueDate: "2027-02-28" });
  assert.deepEqual(lastBillDueDate(10, "2027-01-05"), { yearMonth: "2026-12", dueDate: "2026-12-10" }, "virada de ano");
  const bill = { recurrence_type: "day_of_month", day_of_month: 10, snoozed_until: null, next_due_date: null } as never;
  assert.equal(billLateFromDate(bill, "2026-11-10"), null);
  assert.equal(billLateFromDate(bill, "2026-11-12"), "2026-11-10");
  assert.equal(billLateFromDate({ ...(bill as object), snoozed_until: "2026-11-11" } as never, "2026-11-12"), null, "soneca nao e atraso");
  assert.equal(billLateFromDate({ recurrence_type: "interval", next_due_date: "2026-10-05", snoozed_until: null } as never, "2026-10-08"), "2026-10-05");
  assert.equal(billLateFromDate({ recurrence_type: "interval", next_due_date: "2026-10-08", snoozed_until: null } as never, "2026-10-08"), null);
  assert.equal(lateNote({ recurrenceType: "day_of_month", lateFromDate: "2026-11-10" }), " (atrasado: vencia dia 10)");
  assert.equal(lateNote({ recurrenceType: "interval", lateFromDate: "2026-10-05" }), " (atrasado: vencia dia 05/10)");
  assert.equal(lateNote({ recurrenceType: "interval", lateFromDate: null }), "");
  assert.equal(buildBillAlertQuestion({ name: "Luz", recurrenceType: "day_of_month" }), `📌 Hoje é dia de pagar: Luz.\n${LIST}`);
});

test("Card 19: alerta do dia 10, servidor fora de 10/11 a 12/11 -- ao voltar o aviso 1 sai 'atrasado' e nao repete", async (t) => {
  const { sent } = setup(t);
  const n = user();
  const bill = alert(n, "Luz", 10);
  await runDueDailyJobs(at("2026-11-12T08:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), [`📌 Hoje é dia de pagar: Luz (atrasado: vencia dia 10).\n${LIST}`]);
  assert.equal(getPendingBillCheckin(n)?.lateFromDate, "2026-11-10");
  assert.equal(getBillAlertById(n, bill.id)?.last_asked_date, "2026-11-12");
  await runDueDailyJobs(at("2026-11-12T08:01:00-03:00"));
  await runDueDailyJobs(at("2026-11-13T08:00:00-03:00"));
  await runDueDailyJobs(at("2026-11-20T08:00:00-03:00"));
  assert.equal(textsOf(sent, n).length, 1, "um aviso por ciclo (sem soneca)");
});

test("Card 19: no dia certo o aviso e o de sempre, sem complemento de atraso", async (t) => {
  const { sent } = setup(t);
  const n = user();
  alert(n, "Luz", 10);
  await runDueDailyJobs(at("2026-11-10T08:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), [`📌 Hoje é dia de pagar: Luz.\n${LIST}`]);
});

test("Card 19 (RN05): alerta do dia 10 cadastrado no dia 15 nao e avisado ate o proximo dia 10 (dezembro)", async (t) => {
  const { sent } = setup(t);
  const n = user();
  alert(n, "Luz", 10, "2026-11-15 15:00:00");
  for (const day of ["2026-11-15", "2026-11-16", "2026-11-30", "2026-12-09"]) await runDueDailyJobs(at(`${day}T08:00:00-03:00`));
  assert.deepEqual(textsOf(sent, n), []);
  await runDueDailyJobs(at("2026-12-10T08:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), [`📌 Hoje é dia de pagar: Luz.\n${LIST}`]);
});

test("Card 19: ciclo do mes anterior -- dia 10 nunca perguntado em outubro, volta em 05/11: avisa 'vencia dia 10'; confirmado ou ja perguntado nao repete", async (t) => {
  const { sent } = setup(t);
  const never = user();
  const confirmed = user();
  const asked = user();
  alert(never, "Agua", 10);
  const c = alert(confirmed, "Gas", 10);
  db.prepare(`UPDATE bill_alerts SET confirmed_month = '2026-10' WHERE id = ?`).run(c.id);
  const a = alert(asked, "Internet", 10);
  db.prepare(`UPDATE bill_alerts SET last_asked_date = '2026-10-10' WHERE id = ?`).run(a.id);
  await runDueDailyJobs(at("2026-11-05T08:00:00-03:00"));
  assert.deepEqual(textsOf(sent, never), [`📌 Hoje é dia de pagar: Agua (atrasado: vencia dia 10).\n${LIST}`]);
  assert.deepEqual(textsOf(sent, confirmed), []);
  assert.deepEqual(textsOf(sent, asked), []);
});

test("Card 19: confirmar um aviso atrasado fecha o ciclo do VENCIMENTO (nao o mes de hoje)", () => {
  const n = user();
  const bill = alert(n, "Agua", 20);
  confirmBillAlertPaid(n, bill.id, "2026-11-12"); // dia 20 deste mes ainda nao chegou: o ciclo e outubro
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, "2026-10");
  const luz = alert(n, "Luz", 10);
  confirmBillAlertPaid(n, luz.id, "2026-11-12");
  assert.equal(getBillAlertById(n, luz.id)?.confirmed_month, "2026-11");
});

test("Card 19: alerta por intervalo vencido ganha o complemento de atraso; soneca vencida nao", async (t) => {
  const { sent } = setup(t);
  const n = user();
  const m = user();
  const interval = createBillAlert({ fromNumber: n, name: "Racao", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = '2026-10-05' WHERE id = ?`).run(interval.id);
  const snoozed = alert(m, "Gas", 10);
  db.prepare(`UPDATE bill_alerts SET snoozed_until = '2026-10-07', last_asked_date = '2026-10-06' WHERE id = ?`).run(snoozed.id);
  await runDueDailyJobs(at("2026-10-08T08:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), [`📌 Hora de: Racao (atrasado: vencia dia 05/10).\n1 ✅ Já resolvi\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou fazer agora (pular)`]);
  assert.deepEqual(textsOf(sent, m), [`📌 Hoje é dia de pagar: Gas.\n${LIST}`]);
});

test("Card 19: Evolution fora -- o aviso nao conta como perguntado, a rotina retenta no minuto seguinte e sai uma vez so", async (t) => {
  const { sent, setFail } = setup(t);
  const n = user();
  const bill = alert(n, "Luz", 10);
  const silence = console.error;
  console.error = () => {};
  try {
    setFail(true);
    const first = await runDueDailyJobs(at("2026-11-12T08:00:00-03:00"));
    assert.deepEqual(first.map((s) => [s.status, s.failures]), [["failed", 1]]);
    assert.equal(getBillAlertById(n, bill.id)?.last_asked_date, null);
    assert.equal(getPendingBillCheckin(n), null);
    setFail(false);
    const second = await runDueDailyJobs(at("2026-11-12T08:01:00-03:00"));
    assert.deepEqual(second.map((s) => s.status), ["done"]);
  } finally {
    console.error = silence;
  }
  assert.equal(textsOf(sent, n).length, 1);
  await runDueDailyJobs(at("2026-11-12T08:02:00-03:00"));
  assert.equal(textsOf(sent, n).length, 1);
});

// ---- relatorios ---------------------------------------------------------------------------------------------------------

function spend(n: string, date: string, amount = 50) {
  return insertExpense({ fromNumber: n, amount, description: "Gasto", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date });
}

test("Card 19: relatorio semanal perdido as 9h e servidor de volta as 14h -- sai uma vez; no dia seguinte nao sai e a execucao fica 'perdida'", async (t) => {
  const { sent } = setup(t);
  const monday = user();
  setReportDayOfWeek(monday, 1); // 2026-10-19 e segunda
  spend(monday, "2026-10-14");
  await runDueDailyJobs(at("2026-10-19T14:00:00-03:00"));
  const reports = textsOf(sent, monday).filter((x) => x.includes("Gastos"));
  assert.equal(reports.length, 1);
  assert.match(reports[0], /semana passada/);
  await runDueDailyJobs(at("2026-10-19T14:01:00-03:00"));
  await runDueDailyJobs(at("2026-10-19T23:59:00-03:00"));
  assert.equal(textsOf(sent, monday).length, 1, "uma vez so");
  assert.equal(getJobRun("relatorio_semanal", "2026-10-19")?.status, "done");

  // outra semana: servidor fora o dia todo (segunda 26/10) e volta na terca
  const monday2 = user();
  setReportDayOfWeek(monday2, 1);
  spend(monday2, "2026-10-22");
  const before = sent.length;
  await runDueDailyJobs(at("2026-10-27T10:00:00-03:00"));
  assert.equal(textsOf(sent, monday2).length, 0, "relatorio de segunda nao sai na terca");
  assert.equal(sent.length, before, "nem pra ninguem");
  const marked = markUnrecoverableRuns({ from: at("2026-10-26T08:00:00-03:00"), to: at("2026-10-27T10:00:00-03:00"), minutes: 1560 }, at("2026-10-27T10:00:00-03:00"));
  assert.ok(marked >= 1);
  assert.equal(getJobRun("relatorio_semanal", "2026-10-26")?.status, "missed");
  const logged = db.prepare(`SELECT summary FROM activity_log WHERE type = 'job_missed' AND summary LIKE '%relatorio_semanal de 2026-10-26%'`).all();
  assert.equal(logged.length, 1);
});

test("Card 19: relatorio semanal sem gasto na semana fica em silencio (e o dia fica registrado)", async (t) => {
  const { sent } = setup(t);
  const n = user();
  setReportDayOfWeek(n, 1);
  await runDueDailyJobs(at("2026-10-19T09:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), []);
  assert.equal(getJobRun("relatorio_semanal", "2026-10-19")?.status, "done");
});

test("Card 19: relatorio mensal no horario normal (ultimo dia, 18h) sai uma vez com o nome do mes vigente e nao repete no dia 1", async (t) => {
  const { sent } = setup(t);
  const n = user();
  setReportDayOfWeek(n, 3);
  spend(n, "2026-10-12");
  await runDueDailyJobs(at("2026-10-31T17:59:00-03:00"));
  assert.equal(textsOf(sent, n).filter((x) => x.includes("esse mês")).length, 0, "antes das 18h");
  await runDueDailyJobs(at("2026-10-31T18:00:00-03:00"));
  const monthly = textsOf(sent, n).filter((x) => x.includes("esse mês (outubro de 2026)"));
  assert.equal(monthly.length, 1);
  await runDueDailyJobs(at("2026-11-01T09:00:00-03:00"));
  await runDueDailyJobs(at("2026-11-02T09:00:00-03:00"));
  assert.equal(textsOf(sent, n).filter((x) => x.includes("outubro de 2026")).length, 1, "nao reenvia");
});

test("Card 19: relatorio mensal perdido no ultimo dia -- sai ate o dia 2 do mes seguinte, com o nome do mes que acabou, e nao depois", async (t) => {
  const { sent } = setup(t);
  const n = user();
  setReportDayOfWeek(n, 3);
  spend(n, "2026-10-12");
  await runDueDailyJobs(at("2026-11-02T10:00:00-03:00"));
  const monthly = textsOf(sent, n).filter((x) => x.includes("outubro de 2026"));
  assert.equal(monthly.length, 1);
  assert.match(monthly[0], /^💰 Gastos — outubro de 2026/);
  await runDueDailyJobs(at("2026-11-02T10:01:00-03:00"));
  assert.equal(textsOf(sent, n).filter((x) => x.includes("outubro de 2026")).length, 1);

  // outro mes: volta so no dia 3 -- fora da janela
  const late = user();
  setReportDayOfWeek(late, 3);
  spend(late, "2026-11-10");
  const marked = markUnrecoverableRuns({ from: at("2026-11-30T12:00:00-03:00"), to: at("2026-12-03T09:00:00-03:00"), minutes: 4000 }, at("2026-12-03T09:00:00-03:00"));
  assert.equal(marked >= 1, true);
  await runDueDailyJobs(at("2026-12-03T09:00:00-03:00"));
  assert.deepEqual(textsOf(sent, late), []);
  assert.equal(getJobRun("relatorio_mensal", "2026-11-30")?.status, "missed");
});

test("Card 19: relatorio mensal em mes curto e virada de ano (ultimo dia 28/02 e 31/12)", async (t) => {
  assert.equal(isLastDayOfMonth("2027-02-28"), true);
  assert.equal(isLastDayOfMonth("2028-02-28"), false);
  assert.equal(isLastDayOfMonth("2028-02-29"), true);
  assert.equal(isLastDayOfMonth("2026-12-31"), true);
  const { sent } = setup(t);
  const n = user();
  setReportDayOfWeek(n, 3);
  spend(n, "2026-12-10");
  await runDueDailyJobs(at("2027-01-01T08:00:00-03:00"));
  assert.equal(textsOf(sent, n).filter((x) => x.includes("dezembro de 2026")).length, 1);
});

test("Card 19: primeira subida do novo agendador -- relatorios de hoje que o agendador antigo ja enviou nao saem em dobro", async (t) => {
  const { sent } = setup(t);
  const n = user();
  setReportDayOfWeek(n, 1);
  spend(n, "2026-10-14");
  const marked = markLegacyRuns(at("2026-10-19T14:00:00-03:00"));
  assert.ok(marked >= 1);
  await runDueDailyJobs(at("2026-10-19T14:00:30-03:00"));
  assert.equal(textsOf(sent, n).length, 0);
  assert.equal(getJobRun("relatorio_semanal", "2026-10-19")?.status, "missed");
  assert.equal(markLegacyRuns(at("2026-10-19T14:01:00-03:00")), 0, "idempotente");
});
