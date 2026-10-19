// Batimento do agendador (Card 19): a cada minuto grava "estou vivo". Ao subir, se o ultimo batimento e velho demais, o
// periodo fora do ar vira uma linha do log (type "downtime") do dono -- nunca silencioso.
import { db } from "../db";
import { config } from "../config";
import { logActivity } from "../activity/service";
import { spDateString, spTimeString } from "../timeSP";

// fora do ar por mais que isso conta como queda (um reinicio de poucos segundos nao)
export const DOWNTIME_THRESHOLD_MS = 5 * 60 * 1000;
export const DOWNTIME_LOG_TYPE = "downtime";

export interface DowntimePeriod {
  from: Date;
  to: Date;
  minutes: number;
}

export function getLastBeat(): Date | null {
  const row = db.prepare(`SELECT last_beat FROM scheduler_heartbeat WHERE id = 1`).get() as { last_beat: string } | undefined;
  if (!row) return null;
  const date = new Date(row.last_beat);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function beat(now: Date) {
  db.prepare(`INSERT INTO scheduler_heartbeat (id, last_beat) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_beat = excluded.last_beat`).run(now.toISOString());
}

// "19/10 06:58"
function spStamp(date: Date): string {
  const [, month, day] = spDateString(date).split("-");
  return `${day}/${month} ${spTimeString(date)}`;
}

export function downtimeSummary(period: DowntimePeriod): string {
  return `servidor fora do ar de ${spStamp(period.from)} a ${spStamp(period.to)} (${period.minutes} min)`;
}

// Chamar ANTES do primeiro batimento da execucao. So conta se agora e depois do ultimo batimento e a diferenca passa do limite
// (relogio atrasado ou adiantado nao gera queda falsa).
export function detectDowntime(now: Date): DowntimePeriod | null {
  const last = getLastBeat();
  if (!last) return null;
  const gap = now.getTime() - last.getTime();
  if (gap <= DOWNTIME_THRESHOLD_MS) return null;
  const period: DowntimePeriod = { from: last, to: now, minutes: Math.round(gap / 60000) };
  logActivity(config.myWhatsappNumber, DOWNTIME_LOG_TYPE, downtimeSummary(period));
  console.warn(`[agendador] ${downtimeSummary(period)}`);
  return period;
}

export function listRecentDowntimes(limit = 10): { summary: string; created_at: string }[] {
  return db
    .prepare(`SELECT summary, created_at FROM activity_log WHERE type = ? ORDER BY id DESC LIMIT ?`)
    .all(DOWNTIME_LOG_TYPE, limit) as unknown as { summary: string; created_at: string }[];
}
