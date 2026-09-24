import { db } from "../db";
import { spDateString, addDaysToDateString } from "../timeSP";

export interface BillAlert {
  id: number;
  from_number: string;
  name: string;
  recurrence_type: "day_of_month" | "interval";
  day_of_month: number; // so relevante quando recurrence_type = "day_of_month"
  interval_days: number | null; // so relevante quando recurrence_type = "interval"
  next_due_date: string | null; // so relevante quando recurrence_type = "interval"
  active: number;
  last_asked_date: string | null;
  confirmed_month: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export type CreateBillAlertParams =
  | { fromNumber: string; name: string; dayOfMonth: number }
  | { fromNumber: string; name: string; intervalDays: number };

export function createBillAlert(params: CreateBillAlertParams): BillAlert {
  const isInterval = "intervalDays" in params;
  const nextDueDate = isInterval ? addDaysToDateString(spDateString(), params.intervalDays) : null;
  const result = db
    .prepare(
      `INSERT INTO bill_alerts (from_number, name, recurrence_type, day_of_month, interval_days, next_due_date, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`
    )
    .run(
      params.fromNumber,
      params.name,
      isInterval ? "interval" : "day_of_month",
      isInterval ? 1 : params.dayOfMonth, // placeholder ignorado quando e por intervalo
      isInterval ? params.intervalDays : null,
      nextDueDate
    );
  return getBillAlertById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function getBillAlertById(fromNumber: string, id: number): BillAlert | null {
  const row = db.prepare(`SELECT * FROM bill_alerts WHERE id = ? AND from_number = ?`).get(id, fromNumber) as BillAlert | undefined;
  return row ?? null;
}

export function listBillAlerts(fromNumber: string): BillAlert[] {
  return db
    .prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1 ORDER BY id ASC`)
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

export function markBillAlertAsked(fromNumber: string, id: number, todayDate: string) {
  db.prepare(`UPDATE bill_alerts SET last_asked_date = ? WHERE id = ? AND from_number = ?`).run(todayDate, id, fromNumber);
}

// usuario respondeu que ja fez: por dia fixo do mes, fecha o ciclo desse mes
// (confirmed_month) -- por intervalo, reinicia a contagem a partir de HOJE
// (next_due_date = hoje + interval_days), nao da data que era o vencimento
// original. Nas duas recorrencias, limpa qualquer soneca pendente.
export function confirmBillAlertPaid(fromNumber: string, id: number, todayDate: string) {
  const bill = db.prepare(`SELECT * FROM bill_alerts WHERE id = ? AND from_number = ?`).get(id, fromNumber) as BillAlert | undefined;
  if (!bill) return;
  if (bill.recurrence_type === "interval") {
    const nextDueDate = addDaysToDateString(todayDate, bill.interval_days ?? 0);
    db.prepare(`UPDATE bill_alerts SET next_due_date = ?, snoozed_until = NULL WHERE id = ? AND from_number = ?`).run(nextDueDate, id, fromNumber);
    return;
  }
  db.prepare(`UPDATE bill_alerts SET confirmed_month = ?, snoozed_until = NULL WHERE id = ? AND from_number = ?`).run(
    todayDate.slice(0, 7),
    id,
    fromNumber
  );
}

// usuario pediu pra lembrar de novo amanha -- guarda ate quando adiar, sem mexer
// em last_asked_date (assim nao pergunta 2x no mesmo dia mesmo se o cron rodar de novo).
// Vale igual pras duas recorrencias.
export function snoozeBillAlert(fromNumber: string, id: number, untilDate: string) {
  db.prepare(`UPDATE bill_alerts SET snoozed_until = ? WHERE id = ? AND from_number = ?`).run(untilDate, id, fromNumber);
}

// alertas ativos que precisam perguntar "ja fez?" hoje: pra dia fixo do mes,
// bateu o dia configurado (com o mesmo fallback de ultimo-dia-do-mes de
// getDueRecurringExpenses) e ainda nao foi confirmado nesse mes; pra
// intervalo, a data calculada (next_due_date) ja chegou. Nas duas, uma soneca
// de "lembra amanha" ainda pendente manda (ou nao) direto, sem olhar o resto.
export function getDueBillAlerts(todayDate: string): BillAlert[] {
  const [year, month, day] = todayDate.split("-").map(Number);
  const yearMonth = todayDate.slice(0, 7);
  const daysInThisMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isLastDayOfMonth = day === daysInThisMonth;

  const candidates = db
    .prepare(`SELECT * FROM bill_alerts WHERE active = 1 AND (last_asked_date IS NULL OR last_asked_date != ?)`)
    .all(todayDate) as unknown as BillAlert[];

  return candidates.filter((b) => {
    if (b.snoozed_until) return b.snoozed_until <= todayDate;

    if (b.recurrence_type === "interval") {
      return !!b.next_due_date && b.next_due_date <= todayDate;
    }

    if (b.confirmed_month === yearMonth) return false;
    return b.day_of_month === day || (isLastDayOfMonth && b.day_of_month > daysInThisMonth);
  });
}
