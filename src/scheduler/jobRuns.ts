// Registro das execucoes das rotinas diarias (Card 19): uma linha por (rotina, dia). A reivindicacao (claim) e atomica --
// duas execucoes ao mesmo tempo (dois "ticks" ou dois processos no mesmo volume) nunca rodam a mesma rotina no mesmo dia.
import { db } from "../db";

export const MAX_ATTEMPTS_PER_DAY = 3;
// 'running' parado ha mais que isso e de um processo que caiu no meio da rotina
export const STALE_RUNNING_MS = 15 * 60 * 1000;

export type JobStatus = "running" | "done" | "failed" | "missed";

export interface JobRun {
  job: string;
  run_date: string;
  started_at: string | null;
  finished_at: string | null;
  status: JobStatus;
  attempts: number;
  items: number;
}

export interface ClaimOptions {
  // relatorios: no maximo uma vez -- uma execucao 'running' abandonada nunca e repetida (quem nao recebeu fica sem, ninguem recebe em dobro)
  atMostOnce?: boolean;
}

// true = esta chamada ganhou a execucao (primeira vez, retentativa de uma que falhou ou execucao abandonada)
export function claimJobRun(job: string, runDate: string, now: Date, options: ClaimOptions = {}): boolean {
  const startedAt = now.toISOString();
  const inserted = db
    .prepare(`INSERT OR IGNORE INTO job_runs (job, run_date, started_at, status, attempts, items) VALUES (?, ?, ?, 'running', 1, 0)`)
    .run(job, runDate, startedAt);
  if (inserted.changes === 1) return true;

  const retried = db
    .prepare(
      `UPDATE job_runs SET status = 'running', started_at = ?, finished_at = NULL, attempts = attempts + 1
       WHERE job = ? AND run_date = ? AND status = 'failed' AND attempts < ?`
    )
    .run(startedAt, job, runDate, MAX_ATTEMPTS_PER_DAY);
  if (retried.changes === 1) return true;

  if (options.atMostOnce) return false;
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const reclaimed = db
    .prepare(
      `UPDATE job_runs SET started_at = ?, attempts = attempts + 1
       WHERE job = ? AND run_date = ? AND status = 'running' AND started_at <= ? AND attempts < ?`
    )
    .run(startedAt, job, runDate, staleBefore, MAX_ATTEMPTS_PER_DAY);
  return reclaimed.changes === 1;
}

export function finishJobRun(job: string, runDate: string, now: Date, items: number) {
  db.prepare(`UPDATE job_runs SET status = 'done', finished_at = ?, items = items + ? WHERE job = ? AND run_date = ?`).run(now.toISOString(), items, job, runDate);
}

export function failJobRun(job: string, runDate: string, now: Date, items = 0) {
  db.prepare(`UPDATE job_runs SET status = 'failed', finished_at = ?, items = items + ? WHERE job = ? AND run_date = ?`).run(now.toISOString(), items, job, runDate);
}

// execucao que nao da mais pra recuperar (servidor fora o dia todo e fora da janela): fica registrada como perdida
export function markJobRunMissed(job: string, runDate: string, now: Date): boolean {
  const result = db
    .prepare(`INSERT OR IGNORE INTO job_runs (job, run_date, started_at, finished_at, status, attempts, items) VALUES (?, ?, NULL, ?, 'missed', 0, 0)`)
    .run(job, runDate, now.toISOString());
  return result.changes === 1;
}

export function getJobRun(job: string, runDate: string): JobRun | null {
  const row = db.prepare(`SELECT * FROM job_runs WHERE job = ? AND run_date = ?`).get(job, runDate) as JobRun | undefined;
  return row ?? null;
}

export function listRecentJobRuns(limit = 30): JobRun[] {
  return db
    .prepare(`SELECT * FROM job_runs ORDER BY COALESCE(started_at, finished_at) DESC, run_date DESC, job ASC LIMIT ?`)
    .all(limit) as unknown as JobRun[];
}

export function resetJobRunsForTests() {
  db.exec(`DELETE FROM job_runs`);
}
