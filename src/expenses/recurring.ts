import { db } from "../db";

export interface RecurringExpense {
  id: number;
  from_number: string;
  description: string;
  amount: number;
  category_id: number | null;
  payment_method_id: number | null;
  day_of_month: number;
  active: number;
  last_run_month: string | null;
  created_at: string;
}

export function createRecurringExpense(params: {
  fromNumber: string;
  description: string;
  amount: number;
  categoryId: number | null;
  paymentMethodId: number | null;
  dayOfMonth: number;
}): RecurringExpense {
  const result = db
    .prepare(
      `INSERT INTO recurring_expenses (from_number, description, amount, category_id, payment_method_id, day_of_month, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`
    )
    .run(params.fromNumber, params.description, params.amount, params.categoryId, params.paymentMethodId, params.dayOfMonth);
  return getRecurringExpenseById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function getRecurringExpenseById(fromNumber: string, id: number): RecurringExpense | null {
  const row = db.prepare(`SELECT * FROM recurring_expenses WHERE id = ? AND from_number = ?`).get(id, fromNumber) as
    | RecurringExpense
    | undefined;
  return row ?? null;
}

export function listRecurringExpenses(fromNumber: string): RecurringExpense[] {
  return db
    .prepare(`SELECT * FROM recurring_expenses WHERE from_number = ? AND active = 1 ORDER BY day_of_month ASC`)
    .all(fromNumber) as unknown as RecurringExpense[];
}

export function deactivateRecurringExpense(fromNumber: string, id: number): boolean {
  const result = db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
}

export function findActiveRecurringExpenseByDescription(fromNumber: string, query: string): RecurringExpense | null {
  const row = db
    .prepare(
      `SELECT * FROM recurring_expenses WHERE from_number = ? AND active = 1 AND LOWER(description) LIKE ? ORDER BY id DESC LIMIT 1`
    )
    .get(fromNumber, `%${query.trim().toLowerCase()}%`) as RecurringExpense | undefined;
  return row ?? null;
}

export function markRecurringExpenseRunForMonth(id: number, yearMonth: string) {
  db.prepare(`UPDATE recurring_expenses SET last_run_month = ? WHERE id = ?`).run(yearMonth, id);
}

// gastos fixos ativos cujo dia bate com "hoje" (SP) e que ainda nao foram lancados
// nesse mes. day_of_month maior que a quantidade de dias do mes atual (ex: 31 num
// mes de 30 dias) cai automaticamente no ultimo dia do mes, pra nao pular o lancamento.
export function getDueRecurringExpenses(todayDate: string): RecurringExpense[] {
  const [year, month, day] = todayDate.split("-").map(Number);
  const yearMonth = todayDate.slice(0, 7);
  const daysInThisMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isLastDayOfMonth = day === daysInThisMonth;

  const candidates = db
    .prepare(`SELECT * FROM recurring_expenses WHERE active = 1 AND (last_run_month IS NULL OR last_run_month != ?)`)
    .all(yearMonth) as unknown as RecurringExpense[];

  return candidates.filter((r) => r.day_of_month === day || (isLastDayOfMonth && r.day_of_month > daysInThisMonth));
}
