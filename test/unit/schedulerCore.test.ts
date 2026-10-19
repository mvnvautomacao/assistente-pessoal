// Card 19 (RF02 a RF04, RN01, RN03, RN08): reivindicacao atomica das rotinas, executor com relogio injetado e batimento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import {
  claimJobRun,
  failJobRun,
  finishJobRun,
  getJobRun,
  listRecentJobRuns,
  markJobRunMissed,
  MAX_ATTEMPTS_PER_DAY,
  resetJobRunsForTests,
  STALE_RUNNING_MS,
} from "../../src/scheduler/jobRuns";
import { beat, detectDowntime, DOWNTIME_LOG_TYPE, DOWNTIME_THRESHOLD_MS, downtimeSummary, getLastBeat, listRecentDowntimes } from "../../src/scheduler/heartbeat";
import { DailyJob, markUnrecoverableRuns, registerDailyJob, resetDailyJobsForTests, runDueDailyJobs } from "../../src/scheduler/dailyJobs";

const at = (iso: string) => new Date(iso);

test("claimJobRun: so uma chamada ganha o dia; concluida nao volta; retentativa so depois de falhar, no maximo 3", () => {
  resetJobRunsForTests();
  const now = at("2026-10-19T07:00:00-03:00");
  assert.equal(claimJobRun("a", "2026-10-19", now), true);
  assert.equal(claimJobRun("a", "2026-10-19", now), false, "segunda chamada no mesmo minuto");
  assert.equal(getJobRun("a", "2026-10-19")?.status, "running");
  finishJobRun("a", "2026-10-19", now, 4);
  assert.deepEqual([getJobRun("a", "2026-10-19")?.status, getJobRun("a", "2026-10-19")?.items], ["done", 4]);
  assert.equal(claimJobRun("a", "2026-10-19", now), false, "concluida nao repete");
  assert.equal(claimJobRun("a", "2026-10-20", now), true, "outro dia e outra execucao");
  assert.equal(claimJobRun("b", "2026-10-19", now), true, "outra rotina no mesmo dia");

  // falhou: retenta ate 3 tentativas
  assert.equal(claimJobRun("c", "2026-10-19", now), true);
  for (let attempt = 1; attempt < MAX_ATTEMPTS_PER_DAY; attempt++) {
    failJobRun("c", "2026-10-19", now, 0);
    assert.equal(claimJobRun("c", "2026-10-19", now), true, `tentativa ${attempt + 1}`);
  }
  assert.equal(getJobRun("c", "2026-10-19")?.attempts, MAX_ATTEMPTS_PER_DAY);
  failJobRun("c", "2026-10-19", now, 0);
  assert.equal(claimJobRun("c", "2026-10-19", now), false, "3 tentativas esgotadas: sem novas ate o dia seguinte");
  assert.equal(getJobRun("c", "2026-10-19")?.status, "failed");
});

test("claimJobRun: execucao 'running' abandonada (processo caiu) e retomada depois do prazo, exceto nas de uma vez so", () => {
  resetJobRunsForTests();
  const start = at("2026-10-19T07:00:00-03:00");
  assert.equal(claimJobRun("d", "2026-10-19", start), true);
  assert.equal(claimJobRun("d", "2026-10-19", new Date(start.getTime() + 60_000)), false, "ainda rodando");
  assert.equal(claimJobRun("d", "2026-10-19", new Date(start.getTime() + STALE_RUNNING_MS + 1000)), true, "abandonada: retoma");

  assert.equal(claimJobRun("e", "2026-10-19", start, { atMostOnce: true }), true);
  assert.equal(claimJobRun("e", "2026-10-19", new Date(start.getTime() + STALE_RUNNING_MS + 1000), { atMostOnce: true }), false, "relatorio abandonado nunca repete");
});

test("markJobRunMissed e listRecentJobRuns", () => {
  resetJobRunsForTests();
  const now = at("2026-10-19T09:00:00-03:00");
  assert.equal(markJobRunMissed("rel", "2026-10-15", now), true);
  assert.equal(markJobRunMissed("rel", "2026-10-15", now), false, "so uma vez");
  assert.equal(getJobRun("rel", "2026-10-15")?.status, "missed");
  assert.equal(claimJobRun("rel", "2026-10-15", now), false, "perdida nao volta");
  claimJobRun("x", "2026-10-19", now);
  const rows = listRecentJobRuns(10);
  assert.equal(rows.length, 2);
  assert.equal(listRecentJobRuns(1).length, 1);
});

