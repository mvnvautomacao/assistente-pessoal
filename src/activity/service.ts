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

export function getPendingReminders(limit = 50): PendingReminder[] {
  return db
    .prepare(`SELECT id, to_number, message, due_at FROM reminders WHERE sent = 0 ORDER BY due_at ASC LIMIT ?`)
    .all(limit) as unknown as PendingReminder[];
}
