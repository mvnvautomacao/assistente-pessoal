import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_number TEXT NOT NULL,
    message TEXT NOT NULL,
    due_at TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  -- palavras que, quando aparecem numa descricao de gasto, indicam uma categoria
  -- (aprendidas a partir das correcoes/confirmacoes do usuario)
  CREATE TABLE IF NOT EXISTS category_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    payment_method_id INTEGER REFERENCES payment_methods(id),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  -- forma de pagamento padrao e dia do relatorio semanal de cada numero.
  -- report_day_of_week: 0=domingo .. 6=sabado (igual Date.getDay()). NULL = relatorio semanal desligado ate o usuario escolher um dia.
  CREATE TABLE IF NOT EXISTS user_settings (
    from_number TEXT PRIMARY KEY,
    default_payment_method_id INTEGER REFERENCES payment_methods(id),
    report_day_of_week INTEGER
  );

  -- fila por numero: enquanto houver pendencia mais antiga, a proxima mensagem
  -- de texto/audio desse numero e tratada como resposta da categoria, nao pedido novo
  CREATE TABLE IF NOT EXISTS pending_categorizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    date TEXT NOT NULL,
    suggested_category TEXT,
    suggested_payment_method TEXT,
    created_at TEXT NOT NULL
  );
`);

// pending_categorizations mudou de "1 linha por numero" pra fila (varias linhas);
// tabela antiga so guardava estado efemero, entao e seguro recriar do zero.
const pendingColumns = db.prepare(`PRAGMA table_info(pending_categorizations)`).all() as { name: string; pk: number }[];
const hasOldSchema = pendingColumns.some((c) => c.name === "from_number" && c.pk === 1);
if (hasOldSchema) {
  db.exec(`DROP TABLE pending_categorizations`);
  db.exec(`
    CREATE TABLE pending_categorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_number TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      suggested_category TEXT,
      suggested_payment_method TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

if (!hasOldSchema && !pendingColumns.some((c) => c.name === "suggested_payment_method")) {
  db.exec(`ALTER TABLE pending_categorizations ADD COLUMN suggested_payment_method TEXT`);
}

// expenses existia antes da coluna payment_method_id ser adicionada.
const expenseColumns = db.prepare(`PRAGMA table_info(expenses)`).all() as { name: string }[];
if (!expenseColumns.some((c) => c.name === "payment_method_id")) {
  db.exec(`ALTER TABLE expenses ADD COLUMN payment_method_id INTEGER REFERENCES payment_methods(id)`);
}

// user_settings existia antes da coluna report_day_of_week ser adicionada.
const userSettingsColumns = db.prepare(`PRAGMA table_info(user_settings)`).all() as { name: string }[];
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "report_day_of_week")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN report_day_of_week INTEGER`);
}

const DEFAULT_PAYMENT_METHODS = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito"];

const paymentMethodCount = db.prepare(`SELECT COUNT(*) AS n FROM payment_methods`).get() as { n: number };
if (paymentMethodCount.n === 0) {
  const insert = db.prepare(`INSERT INTO payment_methods (name) VALUES (?)`);
  for (const name of DEFAULT_PAYMENT_METHODS) insert.run(name);
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

const categoryCount = db.prepare(`SELECT COUNT(*) AS n FROM categories`).get() as { n: number };
if (categoryCount.n === 0) {
  const insert = db.prepare(`INSERT INTO categories (name) VALUES (?)`);
  for (const name of DEFAULT_CATEGORIES) insert.run(name);
}
