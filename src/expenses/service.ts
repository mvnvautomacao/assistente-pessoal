import { db } from "../db";

export interface Category {
  id: number;
  name: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function listCategories(): Category[] {
  return db.prepare(`SELECT id, name FROM categories ORDER BY name`).all() as unknown as Category[];
}

export function findCategoryByName(name: string): Category | null {
  const target = normalize(name);
  const category = listCategories().find((c) => normalize(c.name) === target);
  return category ?? null;
}

// Verifica se algum texto (categoria sugerida pela IA, descricao do gasto) contem
// uma palavra-chave ja aprendida de uma categorizacao anterior.
export function findCategoryByKeyword(...texts: string[]): Category | null {
  const keywords = db.prepare(`SELECT keyword, category_id FROM category_keywords`).all() as unknown as {
    keyword: string;
    category_id: number;
  }[];
  const haystacks = texts.filter(Boolean).map(normalize);

  for (const { keyword, category_id } of keywords) {
    const needle = normalize(keyword);
    if (needle && haystacks.some((h) => h.includes(needle))) {
      const category = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(category_id) as
        | Category
        | undefined;
      if (category) return category;
    }
  }
  return null;
}

// Pra respostas em linguagem natural tipo "acho que e categoria de lazer":
// procura se algum nome de categoria conhecida aparece dentro do texto.
export function findCategoryMentionedIn(text: string): Category | null {
  const haystack = normalize(text);
  const categories = listCategories();
  const mentioned = categories.filter((c) => haystack.includes(normalize(c.name)));
  // se mais de uma bater (raro), melhor nao adivinhar
  return mentioned.length === 1 ? mentioned[0] : null;
}

export function getOrCreateCategory(name: string): Category {
  const existing = findCategoryByName(name);
  if (existing) return existing;
  const cleanName = name.trim();
  db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(cleanName);
  return findCategoryByName(cleanName)!;
}

export interface PaymentMethod {
  id: number;
  name: string;
}

export function listPaymentMethods(): PaymentMethod[] {
  return db.prepare(`SELECT id, name FROM payment_methods ORDER BY name`).all() as unknown as PaymentMethod[];
}

export function findPaymentMethodByName(name: string): PaymentMethod | null {
  const target = normalize(name);
  const method = listPaymentMethods().find((m) => normalize(m.name) === target);
  return method ?? null;
}

export function findPaymentMethodMentionedIn(text: string): PaymentMethod | null {
  const haystack = normalize(text);
  const mentioned = listPaymentMethods().filter((m) => haystack.includes(normalize(m.name)));
  return mentioned.length === 1 ? mentioned[0] : null;
}

export function getOrCreatePaymentMethod(name: string): PaymentMethod {
  const existing = findPaymentMethodByName(name);
  if (existing) return existing;
  const cleanName = name.trim();
  db.prepare(`INSERT INTO payment_methods (name) VALUES (?)`).run(cleanName);
  return findPaymentMethodByName(cleanName)!;
}

export function getDefaultPaymentMethod(fromNumber: string): PaymentMethod | null {
  const row = db.prepare(`SELECT default_payment_method_id FROM user_settings WHERE from_number = ?`).get(fromNumber) as
    | { default_payment_method_id: number | null }
    | undefined;
  if (!row?.default_payment_method_id) return null;
  return db.prepare(`SELECT id, name FROM payment_methods WHERE id = ?`).get(row.default_payment_method_id) as
    | PaymentMethod
    | undefined ?? null;
}

export function setDefaultPaymentMethod(fromNumber: string, paymentMethodId: number) {
  db.prepare(
    `INSERT INTO user_settings (from_number, default_payment_method_id) VALUES (?, ?)
     ON CONFLICT(from_number) DO UPDATE SET default_payment_method_id = excluded.default_payment_method_id`
  ).run(fromNumber, paymentMethodId);
}

export function learnKeyword(keyword: string, categoryId: number) {
  const clean = keyword.trim();
  if (!clean) return;
  db.prepare(`INSERT INTO category_keywords (keyword, category_id) VALUES (?, ?)`).run(clean, categoryId);
}

export function insertExpense(params: {
  fromNumber: string;
  amount: number;
  description: string;
  categoryId: number;
  paymentMethodId: number | null;
  date: string;
}) {
  db.prepare(
    `INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.fromNumber,
    params.amount,
    params.description,
    params.categoryId,
    params.paymentMethodId,
    params.date,
    new Date().toISOString()
  );
}

export interface ExpenseRecord {
  id: number;
  from_number: string;
  amount: number;
  description: string;
  category_id: number | null;
  date: string;
}

export function findRecentExpense(fromNumber: string, query?: string): ExpenseRecord | null {
  if (query) {
    const target = normalize(query);
    const candidates = db
      .prepare(`SELECT * FROM expenses WHERE from_number = ? ORDER BY id DESC LIMIT 20`)
      .all(fromNumber) as unknown as ExpenseRecord[];
    const match = candidates.find((e) => normalize(e.description).includes(target));
    if (match) return match;
    return null;
  }
  const last = db.prepare(`SELECT * FROM expenses WHERE from_number = ? ORDER BY id DESC LIMIT 1`).get(fromNumber) as
    | ExpenseRecord
    | undefined;
  return last ?? null;
}

export function updateExpenseCategory(expenseId: number, categoryId: number) {
  db.prepare(`UPDATE expenses SET category_id = ? WHERE id = ?`).run(categoryId, expenseId);
}

export interface PendingCategorization {
  id: number;
  from_number: string;
  amount: number;
  description: string;
  date: string;
  suggested_category: string | null;
  suggested_payment_method: string | null;
}

export function addPendingCategorization(params: {
  from_number: string;
  amount: number;
  description: string;
  date: string;
  suggested_category: string | null;
  suggested_payment_method: string | null;
}) {
  db.prepare(
    `INSERT INTO pending_categorizations (from_number, amount, description, date, suggested_category, suggested_payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.from_number,
    params.amount,
    params.description,
    params.date,
    params.suggested_category,
    params.suggested_payment_method,
    new Date().toISOString()
  );
}

// A mais antiga primeiro: se o usuario tem 2 gastos pendentes de categoria,
// a proxima resposta dele resolve o primeiro que foi perguntado.
export function getNextPendingCategorization(fromNumber: string): PendingCategorization | null {
  const row = db
    .prepare(`SELECT * FROM pending_categorizations WHERE from_number = ? ORDER BY id ASC LIMIT 1`)
    .get(fromNumber) as PendingCategorization | undefined;
  return row ?? null;
}

export function clearPendingCategorization(id: number) {
  db.prepare(`DELETE FROM pending_categorizations WHERE id = ?`).run(id);
}

// --- consultas pro dashboard ---

export interface ExpenseListItem {
  id: number;
  amount: number;
  description: string;
  date: string;
  category: string | null;
  payment_method: string | null;
}

export function getExpensesForMonth(yearMonth: string): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE strftime('%Y-%m', e.date) = ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(yearMonth) as unknown as ExpenseListItem[];
}

export interface NamedTotal {
  name: string;
  total: number;
}

export function getCategoryTotalsForMonth(yearMonth: string): NamedTotal[] {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(e.amount) AS total
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE strftime('%Y-%m', e.date) = ?
       GROUP BY name
       ORDER BY total DESC`
    )
    .all(yearMonth) as unknown as NamedTotal[];
}

export function getPaymentMethodTotalsForMonth(yearMonth: string): NamedTotal[] {
  return db
    .prepare(
      `SELECT COALESCE(p.name, 'Não informado') AS name, SUM(e.amount) AS total
       FROM expenses e
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE strftime('%Y-%m', e.date) = ?
       GROUP BY name
       ORDER BY total DESC`
    )
    .all(yearMonth) as unknown as NamedTotal[];
}

// meses que tem pelo menos 1 gasto, do mais recente pro mais antigo (pro seletor de mes)
export function getAvailableMonths(): string[] {
  const rows = db.prepare(`SELECT DISTINCT strftime('%Y-%m', date) AS ym FROM expenses ORDER BY ym DESC`).all() as unknown as {
    ym: string;
  }[];
  return rows.map((r) => r.ym);
}

export interface ExpenseSummary {
  total: number;
  count: number;
  categoryTotals: NamedTotal[];
}

// start inclusivo, end exclusivo, ambos "YYYY-MM-DD"
export function getExpenseSummaryBetween(start: string, end: string): ExpenseSummary {
  const rows = db
    .prepare(
      `SELECT e.amount, COALESCE(c.name, 'Sem categoria') AS category
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.date >= ? AND e.date < ?`
    )
    .all(start, end) as unknown as { amount: number; category: string }[];

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount);
  const categoryTotals = [...byCategory.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  return { total, count: rows.length, categoryTotals };
}
