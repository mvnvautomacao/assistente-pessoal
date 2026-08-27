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

const DEFAULT_CATEGORIES = [
  "Mercado",
  "Veículo",
  "Transporte",
  "Saúde",
  "Moradia",
  "Lazer",
  "Compras",
  "Educação",
  "Assinaturas",
  "Outros",
];

const DEFAULT_PAYMENT_METHODS = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito"];

// Chamado uma vez por numero (na primeira mensagem dele) pra ele comecar com as
// categorias/formas de pagamento padrao, sem herdar nada de outro numero.
// retorna true se esse numero nunca tinha mandado mensagem antes (pra disparar
// a mensagem de boas-vindas) -- categorias so ficam vazias na primeira vez, ja
// que essa mesma funcao cria as padrao logo em seguida
export function ensureUserSeeded(fromNumber: string): boolean {
  const categoryCount = db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE from_number = ?`).get(fromNumber) as { n: number };
  const isNewUser = categoryCount.n === 0;
  if (isNewUser) {
    const insert = db.prepare(`INSERT INTO categories (from_number, name) VALUES (?, ?)`);
    for (const name of DEFAULT_CATEGORIES) insert.run(fromNumber, name);
  }

  const paymentCount = db.prepare(`SELECT COUNT(*) AS n FROM payment_methods WHERE from_number = ?`).get(fromNumber) as { n: number };
  if (paymentCount.n === 0) {
    const insert = db.prepare(`INSERT INTO payment_methods (from_number, name) VALUES (?, ?)`);
    for (const name of DEFAULT_PAYMENT_METHODS) insert.run(fromNumber, name);
  }

  return isNewUser;
}

export function listCategories(fromNumber: string): Category[] {
  return db.prepare(`SELECT id, name FROM categories WHERE from_number = ? ORDER BY name`).all(fromNumber) as unknown as Category[];
}

export function findCategoryByName(fromNumber: string, name: string): Category | null {
  const target = normalize(name);
  const category = listCategories(fromNumber).find((c) => normalize(c.name) === target);
  return category ?? null;
}

// Verifica se algum texto (categoria sugerida pela IA, descricao do gasto) contem
// uma palavra-chave ja aprendida de uma categorizacao anterior desse mesmo numero.
export function findCategoryByKeyword(fromNumber: string, ...texts: string[]): Category | null {
  const keywords = db.prepare(`SELECT keyword, category_id FROM category_keywords WHERE from_number = ?`).all(fromNumber) as unknown as {
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
// procura se algum nome de categoria conhecida (desse numero) aparece dentro do texto.
export function findCategoryMentionedIn(fromNumber: string, text: string): Category | null {
  const haystack = normalize(text);
  const categories = listCategories(fromNumber);
  const mentioned = categories.filter((c) => haystack.includes(normalize(c.name)));
  // se mais de uma bater (raro), melhor nao adivinhar
  return mentioned.length === 1 ? mentioned[0] : null;
}

export function getOrCreateCategory(fromNumber: string, name: string): Category {
  const existing = findCategoryByName(fromNumber, name);
  if (existing) return existing;
  const cleanName = name.trim();
  db.prepare(`INSERT INTO categories (from_number, name) VALUES (?, ?)`).run(fromNumber, cleanName);
  return findCategoryByName(fromNumber, cleanName)!;
}

export function getCategoryById(fromNumber: string, id: number): Category | null {
  const row = db.prepare(`SELECT id, name FROM categories WHERE id = ? AND from_number = ?`).get(id, fromNumber) as Category | undefined;
  return row ?? null;
}

export function renameCategory(fromNumber: string, id: number, newName: string): boolean {
  const category = getCategoryById(fromNumber, id);
  if (!category) return false;
  db.prepare(`UPDATE categories SET name = ? WHERE id = ? AND from_number = ?`).run(newName.trim(), id, fromNumber);
  return true;
}

// Apaga a categoria e desfaz os vinculos: gastos ficam "sem categoria" em vez de
// sumir, orcamento e palavras-chave aprendidas pra ela sao removidos.
export function deleteCategory(fromNumber: string, id: number): boolean {
  const category = getCategoryById(fromNumber, id);
  if (!category) return false;
  db.prepare(`UPDATE expenses SET category_id = NULL WHERE category_id = ? AND from_number = ?`).run(id, fromNumber);
  db.prepare(`DELETE FROM category_keywords WHERE category_id = ? AND from_number = ?`).run(id, fromNumber);
  db.prepare(`DELETE FROM budgets WHERE category_id = ? AND from_number = ?`).run(id, fromNumber);
  db.prepare(`DELETE FROM categories WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return true;
}

