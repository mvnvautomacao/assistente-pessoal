import { db } from "../db";
import { filterByQuery, SEARCH_SCAN_LIMIT } from "../text/search";
import { addDaysToDateString, effectiveDayOfMonth, sqliteUtcToSpDate } from "../timeSP";

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

// atualiza so os campos passados, mantendo o resto -- nao mexe em
// last_run_month mesmo trocando o dia do mes (nao "reabre" o lancamento desse mes).
export function updateRecurringExpense(
  fromNumber: string,
  id: number,
  changes: { description?: string; amount?: number; categoryId?: number | null; paymentMethodId?: number | null; dayOfMonth?: number }
): RecurringExpense | null {
  const current = getRecurringExpenseById(fromNumber, id);
  if (!current) return null;
  const description = changes.description ?? current.description;
  const amount = changes.amount ?? current.amount;
  const categoryId = changes.categoryId !== undefined ? changes.categoryId : current.category_id;
  const paymentMethodId = changes.paymentMethodId !== undefined ? changes.paymentMethodId : current.payment_method_id;
  const dayOfMonth = changes.dayOfMonth ?? current.day_of_month;
  db.prepare(
    `UPDATE recurring_expenses SET description = ?, amount = ?, category_id = ?, payment_method_id = ?, day_of_month = ? WHERE id = ? AND from_number = ?`
  ).run(description, amount, categoryId, paymentMethodId, dayOfMonth, id, fromNumber);
  return getRecurringExpenseById(fromNumber, id);
}

export function deactivateRecurringExpense(fromNumber: string, id: number): boolean {
  const result = db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
}

export function findActiveRecurringExpenseByDescription(fromNumber: string, query: string): RecurringExpense | null {
  const rows = db
    .prepare(`SELECT * FROM recurring_expenses WHERE from_number = ? AND active = 1 ORDER BY id DESC LIMIT ?`)
    .all(fromNumber, SEARCH_SCAN_LIMIT) as unknown as RecurringExpense[];
  return filterByQuery(rows, (r) => r.description, query, 1)[0] ?? null;
}

// TODOS os gastos fixos ativos cujo nome bate com o texto (sem diferenciar acento
// nem maiuscula), na ordem do dia do mes -- pra o bot poder perguntar qual
// quando "academia" bate com mais de um.
export function findActiveRecurringCandidates(fromNumber: string, query: string): RecurringExpense[] {
  const norm = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  const target = norm(query);
  if (!target) return [];
  return listRecurringExpenses(fromNumber).filter((r) => norm(r.description).includes(target));
}

export function markRecurringExpenseRunForMonth(fromNumber: string, id: number, yearMonth: string) {
  db.prepare(`UPDATE recurring_expenses SET last_run_month = ? WHERE id = ? AND from_number = ?`).run(yearMonth, id, fromNumber);
}

// gastos fixos ativos cujo dia bate com "hoje" (SP) e que ainda nao foram lancados
// nesse mes. day_of_month maior que a quantidade de dias do mes atual (ex: 31 num
// mes de 30 dias) cai automaticamente no ultimo dia do mes, pra nao pular o lancamento.
// fromNumber (opcional): so os desse numero (a consulta de um cliente nao precisa varrer o de todos); sem ele, todos, como no cron
export function getDueRecurringExpenses(todayDate: string, fromNumber?: string): RecurringExpense[] {
  const day = Number(todayDate.slice(8, 10));
  const yearMonth = todayDate.slice(0, 7);

  const candidates = (
    fromNumber === undefined
      ? db.prepare(`SELECT * FROM recurring_expenses WHERE active = 1 AND (last_run_month IS NULL OR last_run_month != ?)`).all(yearMonth)
      : db
          .prepare(`SELECT * FROM recurring_expenses WHERE active = 1 AND from_number = ? AND (last_run_month IS NULL OR last_run_month != ?)`)
          .all(fromNumber, yearMonth)
  ) as unknown as RecurringExpense[];

  return candidates.filter((r) => effectiveDayOfMonth(r.day_of_month, yearMonth) === day);
}

// janela de recuperacao do gasto fixo (Card 19, RN02): o lancamento e financeiro, vale recuperar ate 7 dias
export const RECURRING_LOOKBACK_DAYS = 7;

export interface MissedRecurringExpense {
  recurring: RecurringExpense;
  dueDate: string; // YYYY-MM-DD do vencimento (o dia efetivo daquele mes)
}

// Gastos fixos que deveriam ter sido lancados em [hoje - lookback, hoje] e ainda nao foram, do mais antigo pro mais novo.
// A trava contra repeticao continua sendo last_run_month (getDueRecurringExpenses). Um gasto fixo cadastrado DEPOIS do vencimento
// nao e lancado retroativamente (RN05); o do proprio dia nao precisa dessa checagem.
export function getMissedRecurringExpenses(todayDate: string, lookbackDays: number = RECURRING_LOOKBACK_DAYS, fromNumber?: string): MissedRecurringExpense[] {
  const missed: MissedRecurringExpense[] = [];
  for (let back = lookbackDays; back >= 0; back--) {
    const dueDate = addDaysToDateString(todayDate, -back);
    const yearMonth = dueDate.slice(0, 7);
    for (const recurring of getDueRecurringExpenses(dueDate, fromNumber)) {
      if (recurring.last_run_month && recurring.last_run_month > yearMonth) continue; // ja lancado um mes mais novo (ex: na mao)
      if (dueDate < todayDate && sqliteUtcToSpDate(recurring.created_at) > dueDate) continue;
      missed.push({ recurring, dueDate });
    }
  }
  return missed;
}

// desfaz o lancamento quando o aviso nao saiu (Evolution fora): o gasto some e o mes volta a ficar em aberto, entao a proxima tentativa refaz tudo sem duplicar
export function resetRecurringExpenseRunMonth(fromNumber: string, id: number, previousMonth: string | null) {
  db.prepare(`UPDATE recurring_expenses SET last_run_month = ? WHERE id = ? AND from_number = ?`).run(previousMonth, id, fromNumber);
}
