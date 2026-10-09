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

export function markReminderSent(toNumber: string, id: number) {
  db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ? AND to_number = ?`).run(id, toNumber);
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

// So volta a "nao enviado" (sent = 0) quando o HORARIO muda: editar so o texto de um
// lembrete que ja tocou nao o faz tocar de novo (vale pro painel e pro desfazer tambem).
export function updateReminder(toNumber: string, id: number, params: { message: string; dueAt: string }) {
  const current = getReminderById(toNumber, id);
  if (!current) return;
  const dueChanged = new Date(params.dueAt).getTime() !== new Date(current.due_at).getTime();
  db.prepare(`UPDATE reminders SET message = ?, due_at = ?, sent = ? WHERE to_number = ? AND id = ?`).run(
    params.message,
    params.dueAt,
    dueChanged ? 0 : current.sent,
    toNumber,
    id
  );
}

// adiar um lembrete (e desfazer o adiar): grava o horario E o estado "enviado" exatos
export function rescheduleReminder(toNumber: string, id: number, dueAt: string, sent: 0 | 1) {
  db.prepare(`UPDATE reminders SET due_at = ?, sent = ? WHERE to_number = ? AND id = ?`).run(dueAt, sent, toNumber, id);
}

// lembretes que JA TOCARAM (sent = 1) e cabem numa janela de tempo. Nao ha coluna com a
// hora do envio: o agendador roda a cada minuto, entao due_at e uma boa aproximacao.
// Sem texto: os mais recentes; com texto: so os que batem com ele. Mais recente primeiro.
export function findRecentSentReminders(toNumber: string, query: string | undefined, withinHours: number, limit = 10): Reminder[] {
  const text = query?.trim();
  return db
    .prepare(
      `SELECT id, to_number, message, due_at, sent FROM reminders
       WHERE to_number = ? AND sent = 1
         AND datetime(due_at) <= datetime('now') AND datetime(due_at) >= datetime('now', '-' || ? || ' hours')
         AND (? = '' OR message LIKE ?)
       ORDER BY due_at DESC
       LIMIT ?`
    )
    .all(toNumber, withinHours, text ?? "", `%${text ?? ""}%`, limit) as unknown as Reminder[];
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