export interface PaymentMethod {
  id: number;
  name: string;
}

export function listPaymentMethods(fromNumber: string): PaymentMethod[] {
  return db.prepare(`SELECT id, name FROM payment_methods WHERE from_number = ? ORDER BY name`).all(fromNumber) as unknown as PaymentMethod[];
}

export function findPaymentMethodByName(fromNumber: string, name: string): PaymentMethod | null {
  const target = normalize(name);
  const method = listPaymentMethods(fromNumber).find((m) => normalize(m.name) === target);
  return method ?? null;
}

export function findPaymentMethodMentionedIn(fromNumber: string, text: string): PaymentMethod | null {
  const haystack = normalize(text);
  const mentioned = listPaymentMethods(fromNumber).filter((m) => haystack.includes(normalize(m.name)));
  return mentioned.length === 1 ? mentioned[0] : null;
}

export function getOrCreatePaymentMethod(fromNumber: string, name: string): PaymentMethod {
  const existing = findPaymentMethodByName(fromNumber, name);
  if (existing) return existing;
  const cleanName = name.trim();
  db.prepare(`INSERT INTO payment_methods (from_number, name) VALUES (?, ?)`).run(fromNumber, cleanName);
  return findPaymentMethodByName(fromNumber, cleanName)!;
}

export function getPaymentMethodById(fromNumber: string, id: number): PaymentMethod | null {
  const row = db.prepare(`SELECT id, name FROM payment_methods WHERE id = ? AND from_number = ?`).get(id, fromNumber) as
    | PaymentMethod
    | undefined;
  return row ?? null;
}

export function renamePaymentMethod(fromNumber: string, id: number, newName: string): boolean {
  const method = getPaymentMethodById(fromNumber, id);
  if (!method) return false;
  db.prepare(`UPDATE payment_methods SET name = ? WHERE id = ? AND from_number = ?`).run(newName.trim(), id, fromNumber);
  return true;
}

