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

export interface Reminder {
  id: number;
  to_number: string;
  message: string;
  due_at: string;
  sent: number;
}

export function listReminders(toNumber: string): Reminder[] {
  return db
    .prepare(`SELECT id, to_number, message, due_at, sent FROM reminders WHERE to_number = ? ORDER BY due_at DESC`)
    .all(toNumber) as unknown as Reminder[];
}

export function getReminderById(toNumber: string, id: number): Reminder | undefined {
  return db
    .prepare(`SELECT id, to_number, message, due_at, sent FROM reminders WHERE to_number = ? AND id = ?`)
    .get(toNumber, id) as unknown as Reminder | undefined;
}

export function updateReminder(toNumber: string, id: number, params: { message: string; dueAt: string }) {
  db.prepare(`UPDATE reminders SET message = ?, due_at = ?, sent = 0 WHERE to_number = ? AND id = ?`).run(
    params.message,
    params.dueAt,
    toNumber,
    id
  );
}

export function deleteReminder(toNumber: string, id: number) {
  db.prepare(`DELETE FROM reminders WHERE to_number = ? AND id = ?`).run(toNumber, id);
}
