// Card 22, parte 2: "agenda financeira" por WhatsApp -- report com scope finance, somente leitura, sem lista numerada, isolada por numero.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createRecurringExpense } from "../../src/expenses/recurring";
import { createBillAlert } from "../../src/bills/service";
import { createEvent, getEventById } from "../../src/events/service";
import { db } from "../../src/db";

const NOW = new Date("2026-10-19T10:00:00-03:00").getTime(); // segunda 19/10/2026

let seq = 0;
function user(): string {
  const n = `55110008900${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function ask(app: BotApp, n: string, text: string, action: Interpretation) {
  app.queueReply([action]);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

function expenseRow(n: string, description: string, amount: number, date: string) {
  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at) VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`).run(n, amount, description, date);
}

test("'agenda financeira' sem recorte: proximos 30 dias, por dia, com os itens e o total previsto", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 99.9, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 25 });
  expenseRow(n, "Tênis (parcela 3/6)", 120, "2026-10-22");
  const reply = await ask(app, n, "agenda financeira", { type: "report", scope: "finance" });
  assert.match(reply, /^💳 Agenda financeira — próximos 30 dias\n/);
  assert.match(reply, /Amanhã · ter 20\/10\n🔁 Internet · R\$ 99,90 \(lança sozinho\)/);
  assert.match(reply, /Qui 22\/10\n🧾 Tênis · parcela 3\/6 · R\$ 120,00/);
  assert.match(reply, /Dom 25\/10\n📌 Luz · valor a informar/);
  assert.match(reply, /Total previsto: R\$ 219,90\n\+ 1 sem valor definido/);
  assert.doesNotMatch(reply, /Pra mexer em um item/, "a consulta financeira nao tem itens numerados");
});

test("'o que vence essa semana' e 'contas a pagar em novembro': recortes da agenda valem para a financeira", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 99.9, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  createRecurringExpense({ fromNumber: n, description: "Aluguel", amount: 900, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const semana = await ask(app, n, "o que vence essa semana", { type: "report", scope: "finance", week: "current" });
  assert.match(semana, /^💳 Agenda financeira — semana \(19\/10 a 25\/10\)/);
  assert.match(semana, /Internet/);
  assert.doesNotMatch(semana, /Aluguel/);
  const novembro = await ask(app, n, "contas a pagar em novembro", { type: "report", scope: "finance", month: "2026-11" });
  assert.match(novembro, /^💳 Agenda financeira — novembro/);
  assert.match(novembro, /Qui 05\/11\n🔁 Aluguel · R\$ 900,00/);
  assert.match(novembro, /Sex 20\/11\n🔁 Internet/);
});

test("nada a pagar: 'Nada a pagar neste periodo.'; recorte invalido usa as mensagens da agenda", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  assert.equal(await ask(app, n, "agenda financeira", { type: "report", scope: "finance" }), "💳 Agenda financeira — próximos 30 dias\n\nNada a pagar neste período. 🎉");
  assert.match(await ask(app, n, "contas a pagar em novembro", { type: "report", scope: "finance", month: "novembro" }), /mês/i);
});

test("isolamento: a agenda financeira de um numero nunca mostra itens de outro", async (t) => {
  const app = bootApp(t, NOW);
  const a = user();
  const b = user();
  createRecurringExpense({ fromNumber: a, description: "Só do A", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 21 });
  createBillAlert({ fromNumber: a, name: "Conta do A", dayOfMonth: 22 });
  expenseRow(a, "Compra do A", 5, "2026-10-23");
  const doB = await ask(app, b, "agenda financeira", { type: "report", scope: "finance" });
  assert.match(doB, /Nada a pagar/);
  assert.doesNotMatch(doB, /do A|Só do A/);
});

test("'quanto gastei esse mes' continua sendo expense_report (nao vira agenda financeira)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  expenseRow(n, "Mercado", 40, "2026-10-10");
  const reply = await ask(app, n, "quanto gastei esse mês", { type: "expense_report", period: "month" });
  assert.doesNotMatch(reply, /Agenda financeira/);
  assert.match(reply, /40,00/);
});

test("a consulta financeira invalida a lista de agenda anterior: 'cancela o 1' depois dela nao apaga o evento", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Reunião lista", start: "2026-10-19T15:00:00-03:00", end: "2026-10-19T16:00:00-03:00" });
  const agenda = await ask(app, n, "o que tenho hoje", { type: "report", date: "2026-10-19" });
  assert.match(agenda, /1\. 15:00–16:00 Reunião lista/);
  await ask(app, n, "agenda financeira", { type: "report", scope: "finance" });
  const reply = await ask(app, n, "cancela o 1", { type: "delete_event", query: "", list_ref: 1 });
  assert.doesNotMatch(reply, /Cancelar este evento\?/);
  assert.ok(getEventById(n, ev.id), "o evento continua la");
  const pending = db.prepare(`SELECT kind FROM pending_state WHERE from_number = ?`).all(n) as { kind: string }[];
  assert.deepEqual(pending.filter((p) => p.kind === "delete_event"), []);
});

test("somente leitura: perguntar a agenda financeira nao muda alerta, gasto fixo nem gastos", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Net", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  createBillAlert({ fromNumber: n, name: "Gás", dayOfMonth: 21 });
  expenseRow(n, "Futuro", 5, "2026-10-30");
  const snapshot = () =>
    JSON.stringify([
      db.prepare(`SELECT * FROM bill_alerts WHERE from_number = ?`).all(n),
      db.prepare(`SELECT * FROM recurring_expenses WHERE from_number = ?`).all(n),
      db.prepare(`SELECT * FROM expenses WHERE from_number = ?`).all(n),
    ]);
  const before = snapshot();
  await ask(app, n, "agenda financeira", { type: "report", scope: "finance" });
  assert.equal(snapshot(), before);
});

test("ajuda por assunto 'finance' explica a agenda financeira", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const reply = await ask(app, n, "como vejo o que vence", { type: "help", topic: "finance" });
  assert.match(reply, /Como ver o que vai vencer \(agenda financeira\)/);
  assert.match(reply, /próximos 30 dias/);
});
