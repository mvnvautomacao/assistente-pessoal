import { db } from "../db";

export function logActivity(fromNumber: string, type: string, summary: string) {
  db.prepare(`INSERT INTO activity_log (from_number, type, summary, created_at) VALUES (?, ?, ?, ?)`).run(
    fromNumber,
    type,
    summary,
    new Date().toISOString()
  );
}

export interface ActivityEntry {
  id: number;
  from_number: string;
  type: string;
  summary: string;
  created_at: string;
}

export function getRecentActivity(limit = 50): ActivityEntry[] {
  return db.prepare(`SELECT * FROM activity_log ORDER BY id DESC LIMIT ?`).all(limit) as unknown as ActivityEntry[];
}

export interface PendingReminder {
  id: number;
  to_number: string;
  message: string;
  due_at: string;
}

// mensagens de numeros nao autorizados (ver src/access/allowlist.ts), pra decidir
// no /admin se vale a pena liberar quem mandou.
export function getRecentBlockedAttempts(limit = 50): ActivityEntry[] {
  return db.prepare(`SELECT * FROM activity_log WHERE type = 'blocked' ORDER BY id DESC LIMIT ?`).all(limit) as unknown as ActivityEntry[];
}

export function getPendingReminders(limit = 50): PendingReminder[] {
  return db
    .prepare(`SELECT id, to_number, message, due_at FROM reminders WHERE sent = 0 ORDER BY due_at ASC LIMIT ?`)
    .all(limit) as unknown as PendingReminder[];
}

// Card 21 (D-12): apaga as linhas mais velhas que `retentionDays` (todos os tipos, inclusive blocked e quedas). 0 ou invalido = nao apaga nada.
// O corte e comparado como texto com o ISO que o logActivity grava (toISOString, sempre UTC e de largura fixa), entao a ordem e a do tempo.
export function purgeActivityLog(retentionDays: number, now: Date): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`DELETE FROM activity_log WHERE created_at < ?`).run(cutoff);
  return Number(result.changes);
}
