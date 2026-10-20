// Card 16 (RN12, RN17): gasto fixo e alerta de conta cadastrados pro dia 29/30/31 disparam no ultimo dia dos meses curtos,
// uma vez so por mes, e o texto diz que o dia foi antecipado (so quando foi).
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert } from "../../src/bills/service";
import { startBillAlertScheduler } from "../../src/bills/scheduler";
import { createRecurringExpense } from "../../src/expenses/recurring";
import { startRecurringExpenseScheduler } from "../../src/expenses/recurringScheduler";
import { monthEndShiftFrom } from "../../src/timeSP";
import { resetDailyJobsForTests, runDueDailyJobs } from "../../src/scheduler/dailyJobs";
import { resetJobRunsForTests } from "../../src/scheduler/jobRuns";

let seq = 0;
function user(): string {
  const n = `55110009400${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

// relogio de Sao Paulo fixo (inclusive `new Date()`, que os agendadores usam) e os dois agendadores capturados
function setup(t: TestContext, nowIso: string) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(nowIso) });
  const sent: { to: string; text: string }[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  resetJobRunsForTests();
  resetDailyJobsForTests();
  startBillAlertScheduler();
  startRecurringExpenseScheduler();
  // as duas rotinas rodam juntas no executor diario (relogio simulado)
  const tick = async () => {
    await runDueDailyJobs(new Date(nowIso));
  };
  return { sent, billTick: tick, recurringTick: tick };
}

test("monthEndShiftFrom: devolve o dia cadastrado so quando hoje e o ultimo dia e o cadastro e maior", () => {
  assert.equal(monthEndShiftFrom(31, "2026-04-30"), 31);
  assert.equal(monthEndShiftFrom(30, "2026-04-30"), null, "dia 30 em abril e o proprio dia");
  assert.equal(monthEndShiftFrom(31, "2026-04-29"), null, "ainda nao e o ultimo dia");
  assert.equal(monthEndShiftFrom(31, "2026-10-31"), null);
  assert.equal(monthEndShiftFrom(31, "2027-02-28"), 31);
  assert.equal(monthEndShiftFrom(29, "2027-02-28"), 29);
  assert.equal(monthEndShiftFrom(29, "2028-02-29"), null);
  assert.equal(monthEndShiftFrom(30, "2028-02-29"), 30);
});

test("Card 16 (RN17): alerta de conta dia 31 avisa 'ultimo dia do mes (vence todo dia 31)' em 30/04; o de dia 30 usa o texto de sempre", async (t) => {
  const { sent, billTick } = setup(t, "2026-04-30T08:00:00-03:00");
  const n = user();
  createBillAlert({ fromNumber: n, name: "Conta de água", dayOfMonth: 31 });
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 30 });
  await billTick();
  const mine = sent.filter((m) => m.to === n).map((m) => m.text);
  assert.ok(mine.includes("📌 Hoje é o último dia do mês (vence todo dia 31): Conta de água.\n1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)"), mine.join("\n---\n"));
  // os dois avisos saem (a fila so controla qual e o da vez); o de dia 30 usa o texto de sempre
  assert.equal(mine.length, 2);
  assert.ok(mine.includes("📌 Hoje é dia de pagar: Luz.\n1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)"), mine.join("\n---\n"));
  // roda de novo no mesmo dia: nao pergunta duas vezes
  const before = sent.length;
  await billTick();
  assert.equal(sent.length, before);
});

test("Card 16 (RN17): fevereiro normal e bissexto antecipam o alerta; mes de 31 dias no dia 31 usa o texto de sempre", async (t) => {
  for (const [now, expected] of [
    ["2027-02-28T08:00:00-03:00", "📌 Hoje é o último dia do mês (vence todo dia 31): Alerta 31."],
    ["2028-02-29T08:00:00-03:00", "📌 Hoje é o último dia do mês (vence todo dia 31): Alerta 31."],
    ["2026-10-31T08:00:00-03:00", "📌 Hoje é dia de pagar: Alerta 31."],
    ["2026-04-29T08:00:00-03:00", null],
  ] as const) {
    await t.test(now, async (sub) => {
      const { sent, billTick } = setup(sub, now);
      const n = user();
      createBillAlert({ fromNumber: n, name: "Alerta 31", dayOfMonth: 31 });
      await billTick();
      const mine = sent.filter((m) => m.to === n);
      if (expected === null) assert.equal(mine.length, 0);
      else assert.ok(mine[0].text.startsWith(`${expected}\n1 ✅`), mine[0]?.text);
    });
  }
});

test("Card 16 (RN17): gasto fixo dia 31 lanca em 30/04 com a observacao; o de dia 30 e o lancamento comum; uma vez por mes", async (t) => {
  const { sent, recurringTick } = setup(t, "2026-04-30T07:00:00-03:00");
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Água", amount: 120, categoryId: null, paymentMethodId: null, dayOfMonth: 31 });
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 30 });
  await recurringTick();
  const mine = sent.filter((m) => m.to === n).map((m) => m.text).sort();
  assert.deepEqual(mine, ["🔁 Gasto fixo lançado (vence todo dia 31; hoje é o último dia do mês): R$ 120,00 — Água", "🔁 Gasto fixo lançado: R$ 100,00 — Internet"].sort());
  const before = sent.length;
  await recurringTick();
  assert.equal(sent.length, before, "no maximo uma vez por mes");
});

test("Card 16 (RN17): gasto fixo dia 30 em fevereiro bissexto lanca no 29 com a observacao; dia 31 em outubro e o texto de sempre", async (t) => {
  const bissexto = setup(t, "2028-02-29T07:00:00-03:00");
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Aluguel", amount: 900, categoryId: null, paymentMethodId: null, dayOfMonth: 30 });
  await bissexto.recurringTick();
  assert.equal(bissexto.sent.find((m) => m.to === n)?.text, "🔁 Gasto fixo lançado (vence todo dia 30; hoje é o último dia do mês): R$ 900,00 — Aluguel");
});
