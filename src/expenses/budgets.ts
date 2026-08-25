import { db } from "../db";
import { getExpenseSummaryBetween } from "./service";
import { currentMonthRange } from "./reportText";

export interface Budget {
  category_id: number;
  category_name: string;
  monthly_limit: number;
}

export function setBudget(fromNumber: string, categoryId: number, monthlyLimit: number) {
  db.prepare(
    `INSERT INTO budgets (from_number, category_id, monthly_limit, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(from_number, category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ).run(fromNumber, categoryId, monthlyLimit, new Date().toISOString());
}

export function removeBudget(fromNumber: string, categoryId: number): boolean {
  const result = db.prepare(`DELETE FROM budgets WHERE from_number = ? AND category_id = ?`).run(fromNumber, categoryId);
  return result.changes > 0;
}

export function getBudget(fromNumber: string, categoryId: number): number | null {
  const row = db.prepare(`SELECT monthly_limit FROM budgets WHERE from_number = ? AND category_id = ?`).get(fromNumber, categoryId) as
    | { monthly_limit: number }
    | undefined;
  return row?.monthly_limit ?? null;
}

export function listBudgets(fromNumber: string): Budget[] {
  return db
    .prepare(
      `SELECT b.category_id, c.name AS category_name, b.monthly_limit
       FROM budgets b JOIN categories c ON c.id = b.category_id
       WHERE b.from_number = ? ORDER BY c.name`
    )
    .all(fromNumber) as unknown as Budget[];
}

// Retorna um texto de alerta pra anexar na confirmacao do gasto quando o total
// da categoria no mes bate 80% ou 100% do orcamento definido; null se nao tem
// orcamento ou ainda esta longe do limite.
export function checkBudgetAlert(fromNumber: string, categoryId: number, categoryName: string): string | null {
  const limit = getBudget(fromNumber, categoryId);
  if (!limit) return null;

  const range = currentMonthRange();
  const summary = getExpenseSummaryBetween(range.start, range.end, fromNumber, categoryId);
  const pct = (summary.total / limit) * 100;

  if (pct >= 100) {
    return `\n\n🚨 Você ultrapassou o orçamento de ${categoryName} este mês: R$${summary.total.toFixed(2)} de R$${limit.toFixed(2)} (${pct.toFixed(0)}%)`;
  }
  if (pct >= 80) {
    return `\n\n⚠️ Você já usou ${pct.toFixed(0)}% do orçamento de ${categoryName} este mês (R$${summary.total.toFixed(2)} de R$${limit.toFixed(2)})`;
  }
  return null;
}