test("batimento: queda so conta acima de 5 min e com o relogio andando pra frente; registra no log do dono", () => {
  db.exec(`DELETE FROM scheduler_heartbeat`);
  const t0 = at("2026-10-19T06:58:00-03:00");
  assert.equal(detectDowntime(t0), null, "primeira vez: sem batimento anterior");
  beat(t0);
  assert.equal(getLastBeat()?.getTime(), t0.getTime());
  assert.equal(detectDowntime(new Date(t0.getTime() + 20_000)), null, "reinicio de segundos");
  assert.equal(detectDowntime(new Date(t0.getTime() + DOWNTIME_THRESHOLD_MS)), null, "exatamente 5 min nao e queda");
  assert.equal(detectDowntime(new Date(t0.getTime() - 3600_000)), null, "relogio atrasado nao gera queda");
  const before = listRecentDowntimes(50).length;
  const period = detectDowntime(at("2026-10-19T07:39:00-03:00"));
  assert.ok(period);
  assert.equal(period.minutes, 41);
  assert.equal(downtimeSummary(period), "servidor fora do ar de 19/10 06:58 a 19/10 07:39 (41 min)");
  const logged = listRecentDowntimes(50);
  assert.equal(logged.length, before + 1);
  assert.equal(logged[0].summary, "servidor fora do ar de 19/10 06:58 a 19/10 07:39 (41 min)");
  const row = db.prepare(`SELECT from_number, type FROM activity_log WHERE type = ? ORDER BY id DESC LIMIT 1`).get(DOWNTIME_LOG_TYPE) as { from_number: string; type: string };
  assert.equal(row.type, "downtime");
});

function job(over: Partial<DailyJob> & { name: string }): DailyJob {
  return { time: "07:00", lookbackDays: 0, atMostOnce: false, run: async () => ({ items: 1, failures: 0 }), ...over };
}

test("runDueDailyJobs: antes da hora nao roda; a partir da hora roda uma vez por dia (7h40 conta como a execucao das 7h)", async () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  let runs = 0;
  registerDailyJob(job({ name: "diaria", run: async () => ({ items: ++runs, failures: 0 }) }));
  assert.deepEqual(await runDueDailyJobs(at("2026-10-19T06:59:00-03:00")), []);
  assert.equal(runs, 0);
  const first = await runDueDailyJobs(at("2026-10-19T07:40:00-03:00"));
  assert.deepEqual(first.map((s) => [s.job, s.runDate, s.status]), [["diaria", "2026-10-19", "done"]]);
  assert.deepEqual(await runDueDailyJobs(at("2026-10-19T07:41:00-03:00")), [], "ja executada hoje");
  assert.deepEqual(await runDueDailyJobs(at("2026-10-19T23:59:00-03:00")), []);
  assert.equal(runs, 1);
  assert.equal((await runDueDailyJobs(at("2026-10-20T07:00:00-03:00"))).length, 1, "no dia seguinte roda de novo");
  assert.equal(getJobRun("diaria", "2026-10-19")?.items, 1);
});

test("runDueDailyJobs: dois executores ao mesmo tempo -> uma execucao so", async () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  let runs = 0;
  registerDailyJob(
    job({
      name: "concorrente",
      run: async () => {
        runs++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { items: 1, failures: 0 };
      },
    })
  );
  const now = at("2026-10-19T08:00:00-03:00");
  const [a, b, c] = await Promise.all([runDueDailyJobs(now), runDueDailyJobs(now), runDueDailyJobs(now)]);
  assert.equal(runs, 1);
  assert.equal(a.length + b.length + c.length, 1);
});

test("runDueDailyJobs: falha retenta no minuto seguinte (max 3) e a rotina que lanca erro nao derruba as outras", async () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  let calls = 0;
  registerDailyJob(job({ name: "instavel", run: async () => ({ items: calls++ === 2 ? 2 : 0, failures: calls === 3 ? 0 : 1 }) }));
  registerDailyJob(job({ name: "explode", run: async () => { throw new Error("boom"); } }));
  registerDailyJob(job({ name: "saudavel" }));
  const silence = console.error;
  console.error = () => {};
  try {
    const m1 = await runDueDailyJobs(at("2026-10-19T07:00:00-03:00"));
    assert.deepEqual(m1.map((s) => [s.job, s.status]), [["instavel", "failed"], ["explode", "failed"], ["saudavel", "done"]]);
    const m2 = await runDueDailyJobs(at("2026-10-19T07:01:00-03:00"));
    assert.deepEqual(m2.map((s) => [s.job, s.status]), [["instavel", "failed"], ["explode", "failed"]], "so as que falharam");
    const m3 = await runDueDailyJobs(at("2026-10-19T07:02:00-03:00"));
    assert.deepEqual(m3.map((s) => [s.job, s.status]), [["instavel", "done"], ["explode", "failed"]]);
    assert.deepEqual(await runDueDailyJobs(at("2026-10-19T07:03:00-03:00")), [], "3 tentativas esgotadas / concluidas: nada mais hoje");
  } finally {
    console.error = silence;
  }
  assert.equal(getJobRun("instavel", "2026-10-19")?.attempts, 3);
  assert.equal(getJobRun("instavel", "2026-10-19")?.items, 2, "itens acumulam entre as tentativas");
  assert.equal(getJobRun("explode", "2026-10-19")?.status, "failed");
});

