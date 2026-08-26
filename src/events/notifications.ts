import { db } from "../db";

const DEFAULT_REMINDER_MINUTES = 60;

export function getEventReminderMinutes(fromNumber: string): number {
  const row = db.prepare(`SELECT event_reminder_minutes FROM user_settings WHERE from_number = ?`).get(fromNumber) as
    | { event_reminder_minutes: number }
    | undefined;
  return row?.event_reminder_minutes ?? DEFAULT_REMINDER_MINUTES;
}

export function setEventReminderMinutes(fromNumber: string, minutes: number) {
  db.prepare(
    `INSERT INTO user_settings (from_number, event_reminder_minutes) VALUES (?, ?)
     ON CONFLICT(from_number) DO UPDATE SET event_reminder_minutes = excluded.event_reminder_minutes`
  ).run(fromNumber, minutes);
}

export interface EventReminder {
  id: number;
  event_id: string;
  from_number: string;
  title: string;
  event_start: string;
  reminder_minutes: number;
  notified: number;
}

// chamado toda vez que um evento e criado ou editado (via WhatsApp ou dashboard):
// grava/atualiza quando avisar, e reseta o "ja avisado" (evento mudou de horario,
// merece um aviso novo)
export function upsertEventReminder(params: {
  eventId: string;
  fromNumber: string;
  title: string;
  eventStart: string;
  reminderMinutes: number;
}) {
  db.prepare(
    `INSERT INTO event_reminders (event_id, from_number, title, event_start, reminder_minutes, notified)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(event_id) DO UPDATE SET
       from_number = excluded.from_number,
       title = excluded.title,
       event_start = excluded.event_start,
       reminder_minutes = excluded.reminder_minutes,
       notified = 0`
  ).run(params.eventId, params.fromNumber, params.title, params.eventStart, params.reminderMinutes);
}

export function deleteEventReminder(eventId: string) {
  db.prepare(`DELETE FROM event_reminders WHERE event_id = ?`).run(eventId);
}

export function getEventReminderByEventId(eventId: string): EventReminder | undefined {
  return db.prepare(`SELECT * FROM event_reminders WHERE event_id = ?`).get(eventId) as unknown as
    | EventReminder
    | undefined;
}

export function getDueEventReminders(): EventReminder[] {
  return db
    .prepare(
      `SELECT * FROM event_reminders
       WHERE notified = 0 AND datetime('now') >= datetime(event_start, '-' || reminder_minutes || ' minutes')`
    )
    .all() as unknown as EventReminder[];
}

export function markEventReminderNotified(id: number) {
  db.prepare(`UPDATE event_reminders SET notified = 1 WHERE id = ?`).run(id);
}
