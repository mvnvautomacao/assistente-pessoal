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

export function learnKeyword(keyword: string, categoryId: number) {
  const clean = keyword.trim();
  if (!clean) return;
  db.prepare(`INSERT INTO category_keywords (keyword, category_id) VALUES (?, ?)`).run(clean, categoryId);
}

export function insertExpense(params: { fromNumber: string; amount: number; description: string; categoryId: number; date: string }) {
  db.prepare(
    `INSERT INTO expenses (from_number, amount, description, category_id, date, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(params.fromNumber, params.amount, params.description, params.categoryId, params.date, new Date().toISOString());
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
}

export function addPendingCategorization(params: {
  from_number: string;
  amount: number;
  description: string;
  date: string;
  suggested_category: string | null;
}) {
  db.prepare(
    `INSERT INTO pending_categorizations (from_number, amount, description, date, suggested_category, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(params.from_number, params.amount, params.description, params.date, params.suggested_category, new Date().toISOString());
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
