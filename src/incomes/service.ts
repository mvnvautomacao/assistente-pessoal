import { db } from "../db";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export interface IncomeRecord {
  id: number;
  from_number: string;
  amount: number;
  description: string;
  date: string;
}

export function insertIncome(params: { fromNumber: string; amount: number; description: string; date: string }): IncomeRecord {
  const result = db
    .prepare(`INSERT INTO incomes (from_number, amount, description, date, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(params.fromNumber, params.amount, params.description, params.date, new Date().toISOString());
  return getIncomeById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function getIncomeById(fromNumber: string, id: number): IncomeRecord | null {
  const row = db.prepare(`SELECT * FROM incomes WHERE id = ? AND from_number = ?`).get(id, fromNumber) as IncomeRecord | undefined;
  return row ?? null;
}

export function updateIncome(fromNumber: string, id: number, params: { amount: number; description: string; date: string }): boolean {
  const result = db
    .prepare(`UPDATE incomes SET amount = ?, description = ?, date = ? WHERE id = ? AND from_number = ?`)
    .run(params.amount, params.description, params.date, id, fromNumber);
  return result.changes > 0;
}

export function deleteIncome(fromNumber: string, id: number): boolean {
  const result = db.prepare(`DELETE FROM incomes WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
}

export function findRecentIncome(fromNumber: string, query?: string): IncomeRecord | null {
  if (query) {
    const target = normalize(query);
    const candidates = db.prepare(`SELECT * FROM incomes WHERE from_number = ? ORDER BY id DESC LIMIT 20`).all(fromNumber) as unknown as IncomeRecord[];
    return candidates.find((i) => normalize(i.description).includes(target)) ?? null;
  }
  const last = db.prepare(`SELECT * FROM incomes WHERE from_number = ? ORDER BY id DESC LIMIT 1`).get(fromNumber) as
    | IncomeRecord
    | undefined;
  return last ?? null;
}

export interface IncomeSummary {
  total: number;
  count: number;
}

// start inclusivo, end exclusivo, ambos "YYYY-MM-DD". fromNumber e filtro opcional.
export function getIncomeSummaryBetween(start: string, end: string, fromNumber?: string): IncomeSummary {
  const conditions = ["date >= ?", "date < ?"];
  const params: (string | number)[] = [start, end];
  if (fromNumber) {
    conditions.push("from_number = ?");
    params.push(fromNumber);
  }
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM incomes WHERE ${conditions.join(" AND ")}`)
    .get(...params) as { total: number; count: number };
  return row;
}

// todas as entradas de um numero, sem limite de mes -- pra exportar em CSV.
export function getAllIncomes(fromNumber: string): IncomeRecord[] {
  return db
    .prepare(`SELECT * FROM incomes WHERE from_number = ? ORDER BY date DESC, id DESC`)
    .all(fromNumber) as unknown as IncomeRecord[];
}

export function getIncomesForMonth(fromNumber: string, yearMonth: string): IncomeRecord[] {
  return db
    .prepare(`SELECT * FROM incomes WHERE from_number = ? AND strftime('%Y-%m', date) = ? ORDER BY date DESC, id DESC`)
    .all(fromNumber, yearMonth) as unknown as IncomeRecord[];
}

export function getAvailableIncomeMonths(fromNumber: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT strftime('%Y-%m', date) AS ym FROM incomes WHERE from_number = ? ORDER BY ym DESC`)
    .all(fromNumber) as unknown as { ym: string }[];
  return rows.map((r) => r.ym);
}
