import { db } from "../db";

const DEFAULT_REMINDER_MINUTES = 60;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export interface EventRow {
  id: number;
  from_number: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  reminder_minutes: number;
  reminder_sent: number;
  created_at: string;
}

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

export function getEventById(fromNumber: string, id: number): EventRow | undefined {
  return db.prepare(`SELECT * FROM events WHERE from_number = ? AND id = ?`).get(fromNumber, id) as unknown as
    | EventRow
    | undefined;
}

export function createEvent(params: {
  fromNumber: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  reminderMinutes?: number;
}): EventRow {
  const end = params.end ?? new Date(new Date(params.start).getTime() + DEFAULT_DURATION_MS).toISOString();
  const reminderMinutes = params.reminderMinutes ?? getEventReminderMinutes(params.fromNumber);
  const result = db
    .prepare(
      `INSERT INTO events (from_number, title, start, end, location, reminder_minutes, reminder_sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
    )
    .run(params.fromNumber, params.title, params.start, end, params.location ?? null, reminderMinutes);
  return getEventById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function updateEvent(
  fromNumber: string,
  id: number,
  params: { title: string; start: string; end?: string; location?: string; reminderMinutes: number }
) {
  const end = params.end ?? new Date(new Date(params.start).getTime() + DEFAULT_DURATION_MS).toISOString();
  // reagenda o aviso (reminder_sent volta a 0): se o evento mudou de horario, o aviso
  // anterior nao vale mais.
  db.prepare(
    `UPDATE events SET title = ?, start = ?, end = ?, location = ?, reminder_minutes = ?, reminder_sent = 0
     WHERE from_number = ? AND id = ?`
  ).run(params.title, params.start, end, params.location ?? null, params.reminderMinutes, fromNumber, id);
}

export function deleteEvent(fromNumber: string, id: number) {
  db.prepare(`DELETE FROM events WHERE from_number = ? AND id = ?`).run(fromNumber, id);
}

export function listUpcomingEvents(fromNumber: string, days: number): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE from_number = ? AND datetime(start) >= datetime('now') AND datetime(start) <= datetime('now', '+' || ? || ' days')
       ORDER BY start ASC`
    )
    .all(fromNumber, days) as unknown as EventRow[];
}

// todos os eventos de um mes (pro calendario do dashboard), yearMonth = "YYYY-MM".
// Comparacao por string, sem strftime: como "start" sempre tem offset -03:00
// explicito, comparar direto com os limites do mes (tambem em -03:00 implicito)
// evita normalizacao pra UTC virar o dia/mes errado perto da virada.
export function getEventsForMonth(fromNumber: string, yearMonth: string): EventRow[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return db
    .prepare(`SELECT * FROM events WHERE from_number = ? AND start >= ? AND start < ? ORDER BY start ASC`)
    .all(fromNumber, start, nextMonthStart) as unknown as EventRow[];
}

// busca textual simples pra resolver "cancela a reuniao com o cliente" — so nos
// proximos 60 dias, igual o comportamento antigo baseado no Google Calendar.
export function findUpcomingEvents(fromNumber: string, query: string): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE from_number = ? AND datetime(start) >= datetime('now') AND datetime(start) <= datetime('now', '+60 days')
         AND title LIKE ?
       ORDER BY start ASC
       LIMIT 10`
    )
    .all(fromNumber, `%${query}%`) as unknown as EventRow[];
}

export function getDueEventReminders(): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE reminder_sent = 0 AND datetime('now') >= datetime(start, '-' || reminder_minutes || ' minutes')`
    )
    .all() as unknown as EventRow[];
}

export function markEventReminderSent(id: number) {
  db.prepare(`UPDATE events SET reminder_sent = 1 WHERE id = ?`).run(id);
}