// Apaga a forma de pagamento: gastos que usavam ela ficam sem forma de pagamento
// definida, e se era a padrao do usuario, o padrao e desligado.
export function deletePaymentMethod(fromNumber: string, id: number): boolean {
  const method = getPaymentMethodById(fromNumber, id);
  if (!method) return false;
  db.prepare(`UPDATE expenses SET payment_method_id = NULL WHERE payment_method_id = ? AND from_number = ?`).run(id, fromNumber);
  db.prepare(`UPDATE user_settings SET default_payment_method_id = NULL WHERE default_payment_method_id = ? AND from_number = ?`).run(
    id,
    fromNumber
  );
  db.prepare(`DELETE FROM payment_methods WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return true;
}

export function getDefaultPaymentMethod(fromNumber: string): PaymentMethod | null {
  const row = db.prepare(`SELECT default_payment_method_id FROM user_settings WHERE from_number = ?`).get(fromNumber) as
    | { default_payment_method_id: number | null }
    | undefined;
  if (!row?.default_payment_method_id) return null;
  // filtro por from_number aqui e defesa em profundidade: na pratica esse id sempre
  // pertence a esse numero (so e gravado via setDefaultPaymentMethod, sempre com um
  // id que veio de getOrCreatePaymentMethod do mesmo numero), mas ja tivemos um bug
  // real de dado indo pro numero errado numa migracao, entao vale nao confiar cegamente.
  return (
    (db.prepare(`SELECT id, name FROM payment_methods WHERE id = ? AND from_number = ?`).get(row.default_payment_method_id, fromNumber) as
      | PaymentMethod
      | undefined) ?? null
  );
}

export function setDefaultPaymentMethod(fromNumber: string, paymentMethodId: number) {
  db.prepare(
    `INSERT INTO user_settings (from_number, default_payment_method_id) VALUES (?, ?)
     ON CONFLICT(from_number) DO UPDATE SET default_payment_method_id = excluded.default_payment_method_id`
  ).run(fromNumber, paymentMethodId);
}

// 0=domingo .. 6=sabado, igual Date.getDay(). Enquanto nao for definido, o relatorio
// semanal automatico fica desligado pra esse numero (selecao e obrigatoria).
export function setReportDayOfWeek(fromNumber: string, dayOfWeek: number) {
  db.prepare(
    `INSERT INTO user_settings (from_number, report_day_of_week) VALUES (?, ?)
     ON CONFLICT(from_number) DO UPDATE SET report_day_of_week = excluded.report_day_of_week`
  ).run(fromNumber, dayOfWeek);
}

export interface ReportSubscriber {
  from_number: string;
  report_day_of_week: number;
}

export function getReportSubscribers(): ReportSubscriber[] {
  return db
    .prepare(`SELECT from_number, report_day_of_week FROM user_settings WHERE report_day_of_week IS NOT NULL`)
    .all() as unknown as ReportSubscriber[];
}

export function learnKeyword(fromNumber: string, keyword: string, categoryId: number) {
  const clean = keyword.trim();
  if (!clean) return;
  db.prepare(`INSERT INTO category_keywords (from_number, keyword, category_id) VALUES (?, ?, ?)`).run(fromNumber, clean, categoryId);
}

export function insertExpense(params: {
  fromNumber: string;
  amount: number;
  description: string;
  categoryId: number | null;
  paymentMethodId: number | null;
  date: string;
}): ExpenseRecord {
  const result = db
    .prepare(
      `INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.fromNumber,
      params.amount,
      params.description,
      params.categoryId,
      params.paymentMethodId,
      params.date,
      new Date().toISOString()
    );
  return getExpenseById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export interface ExpenseRecord {
  id: number;
  from_number: string;
  amount: number;
  description: string;
  category_id: number | null;
  payment_method_id: number | null;
  date: string;
}

export function getExpenseById(fromNumber: string, id: number): ExpenseRecord | null {
  const row = db.prepare(`SELECT * FROM expenses WHERE id = ? AND from_number = ?`).get(id, fromNumber) as ExpenseRecord | undefined;
  return row ?? null;
}

export function updateExpense(
  fromNumber: string,
  id: number,
  params: { amount: number; description: string; date: string; categoryId: number | null; paymentMethodId: number | null }
): boolean {
  const result = db
    .prepare(
      `UPDATE expenses SET amount = ?, description = ?, date = ?, category_id = ?, payment_method_id = ?
       WHERE id = ? AND from_number = ?`
    )
    .run(params.amount, params.description, params.date, params.categoryId, params.paymentMethodId, id, fromNumber);
  return result.changes > 0;
}

export function deleteExpense(fromNumber: string, id: number): boolean {
  const result = db.prepare(`DELETE FROM expenses WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
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

// categoryId aceita null pra permitir desfazer uma recategorizacao em lote que
// tirou um gasto de "sem categoria" (ver bulk_recategorize / undo em router.ts)
export function updateExpenseCategory(expenseId: number, categoryId: number | null) {
  db.prepare(`UPDATE expenses SET category_id = ? WHERE id = ?`).run(categoryId, expenseId);
}

// os N gastos mais recentes de um numero, pra recategorizacao em lote ("muda os
// ultimos 5 gastos pra mercado")
export function getRecentExpensesList(fromNumber: string, n: number): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ?
       ORDER BY e.date DESC, e.id DESC
       LIMIT ?`
    )
    .all(fromNumber, n) as unknown as ExpenseListItem[];
}

// todos os gastos de uma categoria especifica, pra recategorizacao em lote
// ("muda os gastos de mercado pra lazer")
export function getExpensesByCategoryId(fromNumber: string, categoryId: number): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ? AND e.category_id = ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(fromNumber, categoryId) as unknown as ExpenseListItem[];
}

