import { db } from "../db";

const DEFAULT_REMINDER_MINUTES = 60;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// contando o principal (events.reminder_minutes), cada evento pode ter no
// maximo esse total de alertas (principal + extras em event_extra_reminders).
export const MAX_REMINDERS_PER_EVENT = 3;

// "1440" -> "1 dia", "120" -> "2 horas", "90" -> "1h30", "45" -> "45 min" --
// mensagens de confirmacao/aviso ficam ilegiveis mostrando direto em minutos
// quando o valor e grande (ex: "1440 min" em vez de "1 dia").
export function formatMinutesBefore(minutes: number): string {
  if (minutes % 1440 === 0 && minutes > 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 dia" : `${days} dias`;
  }
  if (minutes % 60 === 0 && minutes > 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h${String(rest).padStart(2, "0")}`;
  }
  return minutes === 0 ? "na hora" : `${minutes} min`;
}

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
  const current = getEventById(fromNumber, id);
  if (!current) return;
  const end = params.end ?? new Date(new Date(params.start).getTime() + DEFAULT_DURATION_MS).toISOString();
  // So reagenda o aviso quando ele deixa de valer: o INICIO ou a ANTECEDENCIA mudou
  // (reminder_sent volta a 0) -- e os alertas extras so se o INICIO mudou. Editar so
  // titulo, local ou termino nunca reativa um aviso ja enviado (senao o "Daqui a 1
  // hora" chegava de novo no minuto seguinte). A comparacao e a escrita ficam juntas
  // aqui pra valer tambem pro painel e pro desfazer.
  const startChanged = new Date(params.start).getTime() !== new Date(current.start).getTime();
  const reminderChanged = params.reminderMinutes !== current.reminder_minutes;
  const reminderSent = startChanged || reminderChanged ? 0 : current.reminder_sent;
  db.prepare(
    `UPDATE events SET title = ?, start = ?, end = ?, location = ?, reminder_minutes = ?, reminder_sent = ?
     WHERE from_number = ? AND id = ?`
  ).run(params.title, params.start, end, params.location ?? null, params.reminderMinutes, reminderSent, fromNumber, id);
  if (startChanged) db.prepare(`UPDATE event_extra_reminders SET sent = 0 WHERE event_id = ?`).run(id);
}

export function deleteEvent(fromNumber: string, id: number) {
  // confirma que o evento e desse numero ANTES de apagar os extras -- senao um
  // id de evento de outro numero (from_number errado) apagaria os extras dele
  // mesmo sem conseguir apagar o evento em si (que e protegido pelo WHERE abaixo).
  if (!getEventById(fromNumber, id)) return;
  db.prepare(`DELETE FROM event_extra_reminders WHERE event_id = ?`).run(id);
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

// busca textual simples pra resolver "cancela a reuniao com o cliente" ou "muda
// a consulta pra outro dia" -- qualquer evento futuro (passado nao faz sentido
// cancelar/remarcar), sem limite de quantos dias a frente. Um teto artificial
// aqui (existia um de 60 dias antes) trava justamente o caso que mais precisa
// funcionar: corrigir um evento que a IA marcou pra uma data muito distante por
// engano (ver ensureBrazilOffset / correcao do prompt em interpret.ts).
export function findUpcomingEvents(fromNumber: string, query: string): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE from_number = ? AND datetime(start) >= datetime('now')
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

export function markEventReminderSent(fromNumber: string, id: number) {
  db.prepare(`UPDATE events SET reminder_sent = 1 WHERE id = ? AND from_number = ?`).run(id, fromNumber);
}

export interface EventExtraReminder {
  id: number;
  event_id: number;
  minutes_before: number;
  sent: number;
}

// todos os alertas de um evento, principal + extras, ordenados do mais
// distante pro mais proximo do horario do evento (ex: 1 dia antes, depois 2
// horas antes, depois 30 min antes) -- pra mostrar nas confirmacoes.
export function listEventReminderMinutes(fromNumber: string, eventId: number): number[] {
  const event = getEventById(fromNumber, eventId);
  if (!event) return [];
  const extras = db
    .prepare(`SELECT minutes_before FROM event_extra_reminders WHERE event_id = ?`)
    .all(eventId) as { minutes_before: number }[];
  return [event.reminder_minutes, ...extras.map((e) => e.minutes_before)].sort((a, b) => b - a);
}

export type AddEventReminderResult = { ok: true } | { ok: false; reason: "not_found" | "max_reached" | "duplicate" };

// adiciona mais um alerta (ate MAX_REMINDERS_PER_EVENT no total, contando o
// principal). Duplicado (mesmo minutes_before de outro alerta ja existente
// desse evento) nao e permitido -- nao faz sentido avisar 2x na mesma hora.
export function addEventExtraReminder(fromNumber: string, eventId: number, minutesBefore: number): AddEventReminderResult {
  const event = getEventById(fromNumber, eventId);
  if (!event) return { ok: false, reason: "not_found" };
  const current = listEventReminderMinutes(fromNumber, eventId);
  if (current.includes(minutesBefore)) return { ok: false, reason: "duplicate" };
  if (current.length >= MAX_REMINDERS_PER_EVENT) return { ok: false, reason: "max_reached" };
  db.prepare(`INSERT INTO event_extra_reminders (event_id, minutes_before, sent) VALUES (?, ?, 0)`).run(eventId, minutesBefore);
  return { ok: true };
}

export type RemoveEventReminderResult = { ok: true } | { ok: false; reason: "not_found" | "last_one" };

// remove o alerta com esse minutes_before (seja o principal ou um extra). Se
// era o principal e existe pelo menos 1 extra, promove o extra mais proximo
// do evento a novo principal -- um evento sempre precisa ficar com pelo menos
// 1 alerta, nunca zero.
export function removeEventReminder(fromNumber: string, eventId: number, minutesBefore: number): RemoveEventReminderResult {
  const event = getEventById(fromNumber, eventId);
  if (!event) return { ok: false, reason: "not_found" };

  if (event.reminder_minutes === minutesBefore) {
    const nextExtra = db
      .prepare(`SELECT id, minutes_before FROM event_extra_reminders WHERE event_id = ? ORDER BY minutes_before ASC LIMIT 1`)
      .get(eventId) as { id: number; minutes_before: number } | undefined;
    if (!nextExtra) return { ok: false, reason: "last_one" };
    db.prepare(`UPDATE events SET reminder_minutes = ?, reminder_sent = 0 WHERE id = ? AND from_number = ?`).run(
      nextExtra.minutes_before,
      eventId,
      fromNumber
    );
    db.prepare(`DELETE FROM event_extra_reminders WHERE id = ?`).run(nextExtra.id);
    return { ok: true };
  }

  const result = db.prepare(`DELETE FROM event_extra_reminders WHERE event_id = ? AND minutes_before = ?`).run(eventId, minutesBefore);
  return result.changes > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export interface DueExtraEventReminder {
  id: number;
  eventId: number;
  fromNumber: string;
  title: string;
  start: string;
  minutesBefore: number;
}

export function getDueExtraEventReminders(): DueExtraEventReminder[] {
  const rows = db
    .prepare(
      `SELECT er.id AS id, er.event_id AS eventId, ev.from_number AS fromNumber, ev.title AS title, ev.start AS start, er.minutes_before AS minutesBefore
       FROM event_extra_reminders er
       JOIN events ev ON ev.id = er.event_id
       WHERE er.sent = 0 AND datetime('now') >= datetime(ev.start, '-' || er.minutes_before || ' minutes')`
    )
    .all() as unknown as DueExtraEventReminder[];
  return rows;
}

export function markEventExtraReminderSent(id: number) {
  db.prepare(`UPDATE event_extra_reminders SET sent = 1 WHERE id = ?`).run(id);
}
