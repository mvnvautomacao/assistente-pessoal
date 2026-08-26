import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
// migracoes de schema recriam tabelas (categories/payment_methods) que outras
// tabelas referenciam; a integridade referencial e garantida pelo codigo, nao pelo SQLite.
db.exec(`PRAGMA foreign_keys = OFF`);

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

  -- categorias, formas de pagamento e as palavras-chave aprendidas sao isoladas
  -- por numero: um numero nunca ve nem herda dados de outro numero.
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(from_number, name)
  );

  CREATE TABLE IF NOT EXISTS category_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    keyword TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(from_number, name)
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

  -- forma de pagamento padrao e dia do relatorio semanal de cada numero.
  -- report_day_of_week: 0=domingo .. 6=sabado (igual Date.getDay()). NULL = relatorio semanal desligado ate o usuario escolher um dia.
  -- event_reminder_minutes: quantos minutos antes de um evento da agenda avisar no WhatsApp (padrao do usuario, pode ser sobrescrito por evento).
  CREATE TABLE IF NOT EXISTS user_settings (
    from_number TEXT PRIMARY KEY,
    default_payment_method_id INTEGER REFERENCES payment_methods(id),
    report_day_of_week INTEGER,
    event_reminder_minutes INTEGER NOT NULL DEFAULT 60
  );

  -- rastreia, por evento do Google Calendar, quando avisar no WhatsApp antes dele
  -- acontecer. A agenda em si vive no Google; essa tabela so guarda o "lembrete local".
  CREATE TABLE IF NOT EXISTS event_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    from_number TEXT NOT NULL,
    title TEXT NOT NULL,
    event_start TEXT NOT NULL,
    reminder_minutes INTEGER NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );

  -- orcamento mensal por usuario+categoria; alerta quando o gasto do mes na
  -- categoria bate 80%/100% desse valor
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    monthly_limit REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(from_number, category_id)
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
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "event_reminder_minutes")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN event_reminder_minutes INTEGER NOT NULL DEFAULT 60`);
}

// categories/payment_methods/category_keywords existiam como tabelas globais
// (compartilhadas entre todos os numeros). Migra pra isolado por numero,
// atribuindo os dados existentes ao numero principal (unico "dono" ate agora).
function migrateGlobalTableToPerNumber(table: "categories" | "payment_methods") {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === "from_number")) return;

  db.exec(`
    CREATE TABLE ${table}_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_number TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(from_number, name)
    );
  `);
  db.prepare(`INSERT INTO ${table}_new (id, from_number, name) SELECT id, ?, name FROM ${table}`).run(config.myWhatsappNumber);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
}
migrateGlobalTableToPerNumber("categories");
migrateGlobalTableToPerNumber("payment_methods");

const keywordColumns = db.prepare(`PRAGMA table_info(category_keywords)`).all() as { name: string }[];
if (!keywordColumns.some((c) => c.name === "from_number")) {
  db.exec(`ALTER TABLE category_keywords ADD COLUMN from_number TEXT`);
  db.prepare(`UPDATE category_keywords SET from_number = ? WHERE from_number IS NULL`).run(config.myWhatsappNumber);
}
