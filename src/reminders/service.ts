import { db } from "../db";

export function createReminder(toNumber: string, message: string, dueAt: string): number {
  const result = db
    .prepare(`INSERT INTO reminders (to_number, message, due_at) VALUES (?, ?, ?)`)
    .run(toNumber, message, dueAt);
  return Number(result.lastInsertRowid);
}

export function getDueReminders() {
  return db
    .prepare(`SELECT id, to_number, message FROM reminders WHERE sent = 0 AND datetime(due_at) <= datetime('now')`)
    .all() as { id: number; to_number: string; message: string }[];
}

export function markReminderSent(id: number) {
  db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`).run(id);
}

// SEGURANCA: sempre filtra por to_number -- sem isso, o relatorio de agenda de
// um numero vazaria os lembretes de TODOS os numeros do sistema (bug real
// encontrado em producao: o "case report" do router chamava essa funcao sem
// passar o numero).
export function getRemindersWithinDays(toNumber: string, days: number) {
  const limitDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT id, to_number, message, due_at FROM reminders WHERE to_number = ? AND sent = 0 AND datetime(due_at) <= datetime(?) ORDER BY due_at ASC`
    )
    .all(toNumber, limitDate) as { id: number; to_number: string; message: string; due_at: string }[];
}

// lembretes (ainda nao enviados) de um mes especifico -- pra "exibir minha
// agenda de novembro", que precisa de um mes-alvo, nao "proximos X dias" a
// partir de agora. Comparacao por string com os limites do mes (igual
// getEventsForMonth em events/service.ts), ja que due_at sempre tem o offset
// -03:00 explicito (ver ensureBrazilOffset em timeSP.ts).
export function getRemindersForMonth(toNumber: string, yearMonth: string): Reminder[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT id, to_number, message, due_at, sent FROM reminders
       WHERE to_number = ? AND sent = 0 AND due_at >= ? AND due_at < ?
       ORDER BY due_at ASC`
    )
    .all(toNumber, start, nextMonthStart) as unknown as Reminder[];
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

// busca textual simples pra resolver "muda o lembrete do remedio pra amanha" --
// so lembretes ainda nao enviados, igual findUpcomingEvents faz pra eventos.
export function findPendingRemindersByText(toNumber: string, query: string): Reminder[] {
  return db
    .prepare(
      `SELECT id, to_number, message, due_at, sent FROM reminders
       WHERE to_number = ? AND sent = 0 AND message LIKE ?
       ORDER BY due_at ASC
       LIMIT 10`
    )
    .all(toNumber, `%${query}%`) as unknown as Reminder[];
}
