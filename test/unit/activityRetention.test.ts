// Card 21, parte 4 (D-12, RN17): retencao do activity_log -- leitura da variavel, limpeza por data (ISO armazenado), indice e a linha no /admin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { DEFAULT_ACTIVITY_LOG_RETENTION_DAYS, parseRetentionDays, retentionLabel } from "../../src/activity/retention";
import { logActivity, purgeActivityLog } from "../../src/activity/service";
import { activityLogCleanupJob, ACTIVITY_LOG_CLEANUP_JOB_NAME } from "../../src/activity/cleanupJob";
import { renderSchedulerSection } from "../../src/admin";
import { config } from "../../src/config";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000 + extraMs).toISOString();
const PHONE = "551100089001";

function insert(type: string, createdAt: string, summary = "x") {
  db.prepare(`INSERT INTO activity_log (from_number, type, summary, created_at) VALUES (?, ?, ?, ?)`).run(PHONE, type, summary, createdAt);
}
const count = () => (db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE from_number = ?`).get(PHONE) as { n: number }).n;
const reset = () => db.prepare(`DELETE FROM activity_log WHERE from_number = ?`).run(PHONE);

test("parseRetentionDays: padrao 90; '0' desliga; vazio, texto, negativo e decimal voltam pra 90", () => {
  assert.equal(DEFAULT_ACTIVITY_LOG_RETENTION_DAYS, 90);
  assert.equal(parseRetentionDays(undefined), 90);
  assert.equal(parseRetentionDays(""), 90);
  assert.equal(parseRetentionDays("  "), 90);
  assert.equal(parseRetentionDays("30"), 30);
  assert.equal(parseRetentionDays(" 365 "), 365);
  assert.equal(parseRetentionDays("0"), 0);
  for (const bad of ["abc", "-5", "1.5", "10 dias", "1e3", "99999999999999999999"]) assert.equal(parseRetentionDays(bad), 90, bad);
});

test("retentionLabel: dias ou 'sem limite'", () => {
  assert.equal(retentionLabel(90), "90 dias");
  assert.equal(retentionLabel(0), "sem limite (limpeza desligada)");
});

test("purgeActivityLog: apaga so o que passou do corte, de todos os tipos (inclusive blocked e queda); o corte exato fica", () => {
  reset();
  insert("expense", daysAgo(91));
  insert("blocked", daysAgo(120), "numero nao autorizado");
  insert("downtime", daysAgo(200), "fora do ar");
  insert("expense", daysAgo(90, -1)); // 1 ms mais velho que o corte: sai
  insert("expense", daysAgo(90)); // exatamente no corte: fica (< e nao <=)
  insert("blocked", daysAgo(10));
  insert("expense", daysAgo(0));
  assert.equal(purgeActivityLog(90, NOW), 4);
  assert.equal(count(), 3);
  const types = (db.prepare(`SELECT type FROM activity_log WHERE from_number = ? ORDER BY id`).all(PHONE) as { type: string }[]).map((r) => r.type);
  assert.deepEqual(types, ["expense", "blocked", "expense"]);
  assert.equal(purgeActivityLog(90, NOW), 0, "segunda vez nao acha mais nada");
});

test("purgeActivityLog: retencao 0, negativa ou invalida nao apaga nada; retencao curta apaga mais", () => {
  reset();
  insert("expense", daysAgo(400));
  insert("expense", daysAgo(5));
  assert.equal(purgeActivityLog(0, NOW), 0);
  assert.equal(purgeActivityLog(-1, NOW), 0);
  assert.equal(purgeActivityLog(Number.NaN, NOW), 0);
  assert.equal(count(), 2);
  assert.equal(purgeActivityLog(3, NOW), 2);
  assert.equal(count(), 0);
});

test("a comparacao usa o ISO que o proprio logActivity grava (linha recem-criada nunca e apagada)", () => {
  reset();
  logActivity(PHONE, "expense", "agora");
  assert.equal(purgeActivityLog(1, new Date()), 0);
  assert.equal(count(), 1);
  assert.equal(purgeActivityLog(1, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)), 1, "dois dias depois, passa do corte de 1 dia");
  assert.equal(count(), 0);
});

test("existe indice em activity_log(created_at) e a coluna pro corte e a de sempre", () => {
  const index = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_activity_log_created_at'`).get();
  assert.ok(index);
  const columns = (db.prepare(`PRAGMA index_info(idx_activity_log_created_at)`).all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(columns, ["created_at"]);
});

test("rotina limpeza_log: 3h, uma vez so por dia, usa a retencao da config e conta o que apagou", async () => {
  assert.equal(ACTIVITY_LOG_CLEANUP_JOB_NAME, "limpeza_log");
  assert.equal(activityLogCleanupJob.time, "03:00");
  assert.equal(activityLogCleanupJob.atMostOnce, true);
  reset();
  insert("expense", daysAgo(100));
  insert("expense", daysAgo(1));
  const saved = config.activityLogRetentionDays;
  try {
    config.activityLogRetentionDays = 90;
    const result = await activityLogCleanupJob.run({ runDate: "2026-10-20", today: "2026-10-20", now: NOW });
    assert.deepEqual(result, { items: 1, failures: 0 });
    config.activityLogRetentionDays = 0;
    insert("expense", daysAgo(500));
    assert.deepEqual(await activityLogCleanupJob.run({ runDate: "2026-10-20", today: "2026-10-20", now: NOW }), { items: 0, failures: 0 });
    assert.equal(count(), 2, "retencao 0: nao apagou nada");
  } finally {
    config.activityLogRetentionDays = saved;
  }
});

test("/admin: a secao de rotinas mostra a retencao e o nome legivel da limpeza", () => {
  const html = renderSchedulerSection(
    [{ job: "limpeza_log", run_date: "2026-10-20", status: "done", items: 3, attempts: 1, started_at: "2026-10-20T06:00:00.000Z", finished_at: "2026-10-20T06:00:01.000Z" }],
    [],
    90
  );
  assert.match(html, /Limpeza do log de atividade \(3h\)/);
  assert.match(html, /Log de atividade guardado por: 90 dias/);
  assert.match(renderSchedulerSection([], [], 0), /sem limite \(limpeza desligada\)/);
  assert.match(renderSchedulerSection([], []), new RegExp(`guardado por: ${retentionLabel(config.activityLogRetentionDays).replace(/[()]/g, "\$&")}`));
});
