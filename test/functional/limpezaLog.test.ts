// Card 21, parte 4 (D-12): a limpeza do activity_log roda no executor diario das 3h, uma vez por dia, e aparece em job_runs.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { bootApp } from "../helpers/botApp";
import { db } from "../../src/db";
import { config } from "../../src/config";

const at = (iso: string) => new Date(iso).getTime();
const PHONE = "551100089101";

function setup(t: TestContext) {
  const app = bootApp(t, at("2026-10-20T02:00:00-03:00"));
  const daily = require("../../src/scheduler/dailyJobs") as typeof import("../../src/scheduler/dailyJobs");
  const runs = require("../../src/scheduler/jobRuns") as typeof import("../../src/scheduler/jobRuns");
  const cleanup = require("../../src/activity/cleanupJob") as typeof import("../../src/activity/cleanupJob");
  runs.resetJobRunsForTests();
  daily.resetDailyJobsForTests();
  cleanup.startActivityLogCleanup();
  db.prepare(`DELETE FROM activity_log WHERE from_number = ?`).run(PHONE);
  return { app, daily, runs };
}

function insert(type: string, iso: string) {
  db.prepare(`INSERT INTO activity_log (from_number, type, summary, created_at) VALUES (?, ?, 'x', ?)`).run(PHONE, type, iso);
}
const count = () => (db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE from_number = ?`).get(PHONE) as { n: number }).n;

test("limpeza_log: antes das 3h nao roda; as 3h apaga so o antigo (qualquer tipo), registra em job_runs e nao repete no mesmo dia", async (t) => {
  const { daily, runs } = setup(t);
  const saved = config.activityLogRetentionDays;
  t.after(() => {
    config.activityLogRetentionDays = saved;
  });
  config.activityLogRetentionDays = 90;
  insert("expense", "2026-06-01T10:00:00.000Z");
  insert("blocked", "2026-05-01T10:00:00.000Z");
  insert("downtime", "2026-07-01T10:00:00.000Z");
  insert("expense", "2026-10-10T10:00:00.000Z");

  assert.deepEqual(await daily.runDueDailyJobs(new Date(at("2026-10-20T02:59:00-03:00"))), [], "ainda nao deu 3h");
  const out = await daily.runDueDailyJobs(new Date(at("2026-10-20T03:00:00-03:00")));
  assert.deepEqual(out.map((s) => [s.job, s.status, s.items]), [["limpeza_log", "done", 3]]);
  assert.equal(count(), 1);
  const run = runs.listRecentJobRuns(10).find((r) => r.job === "limpeza_log");
  assert.deepEqual([run?.run_date, run?.status, run?.items], ["2026-10-20", "done", 3]);

  insert("expense", "2026-01-01T10:00:00.000Z");
  assert.deepEqual(await daily.runDueDailyJobs(new Date(at("2026-10-20T15:00:00-03:00"))), [], "uma vez por dia");
  assert.equal(count(), 2);
  const next = await daily.runDueDailyJobs(new Date(at("2026-10-21T03:05:00-03:00")));
  assert.deepEqual(next.map((s) => [s.job, s.items]), [["limpeza_log", 1]], "no dia seguinte apaga o que sobrou");
});

test("limpeza_log com ACTIVITY_LOG_RETENTION_DAYS=0: roda, registra e nao apaga nada", async (t) => {
  const { daily } = setup(t);
  const saved = config.activityLogRetentionDays;
  t.after(() => {
    config.activityLogRetentionDays = saved;
  });
  config.activityLogRetentionDays = 0;
  insert("expense", "2020-01-01T10:00:00.000Z");
  const out = await daily.runDueDailyJobs(new Date(at("2026-10-20T03:00:00-03:00")));
  assert.deepEqual(out.map((s) => [s.job, s.status, s.items]), [["limpeza_log", "done", 0]]);
  assert.equal(count(), 1);
});
