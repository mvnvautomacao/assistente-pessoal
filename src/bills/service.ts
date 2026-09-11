import { db } from "../db";

export interface BillAlert {
  id: number;
  from_number: string;
  name: string;
  day_of_month: number;
  active: number;
  last_asked_date: string | null;
  confirmed_month: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export function createBillAlert(params: { fromNumber: string; name: string; dayOfMonth: number }): BillAlert {
  const result = db
    .prepare(`INSERT INTO bill_alerts (from_number, name, day_of_month, active, created_at) VALUES (?, ?, ?, 1, datetime('now'))`)
    .run(params.fromNumber, params.name, params.dayOfMonth);
  return getBillAlertById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function getBillAlertById(fromNumber: string, id: number): BillAlert | null {
  const row = db.prepare(`SELECT * FROM bill_alerts WHERE id = ? AND from_number = ?`).get(id, fromNumber) as BillAlert | undefined;
  return row ?? null;
}

export function listBillAlerts(fromNumber: string): BillAlert[] {
  return db
    .prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1 ORDER BY day_of_month ASC`)
    .all(fromNumber) as unknown as BillAlert[];
}

export function deactivateBillAlert(fromNumber: string, id: number): boolean {
  const result = db.prepare(`UPDATE bill_alerts SET active = 0 WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
}

export function findActiveBillAlertByName(fromNumber: string, query: string): BillAlert | null {
  const row = db
    .prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1 AND LOWER(name) LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(fromNumber, `%${query.trim().toLowerCase()}%`) as BillAlert | undefined;
  return row ?? null;
}

export function markBillAlertAsked(id: number, todayDate: string) {
  db.prepare(`UPDATE bill_alerts SET last_asked_date = ? WHERE id = ?`).run(todayDate, id);
}

// usuario respondeu que ja pagou: fecha o ciclo desse mes (nao pergunta mais
// ate o dia configurado voltar a bater, no mes seguinte) e limpa qualquer soneca pendente.
export function confirmBillAlertPaid(id: number, yearMonth: string) {
  db.prepare(`UPDATE bill_alerts SET confirmed_month = ?, snoozed_until = NULL WHERE id = ?`).run(yearMonth, id);
}

// usuario pediu pra lembrar de novo amanha -- guarda ate quando adiar, sem mexer
// em last_asked_date (assim nao pergunta 2x no mesmo dia mesmo se o cron rodar de novo).
export function snoozeBillAlert(id: number, untilDate: string) {
  db.prepare(`UPDATE bill_alerts SET snoozed_until = ? WHERE id = ?`).run(untilDate, id);
}

// alertas ativos que precisam perguntar "ja pagou?" hoje: bateu o dia configurado
// (com o mesmo fallback de ultimo-dia-do-mes de getDueRecurringExpenses), OU a
// soneca de "lembra amanha" venceu -- e ainda nao foi confirmado nem perguntado hoje.
export function getDueBillAlerts(todayDate: string): BillAlert[] {
  const [year, month, day] = todayDate.split("-").map(Number);
  const yearMonth = todayDate.slice(0, 7);
  const daysInThisMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isLastDayOfMonth = day === daysInThisMonth;

  const candidates = db
    .prepare(
      `SELECT * FROM bill_alerts
       WHERE active = 1
         AND (confirmed_month IS NULL OR confirmed_month != ?)
         AND (last_asked_date IS NULL OR last_asked_date != ?)`
    )
    .all(yearMonth, todayDate) as unknown as BillAlert[];

  return candidates.filter((b) => {
    if (b.snoozed_until && b.snoozed_until <= todayDate) return true;
    if (b.snoozed_until && b.snoozed_until > todayDate) return false;
    return b.day_of_month === day || (isLastDayOfMonth && b.day_of_month > daysInThisMonth);
  });
}
