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
  -- event_reminder_minutes: padrao de "avisar X min antes" pra eventos novos (pode ser sobrescrito por evento).
  -- no_expense_reminder_*: aviso automatico ("nao registrou nada hoje?") -- ligado
  -- por padrao, as 18:30. sent_date ("YYYY-MM-DD") guarda o dia (fuso SP) em que
  -- ja foi resolvido (avisado OU o usuario ja tinha registrado algo), pra nao
  -- checar de novo no mesmo dia (ver expenses/noExpenseReminderScheduler.ts).
  CREATE TABLE IF NOT EXISTS user_settings (
    from_number TEXT PRIMARY KEY,
    default_payment_method_id INTEGER REFERENCES payment_methods(id),
    report_day_of_week INTEGER,
    event_reminder_minutes INTEGER NOT NULL DEFAULT 60,
    no_expense_reminder_enabled INTEGER NOT NULL DEFAULT 1,
    no_expense_reminder_time TEXT NOT NULL DEFAULT '18:30',
    no_expense_reminder_sent_date TEXT
  );

  -- agenda propria, isolada por numero (nao depende de conta do Google).
  -- reminder_sent controla se o aviso automatico no WhatsApp ja foi enviado.
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    location TEXT,
    reminder_minutes INTEGER NOT NULL DEFAULT 60,
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- alertas ADICIONAIS de um evento, alem do principal (que continua em
  -- events.reminder_minutes/reminder_sent, sem mudar nada no resto do sistema
  -- que ja dependia so dessas 2 colunas). Maximo de 2 linhas por evento --
  -- junto com o principal, ate 3 alertas no total (ver MAX_REMINDERS_PER_EVENT
  -- em events/service.ts).
  CREATE TABLE IF NOT EXISTS event_extra_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id),
    minutes_before INTEGER NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0
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

  -- lista de numeros autorizados a receber resposta do assistente. Sem entrada
  -- aqui, o webhook ignora a mensagem em silencio (nao manda nada de volta) --
  -- protege contra loop de bot conversando com bot de outra empresa.
  CREATE TABLE IF NOT EXISTS allowed_numbers (
    from_number TEXT PRIMARY KEY,
    note TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- sprints (prazo padrao de 10 dias, ajustavel) e os cards do kanban do /admin.
  -- Todo pedido (melhoria, evolucao, incidente) vira um card num sprint; o card
  -- anda pelas colunas backlog > refinado > a_fazer > fazendo > testando > feito.
  CREATE TABLE IF NOT EXISTS sprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sprint_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id),
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'melhoria',
    status TEXT NOT NULL DEFAULT 'backlog',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
  );

  -- numeros BLOQUEADOS pelo admin: nunca recebem NADA do bot (resposta ou
  -- automacao) e suas mensagens sao ignoradas em silencio. Bloqueio vale mais
  -- que a lista de autorizados (ver access/blocklist.ts e sendText).
  CREATE TABLE IF NOT EXISTS blocked_numbers (
    from_number TEXT PRIMARY KEY,
    note TEXT,
    blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- configuracao GLOBAL (nao por usuario, uma linha so, id fixo=1), definida
  -- pelo admin no /admin -- hoje so guarda em quais dias da semana o aviso de
  -- gasto pendente roda pra todo mundo (ver expenses/service.ts e
  -- noExpenseReminderScheduler.ts). Lista de numeros "0,1,2,3,4,5,6"
  -- (0=domingo..6=sabado, igual spDayOfWeek). Padrao: segunda, quarta, sexta.
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    no_expense_reminder_days TEXT NOT NULL DEFAULT '1,3,5'
  );

  -- cobranca mensal de cada cliente (numero autorizado) -- controle manual pelo
  -- admin, sem integracao com gateway de pagamento ainda. next_due_date e
  -- last_payment_date sao NULL ate o admin configurar a primeira cobranca.
  -- plan ('mensal' ou 'anual') e so o ultimo plano usado, pra pre-selecionar a
  -- tela -- o historico de verdade fica em client_payments.
  CREATE TABLE IF NOT EXISTS client_billing (
    from_number TEXT PRIMARY KEY,
    monthly_fee REAL,
    next_due_date TEXT,
    last_payment_date TEXT,
    plan TEXT
  );

  -- historico de pagamentos registrados por cliente -- cada linha e 1 pagamento
  -- (mensal cobre 1 mes, anual cobre 12), pra dar pra acompanhar mes a mes o
  -- que cada cliente ja pagou (ver billing/service.ts getPaidMonthsForClient).
  CREATE TABLE IF NOT EXISTS client_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount REAL NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    paid_at TEXT NOT NULL
  );

  -- login do dashboard web: senha SEMPRE gerada pelo sistema e mandada por
  -- WhatsApp (nunca escolhida digitando no site) -- prova que quem esta
  -- pedindo acesso controla aquele numero de verdade. last_password_sent_at
  -- e o controle do limite de 1 envio por hora (ver dashboard/accounts.ts).
  CREATE TABLE IF NOT EXISTS dashboard_accounts (
    phone_number TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_password_sent_at TEXT
  );

  -- entradas de dinheiro (salario, freela, reembolso...), o outro lado da conta
  -- alem dos gastos. Isolado por numero, igual expenses.
  CREATE TABLE IF NOT EXISTS incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- gastos fixos/recorrentes: lancados automaticamente todo mes no dia
  -- configurado, sem o usuario precisar mandar mensagem (ver recurringScheduler.ts).
  -- last_run_month ("YYYY-MM") evita lancar 2x no mesmo mes.
  CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    payment_method_id INTEGER REFERENCES payment_methods(id),
    day_of_month INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_run_month TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- alertas de conta fixa/lembrete recorrente (agua, luz, ou "comprar racao a
  -- cada 45 dias"): NAO lanca gasto sozinho -- so manda "ja fez?" no momento
  -- certo (ver bills/scheduler.ts). Duas recorrencias possiveis, mutuamente
  -- exclusivas (recurrence_type decide qual vale):
  --   'day_of_month' -- todo mes no dia fixo (day_of_month); confirmed_month
  --     ("YYYY-MM") evita perguntar de novo no mesmo mes depois de confirmado.
  --   'interval' -- a cada N dias (interval_days) a partir da ultima
  --     confirmacao; next_due_date ("YYYY-MM-DD") guarda quando perguntar de
  --     novo (day_of_month fica com um valor de placeholder, ignorado).
  -- snoozed_until ("YYYY-MM-DD") guarda o "me lembra amanha", nas duas recorrencias.
  CREATE TABLE IF NOT EXISTS bill_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT NOT NULL,
    name TEXT NOT NULL,
    recurrence_type TEXT NOT NULL DEFAULT 'day_of_month',
    day_of_month INTEGER NOT NULL,
    interval_days INTEGER,
    next_due_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    last_asked_date TEXT,
    confirmed_month TEXT,
    snoozed_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

// achado real: o relatorio semanal exigia o usuario ativar manualmente
// mandando mensagem ("quero receber toda sexta"), sem nenhum aviso disso --
// na pratica, ninguem recebia nada ate descobrir sozinho que precisava pedir.
// Relatorio semanal (toda sexta, 9h) e mensal passam a vir LIGADOS por
// padrao pra todo mundo. So preenche quem esta NULL ou sem linha nenhuma
// ainda -- nao reaplica em quem ja escolheu outro dia por conta propria.
const DEFAULT_REPORT_DAY = 5; // sexta-feira
db.exec(`
  INSERT INTO user_settings (from_number, report_day_of_week)
  SELECT DISTINCT from_number, ${DEFAULT_REPORT_DAY} FROM categories
  WHERE from_number NOT IN (SELECT from_number FROM user_settings)
`);
db.exec(`UPDATE user_settings SET report_day_of_week = ${DEFAULT_REPORT_DAY} WHERE report_day_of_week IS NULL`);
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "event_reminder_minutes")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN event_reminder_minutes INTEGER NOT NULL DEFAULT 60`);
}

// garante que a linha unica de configuracao global existe (id=1) -- so insere
// na primeira vez, nunca sobrescreve o que o admin ja escolheu depois.
db.exec(`INSERT INTO app_settings (id, no_expense_reminder_days) VALUES (1, '1,3,5') ON CONFLICT(id) DO NOTHING`);

// aviso automatico de gasto pendente: ligado por padrao (mesma filosofia do
// relatorio semanal, ver DEFAULT_REPORT_DAY acima) -- ninguem precisa pedir
// pra comecar a receber, so desativar se nao quiser.
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "no_expense_reminder_enabled")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN no_expense_reminder_enabled INTEGER NOT NULL DEFAULT 1`);
}
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "no_expense_reminder_time")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN no_expense_reminder_time TEXT NOT NULL DEFAULT '18:30'`);
}
if (userSettingsColumns.length && !userSettingsColumns.some((c) => c.name === "no_expense_reminder_sent_date")) {
  db.exec(`ALTER TABLE user_settings ADD COLUMN no_expense_reminder_sent_date TEXT`);
}

// bill_alerts existia antes da recorrencia por intervalo (so tinha dia fixo do
// mes) -- linhas antigas ficam com recurrence_type default 'day_of_month' via
// DEFAULT da coluna, continuam funcionando exatamente como antes.
const billAlertsColumns = db.prepare(`PRAGMA table_info(bill_alerts)`).all() as { name: string }[];
if (billAlertsColumns.length && !billAlertsColumns.some((c) => c.name === "recurrence_type")) {
  db.exec(`ALTER TABLE bill_alerts ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'day_of_month'`);
}
if (billAlertsColumns.length && !billAlertsColumns.some((c) => c.name === "interval_days")) {
  db.exec(`ALTER TABLE bill_alerts ADD COLUMN interval_days INTEGER`);
}
if (billAlertsColumns.length && !billAlertsColumns.some((c) => c.name === "next_due_date")) {
  db.exec(`ALTER TABLE bill_alerts ADD COLUMN next_due_date TEXT`);
}

// numero do dono sempre autorizado, senao ele mesmo ficaria bloqueado assim que
// a lista de autorizados existir. Outros numeros precisam ser liberados no /admin.
db.prepare(`INSERT OR IGNORE INTO allowed_numbers (from_number, note, added_at) VALUES (?, 'dono', datetime('now'))`).run(
  config.myWhatsappNumber
);

// event_reminders foi uma tabela de transicao (ponte pra agenda do Google) que durou
// um commit so: a agenda virou local (tabela "events" acima), entao ela nao serve mais.
db.exec(`DROP TABLE IF EXISTS event_reminders`);

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

// limite do cartao (opcional, informado pelo usuario) -- ver expenses/balance.ts
const paymentMethodColumns = db.prepare(`PRAGMA table_info(payment_methods)`).all() as { name: string }[];
if (!paymentMethodColumns.some((c) => c.name === "credit_limit")) {
  db.exec(`ALTER TABLE payment_methods ADD COLUMN credit_limit REAL`);
}

// client_billing existia antes da coluna plan ser adicionada.
const clientBillingColumns = db.prepare(`PRAGMA table_info(client_billing)`).all() as { name: string }[];
if (clientBillingColumns.length && !clientBillingColumns.some((c) => c.name === "plan")) {
  db.exec(`ALTER TABLE client_billing ADD COLUMN plan TEXT`);
}

// node:sqlite (DatabaseSync) nao tem um helper de transacao pronto tipo o do
// better-sqlite3 -- achado da auditoria: insercao de N parcelas ou de um lote
// de gastos rodava fora de transacao, entao uma falha no meio do loop deixava
// algumas linhas gravadas e outras nao, sem limpeza automatica. Envolve
// qualquer sequencia de escritas nessa funcao: se `fn` lancar, desfaz tudo.
export function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
