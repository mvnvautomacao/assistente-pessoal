// Card 19: rotinas agendadas que perdem a hora. Relogio simulado (runDueDailyJobs recebe o "agora"), Evolution simulada.
// Parte 1: gastos fixos -- recuperados ao voltar, com a data do vencimento, sem duplicar.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import { ensureUserSeeded } from "../../src/expenses/service";
import { createRecurringExpense, getDueRecurringExpenses, getMissedRecurringExpenses, getRecurringExpenseById, deactivateRecurringExpense } from "../../src/expenses/recurring";
import { startRecurringExpenseScheduler } from "../../src/expenses/recurringScheduler";
import { resetDailyJobsForTests, runDueDailyJobs } from "../../src/scheduler/dailyJobs";
import { getJobRun, resetJobRunsForTests } from "../../src/scheduler/jobRuns";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso);

let seq = 0;
function user(): string {
  const n = `55110009100${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  return n;
}

function setup(t: TestContext) {
  db.exec(`UPDATE recurring_expenses SET active = 0`); // um teste nao enxerga os gastos fixos do anterior
  resetJobRunsForTests();
  resetDailyJobsForTests();
  const sent: { to: string; text: string }[] = [];
  let fail = false;
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    if (fail) throw new Error("Evolution fora do ar (simulado)");
    sent.push({ to, text });
  });
  startRecurringExpenseScheduler();
  return {
    sent,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

// cadastrado ha muito tempo (antes de qualquer vencimento dos testes), a nao ser que o teste diga o contrario
function recurring(n: string, day: number, description = "Aluguel", createdAt = "2026-01-01 12:00:00") {
  const row = createRecurringExpense({ fromNumber: n, description, amount: 900, categoryId: null, paymentMethodId: null, dayOfMonth: day });
  db.prepare(`UPDATE recurring_expenses SET created_at = ? WHERE id = ?`).run(createdAt, row.id);
  return row;
}

const launchedOf = (n: string) =>
  (db.prepare(`SELECT date, description FROM expenses WHERE from_number = ? ORDER BY id`).all(n) as { date: string; description: string }[]).map((r) => ({ date: r.date, description: r.description }));
const textsOf = (sent: { to: string; text: string }[], n: string) => sent.filter((m) => m.to === n).map((m) => m.text);

test("Card 19 (reproducao): sem recuperacao, o gasto do dia 5 perdido as 7h nunca mais bate -- getDueRecurringExpenses so olha o proprio dia", () => {
  const n = user();
  const r = recurring(n, 5);
  assert.deepEqual(getDueRecurringExpenses("2026-10-05").filter((x) => x.id === r.id).length, 1);
  assert.deepEqual(getDueRecurringExpenses("2026-10-08").filter((x) => x.id === r.id), [], "no dia 8 o cron antigo nao enxerga o dia 5");
  const missed = getMissedRecurringExpenses("2026-10-08").filter((x) => x.recurring.id === r.id);
  assert.deepEqual(missed.map((x) => x.dueDate), ["2026-10-05"], "a recuperacao enxerga");
});

test("Card 19: servidor volta as 7h40 -- o gasto do dia e lancado uma vez so, com a data de hoje e a mensagem de sempre", async (t) => {
  const { sent } = setup(t);
  const n = user();
  recurring(n, 5, "Aluguel");
  assert.deepEqual(await runDueDailyJobs(at("2026-10-05T06:59:00-03:00")), [], "antes das 7h nada");
  await runDueDailyJobs(at("2026-10-05T07:40:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-10-05", description: "Aluguel" }]);
  assert.deepEqual(textsOf(sent, n), ["🔁 Gasto fixo lançado: R$900.00 — Aluguel"]);
  await runDueDailyJobs(at("2026-10-05T07:41:00-03:00"));
  await runDueDailyJobs(at("2026-10-05T23:00:00-03:00"));
  assert.equal(launchedOf(n).length, 1);
  assert.equal(textsOf(sent, n).length, 1);
  assert.equal(getJobRun("gastos_fixos", "2026-10-05")?.status, "done");
});

test("Card 19: servidor parado de 05/10 a 08/10 -- lanca com data 05/10, avisa 'lancado com atraso' e nao repete depois", async (t) => {
  const { sent } = setup(t);
  const n = user();
  const r = recurring(n, 5, "Aluguel");
  await runDueDailyJobs(at("2026-10-08T08:00:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-10-05", description: "Aluguel" }]);
  assert.deepEqual(textsOf(sent, n), ["🔁 Gasto fixo lançado: R$900.00 — Aluguel\n(lançado com atraso: vencia dia 05/10)"]);
  assert.equal(getRecurringExpenseById(n, r.id)?.last_run_month, "2026-10");
  await runDueDailyJobs(at("2026-10-08T08:01:00-03:00"));
  await runDueDailyJobs(at("2026-10-09T07:00:00-03:00"));
  await runDueDailyJobs(at("2026-10-15T07:00:00-03:00"));
  assert.equal(launchedOf(n).length, 1);
  assert.equal(textsOf(sent, n).length, 1);
});

test("Card 19 (RN05): gasto fixo do dia 5 cadastrado no dia 8 nao e lancado retroativamente; o proximo mes funciona", async (t) => {
  const { sent } = setup(t);
  const n = user();
  recurring(n, 5, "Luz", "2026-10-08 15:00:00"); // 12h de Sao Paulo no dia 8
  await runDueDailyJobs(at("2026-10-08T16:00:00-03:00"));
  await runDueDailyJobs(at("2026-10-09T07:00:00-03:00"));
  assert.deepEqual(launchedOf(n), []);
  assert.deepEqual(textsOf(sent, n), []);
  await runDueDailyJobs(at("2026-11-05T07:00:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-11-05", description: "Luz" }]);
  assert.deepEqual(textsOf(sent, n), ["🔁 Gasto fixo lançado: R$900.00 — Luz"]);
});

test("Card 19 (RN05): cadastro em UTC depois da meia-noite mas ainda no dia anterior em Sao Paulo conta como cadastrado antes", async (t) => {
  setup(t);
  const n = user();
  // 02:30 UTC do dia 6 = 23:30 do dia 5 em Sao Paulo: ja existia no vencimento do dia 5
  recurring(n, 5, "Internet", "2026-10-06 02:30:00");
  await runDueDailyJobs(at("2026-10-07T07:00:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-10-05", description: "Internet" }]);
});

test("Card 19: gasto fixo do dia 30, servidor parado de 30/09 a 02/10 -- lanca em 02/10 com data 30/09 e o de outubro continua valendo", async (t) => {
  const { sent } = setup(t);
  const n = user();
  recurring(n, 30, "Condominio");
  await runDueDailyJobs(at("2026-10-02T08:00:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-09-30", description: "Condominio" }]);
  assert.match(textsOf(sent, n)[0], /\(lançado com atraso: vencia dia 30\/09\)$/);
  await runDueDailyJobs(at("2026-10-03T07:00:00-03:00"));
  assert.equal(launchedOf(n).length, 1);
  await runDueDailyJobs(at("2026-10-30T07:00:00-03:00"));
  assert.deepEqual(launchedOf(n).map((e) => e.date), ["2026-09-30", "2026-10-30"], "nao pula o gasto de outubro");
  assert.equal(textsOf(sent, n)[1], "🔁 Gasto fixo lançado: R$900.00 — Condominio");
});

test("Card 19: dia 31 em mes curto -- o vencimento recuperado e o dia efetivo (30/04) e o texto de 'ultimo dia do mes' so vale no proprio dia", async (t) => {
  const { sent } = setup(t);
  const n = user();
  const m = user();
  recurring(n, 31, "Agua");
  recurring(m, 31, "Gas");
  await runDueDailyJobs(at("2026-05-02T07:00:00-03:00"));
  assert.deepEqual(launchedOf(n), [{ date: "2026-04-30", description: "Agua" }]);
  assert.equal(textsOf(sent, n)[0], "🔁 Gasto fixo lançado: R$900.00 — Agua\n(lançado com atraso: vencia dia 30/04)");
  assert.ok(!textsOf(sent, m)[0].includes("último dia do mês"), "atrasado nao diz 'hoje e o ultimo dia'");
});

test("Card 19: no proprio dia o texto de 'ultimo dia do mes' continua (rotina que nao perdeu a hora)", async (t) => {
  const { sent } = setup(t);
  const n = user();
  recurring(n, 31, "Agua");
  await runDueDailyJobs(at("2026-04-30T07:00:00-03:00"));
  assert.equal(textsOf(sent, n)[0], "🔁 Gasto fixo lançado (vence todo dia 31; hoje é o último dia do mês): R$900.00 — Agua");
});

test("Card 19: gasto fixo desativado, ja lancado na mao no mes ou fora da janela de 7 dias nao e lancado", async (t) => {
  const { sent } = setup(t);
  const n = user();
  const off = recurring(n, 5, "Desativado");
  deactivateRecurringExpense(n, off.id);
  const manual = recurring(n, 5, "Na mao");
  db.prepare(`UPDATE recurring_expenses SET last_run_month = '2026-10' WHERE id = ?`).run(manual.id);
  recurring(n, 5, "Longe"); // venceu ha 10 dias
  await runDueDailyJobs(at("2026-10-15T08:00:00-03:00"));
  assert.deepEqual(launchedOf(n), []);
  assert.deepEqual(textsOf(sent, n), []);
});

test("Card 19: Evolution fora -- o lancamento e desfeito, a rotina retenta no minuto seguinte e no fim ha um unico gasto e uma unica mensagem", async (t) => {
  const { sent, setFail } = setup(t);
  const n = user();
  const r = recurring(n, 5, "Aluguel");
  const silence = console.error;
  console.error = () => {};
  try {
    setFail(true);
    const first = await runDueDailyJobs(at("2026-10-05T07:00:00-03:00"));
    assert.deepEqual(first.map((s) => [s.status, s.failures]), [["failed", 1]]);
    assert.deepEqual(launchedOf(n), [], "gasto desfeito: nada fica sem aviso");
    assert.equal(getRecurringExpenseById(n, r.id)?.last_run_month, null);
    await runDueDailyJobs(at("2026-10-05T07:01:00-03:00"));
    assert.equal(getJobRun("gastos_fixos", "2026-10-05")?.attempts, 2);
    setFail(false);
    const third = await runDueDailyJobs(at("2026-10-05T07:02:00-03:00"));
    assert.deepEqual(third.map((s) => s.status), ["done"]);
  } finally {
    console.error = silence;
  }
  assert.deepEqual(launchedOf(n), [{ date: "2026-10-05", description: "Aluguel" }]);
  assert.equal(textsOf(sent, n).length, 1);
  await runDueDailyJobs(at("2026-10-05T07:03:00-03:00"));
  assert.equal(launchedOf(n).length, 1);
  assert.equal(getJobRun("gastos_fixos", "2026-10-05")?.attempts, 3);
});

test("Card 19: dois executores ao mesmo tempo (ou dois processos) -- um unico lancamento e uma unica mensagem; cada numero recebe so o seu", async (t) => {
  const { sent } = setup(t);
  const a = user();
  const b = user();
  recurring(a, 5, "Do A");
  recurring(b, 5, "Do B");
  const now = at("2026-10-05T07:30:00-03:00");
  await Promise.all([runDueDailyJobs(now), runDueDailyJobs(now), runDueDailyJobs(now)]);
  assert.deepEqual(launchedOf(a), [{ date: "2026-10-05", description: "Do A" }]);
  assert.deepEqual(launchedOf(b), [{ date: "2026-10-05", description: "Do B" }]);
  assert.deepEqual(textsOf(sent, a), ["🔁 Gasto fixo lançado: R$900.00 — Do A"]);
  assert.deepEqual(textsOf(sent, b), ["🔁 Gasto fixo lançado: R$900.00 — Do B"]);
});

test("Card 19: rotina sem nada pra fazer tambem registra o dia como concluida com 0 itens", async (t) => {
  setup(t);
  await runDueDailyJobs(at("2026-01-02T07:00:00-03:00"));
  const row = getJobRun("gastos_fixos", "2026-01-02");
  assert.deepEqual([row?.status, row?.attempts], ["done", 1]);
});