test("runDueDailyJobs: rotina de uma vez so com envio parcial nao repete; sem nenhum envio, tenta de novo", async () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  registerDailyJob(job({ name: "parcial", atMostOnce: true, run: async () => ({ items: 2, failures: 1 }) }));
  registerDailyJob(job({ name: "ninguem", atMostOnce: true, run: async () => ({ items: 0, failures: 2 }) }));
  const silence = console.error;
  console.error = () => {};
  try {
    const out = await runDueDailyJobs(at("2026-10-19T09:00:00-03:00"));
    assert.deepEqual(out.map((s) => [s.job, s.status]), [["parcial", "done"], ["ninguem", "failed"]]);
    const again = await runDueDailyJobs(at("2026-10-19T09:01:00-03:00"));
    assert.deepEqual(again.map((s) => s.job), ["ninguem"]);
  } finally {
    console.error = silence;
  }
});

test("runDueDailyJobs: runDates proprias (recuperacao do dia anterior) e a rotina sem nada a fazer tambem registra o dia", async () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  registerDailyJob(job({ name: "mensal", time: "18:00", runDates: (now) => (now.getUTCDate() === 1 ? ["2026-09-30"] : []), run: async () => ({ items: 0, failures: 0 }) }));
  assert.deepEqual(await runDueDailyJobs(at("2026-10-19T12:00:00-03:00")), []);
  const out = await runDueDailyJobs(at("2026-10-01T12:00:00Z"));
  assert.deepEqual(out.map((s) => [s.runDate, s.status, s.items]), [["2026-09-30", "done", 0]]);
});

test("markUnrecoverableRuns: depois de uma queda, a execucao de uma vez so que nao da mais pra recuperar fica 'perdida'", () => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  registerDailyJob(job({ name: "semanal", time: "09:00", atMostOnce: true }));
  registerDailyJob(job({ name: "janela", time: "07:00", atMostOnce: false }));
  registerDailyJob(job({ name: "mensal", time: "18:00", atMostOnce: true, scheduledOn: (d) => d.endsWith("-30"), recoverable: (_d, today) => today <= "2026-10-02" }));
  claimJobRun("semanal", "2026-10-16", at("2026-10-16T09:00:00-03:00"));
  const period = { from: at("2026-10-15T20:00:00-03:00"), to: at("2026-10-19T07:00:00-03:00"), minutes: 5700 };
  const marked = markUnrecoverableRuns(period, at("2026-10-19T07:00:00-03:00"));
  assert.equal(marked, 3, "semanal de 15, 17 e 18 (o dia 16 tem execucao)");
  assert.equal(getJobRun("semanal", "2026-10-15")?.status, "missed");
  assert.equal(getJobRun("semanal", "2026-10-16")?.status, "running");
  assert.equal(getJobRun("janela", "2026-10-15"), null, "rotina de janela se recupera sozinha");
  assert.equal(markUnrecoverableRuns(period, at("2026-10-19T07:00:00-03:00")), 0, "idempotente");
  const logged = db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE type = 'job_missed'`).get() as { n: number };
  assert.ok(logged.n >= 3);
});

import cron from "node-cron";
import { resetDailyJobRunnerForTests, startDailyJobRunner } from "../../src/scheduler/dailyJobs";

test("startDailyJobRunner: um cron por minuto no fuso de SP, catch-up inicial, batimento e queda no boot; segunda chamada nao duplica", async (t) => {
  resetJobRunsForTests();
  resetDailyJobsForTests();
  resetDailyJobRunnerForTests();
  const calls: { expr: string; timezone?: string }[] = [];
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (expr: string, fn: () => Promise<void>, options?: { timezone?: string }) => {
    calls.push({ expr, timezone: options?.timezone });
    tick = fn;
    return { stop() {} };
  });
  let runs = 0;
  registerDailyJob(job({ name: "sempre-na-hora", time: "00:00", run: async () => ({ items: ++runs, failures: 0 }) }));
  // ultimo batimento ha 30 min: o boot registra a queda
  beat(new Date(Date.now() - 30 * 60 * 1000));
  const downBefore = listRecentDowntimes(50).length;
  startDailyJobRunner({ initialDelayMs: 5 });
  startDailyJobRunner({ initialDelayMs: 5 });
  assert.deepEqual(calls, [{ expr: "* * * * *", timezone: "America/Sao_Paulo" }]);
  assert.equal(listRecentDowntimes(50).length, downBefore + 1);
  assert.ok(Date.now() - (getLastBeat()?.getTime() ?? 0) < 5000, "batimento atualizado no boot");
  await new Promise((resolve) => setTimeout(resolve, 60)); // catch-up inicial
  assert.equal(runs, 1);
  await Promise.all([tick!(), tick!()]); // o ciclo por minuto: uma rotina do dia so roda uma vez
  assert.equal(runs, 1);
  resetDailyJobRunnerForTests();
});