// aplica a mesma categoria a varios gastos de uma vez. Filtra por from_number
// tambem (nao so id) -- essencial na rota do dashboard, onde os ids vem direto
// do formulario (dado do usuario) e um numero poderia tentar mexer em gasto de
// outro numero manipulando a requisicao. No fluxo do WhatsApp isso e redundante
// (os ids ja vem de uma query filtrada por numero), mas nao custa nada garantir aqui tambem.
export function bulkUpdateExpenseCategory(fromNumber: string, expenseIds: number[], categoryId: number) {
  const stmt = db.prepare(`UPDATE expenses SET category_id = ? WHERE id = ? AND from_number = ?`);
  for (const id of expenseIds) stmt.run(categoryId, id, fromNumber);
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

// start inclusivo, end exclusivo, ambos "YYYY-MM-DD" — gastos individuais (nao o
// resumo por categoria), usado pro fluxo de listar/editar gastos pelo WhatsApp.
export function getExpensesBetween(fromNumber: string, start: string, end: string): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ? AND e.date >= ? AND e.date < ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(fromNumber, start, end) as unknown as ExpenseListItem[];
}

export function getExpensesForMonth(fromNumber: string, yearMonth: string): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ? AND strftime('%Y-%m', e.date) = ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(fromNumber, yearMonth) as unknown as ExpenseListItem[];
}

// todos os gastos de um numero, sem limite de mes -- pra exportar em CSV
// (ex: declarar imposto de renda precisa do ano inteiro, nao so o mes atual).
export function getAllExpenses(fromNumber: string): ExpenseListItem[] {
  return db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(fromNumber) as unknown as ExpenseListItem[];
}

// busca por texto na descricao, em TODOS os meses (nao so o mes atual) -- pro
// campo de busca do dashboard, ja que a navegacao normal e so mes a mes.
// Filtra em JS com normalize() (ignora acento/maiuscula, igual findRecentExpense)
// em vez de LIKE puro no SQL, que nao ignoraria acento ("farmacia" nao acharia
// "Farmácia").
export function searchExpenses(fromNumber: string, query: string): ExpenseListItem[] {
  const target = normalize(query);
  const all = db
    .prepare(
      `SELECT e.id, e.amount, e.description, e.date, c.name AS category, p.name AS payment_method
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(fromNumber) as unknown as ExpenseListItem[];
  return all.filter((e) => normalize(e.description).includes(target)).slice(0, 200);
}

export interface NamedTotal {
  name: string;
  total: number;
}

export function getCategoryTotalsForMonth(fromNumber: string, yearMonth: string): NamedTotal[] {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(e.amount) AS total
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.from_number = ? AND strftime('%Y-%m', e.date) = ?
       GROUP BY name
       ORDER BY total DESC`
    )
    .all(fromNumber, yearMonth) as unknown as NamedTotal[];
}

export function getPaymentMethodTotalsForMonth(fromNumber: string, yearMonth: string): NamedTotal[] {
  return db
    .prepare(
      `SELECT COALESCE(p.name, 'Não informado') AS name, SUM(e.amount) AS total
       FROM expenses e
       LEFT JOIN payment_methods p ON p.id = e.payment_method_id
       WHERE e.from_number = ? AND strftime('%Y-%m', e.date) = ?
       GROUP BY name
       ORDER BY total DESC`
    )
    .all(fromNumber, yearMonth) as unknown as NamedTotal[];
}

// meses que tem pelo menos 1 gasto desse numero, do mais recente pro mais antigo (pro seletor de mes)
export function getAvailableMonths(fromNumber: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT strftime('%Y-%m', date) AS ym FROM expenses WHERE from_number = ? ORDER BY ym DESC`)
    .all(fromNumber) as unknown as { ym: string }[];
  return rows.map((r) => r.ym);
}

export interface ExpenseSummary {
  total: number;
  count: number;
  categoryTotals: NamedTotal[];
}

// start inclusivo, end exclusivo, ambos "YYYY-MM-DD". fromNumber/categoryId sao filtros opcionais.
export function getExpenseSummaryBetween(
  start: string,
  end: string,
  fromNumber?: string,
  categoryId?: number
): ExpenseSummary {
  const conditions = ["e.date >= ?", "e.date < ?"];
  const params: (string | number)[] = [start, end];
  if (fromNumber) {
    conditions.push("e.from_number = ?");
    params.push(fromNumber);
  }
  if (categoryId) {
    conditions.push("e.category_id = ?");
    params.push(categoryId);
  }

  const rows = db
    .prepare(
      `SELECT e.amount, COALESCE(c.name, 'Sem categoria') AS category
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE ${conditions.join(" AND ")}`
    )
    .all(...params) as unknown as { amount: number; category: string }[];

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount);
  const categoryTotals = [...byCategory.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  return { total, count: rows.length, categoryTotals };
}
