import { db } from "../db";

export function createReminder(toNumber: string, message: string, dueAt: string) {
  db.prepare(`INSERT INTO reminders (to_number, message, due_at) VALUES (?, ?, ?)`).run(toNumber, message, dueAt);
}

export function getDueReminders() {
  return db
    .prepare(`SELECT id, to_number, message FROM reminders WHERE sent = 0 AND datetime(due_at) <= datetime('now')`)
    .all() as { id: number; to_number: string; message: string }[];
}

export function markReminderSent(id: number) {
  db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`).run(id);
}

export function getRemindersWithinDays(days: number) {
  const limitDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT id, to_number, message, due_at FROM reminders WHERE sent = 0 AND datetime(due_at) <= datetime(?) ORDER BY due_at ASC`
    )
    .all(limitDate) as { id: number; to_number: string; message: string; due_at: string }[];
}
