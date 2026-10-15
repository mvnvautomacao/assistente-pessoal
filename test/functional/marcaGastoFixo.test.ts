// Card 15 (RN05, RN13, RN15): marca de "conta fixa" nos gastos. Padrao: NAO fixo. So nasce fixo quando o usuario
// declara explicitamente, ou quando o gasto vem de uma conta fixa / gasto fixo automatico.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod, learnKeyword, getOrCreateCategory } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createRecurringExpense, listRecurringExpenses } from "../../src/expenses/recurring";
import { launchRecurringExpense } from "../../src/expenses/recurringLaunch";
import { db } from "../../src/db";

const NOW = new Date("2026-10-14T12:00:00-03:00").getTime();
const TODAY = "2026-10-14";

let seq = 0;
function user(options: { defaultPayment?: boolean } = {}): string {
  const n = `55110009900${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  if (options.defaultPayment !== false) setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

const rows = (n: string) =>
  db.prepare(`SELECT id, amount, description, date, fixed_source, fixed_ref_id FROM expenses WHERE from_number = ? ORDER BY id`).all(n) as {
    id: number;
    amount: number;
    description: string;
    date: string;
    fixed_source: string | null;
    fixed_ref_id: number | null;
  }[];

function know(n: string, keyword: string, category = "Moradia") {
  learnKeyword(n, keyword, getOrCreateCategory(n, category).id);
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("Card 15: 'gastei 80 na luz' e 'luz 80' nascem avulsos (nao fixos) e sem rotulo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  know(n, "luz");
  const text = await say(app, n, "gastei 80 na luz", { type: "expense", amount: 80, description: "luz", date: TODAY });
  assert.ok(text.startsWith("✅ Gasto registrado: R$80.00 — luz\nCategoria: Moradia"), text);
  assert.ok(!text.includes("conta fixa"));
  await say(app, n, "luz 80", { type: "expense", amount: 80, description: "luz", date: TODAY, is_fixed: false });
  assert.deepEqual(rows(n).map((r) => r.fixed_source), [null, null]);
});

test("Card 15: 'gastei 80 na luz, conta fixa' nasce fixo (marca 'user') e a resposta diz '(conta fixa)'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  know(n, "luz");
  const text = await say(app, n, "gastei 80 na luz, conta fixa", { type: "expense", amount: 80, description: "luz", date: TODAY, is_fixed: true });
  assert.ok(text.startsWith("✅ Gasto registrado: R$80.00 — luz (conta fixa)\nCategoria: Moradia"), text);
  const [row] = rows(n);
  assert.equal(row.fixed_source, "user");
  assert.equal(row.fixed_ref_id, null);
});

test("Card 15: 'paguei a luz' e 'aluguel 1500' (sem a palavra fixo) ficam avulsos e o bot nao pergunta se e fixo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  know(n, "luz");
  know(n, "aluguel");
  await say(app, n, "paguei a luz", { type: "expense", amount: 80, description: "luz", date: TODAY });
  const aluguel = await say(app, n, "aluguel 1500", { type: "expense", amount: 1500, description: "aluguel", date: TODAY });
  assert.ok(!/fixo|fixa/i.test(aluguel), aluguel);
  assert.equal(app.sent.length, 2, "uma resposta por pedido, nenhuma pergunta extra");
  assert.deepEqual(rows(n).map((r) => r.fixed_source), [null, null]);
});

test("Card 15: dois gastos na mesma mensagem -- so o declarado fixo ganha a marca", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  know(n, "luz");
  know(n, "mercado", "Mercado");
  await say(
    app,
    n,
    "gastei 80 na luz, conta fixa, e 50 no mercado",
    { type: "expense", amount: 80, description: "luz", date: TODAY, is_fixed: true },
    { type: "expense", amount: 50, description: "mercado", date: TODAY }
  );
  assert.deepEqual(rows(n).map((r) => [r.description, r.fixed_source]), [["luz", "user"], ["mercado", null]]);
  assert.match(app.last(), /1\. R\$80\.00 em Moradia — luz \(conta fixa\)/);
  assert.ok(!app.last().includes("mercado (conta fixa)"));
});

test("Card 15: compra parcelada -- sem 'fixo' todas as parcelas avulsas; dita fixa, todas ficam marcadas", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  know(n, "geladeira", "Compras");
  know(n, "plano de saude", "Saúde");
  await say(app, n, "geladeira em 3x de 100", { type: "installment_expense", description: "geladeira", installments: 3, installment_amount: 100 });
  assert.deepEqual(rows(n).map((r) => r.fixed_source), [null, null, null]);

  const text = await say(app, n, "plano de saúde 3x de 200, gasto fixo", { type: "installment_expense", description: "plano de saude", installments: 3, installment_amount: 200, is_fixed: true });
  assert.match(text, /Compra parcelada registrada: "plano de saude" \(conta fixa\)/);
  const parcelas = rows(n).slice(3);
  assert.equal(parcelas.length, 3);
  assert.ok(parcelas.every((r) => r.fixed_source === "user"));
});

test("Card 15: gasto incompleto -- a marca 'fixo' sobrevive as perguntas de valor, categoria e forma de pagamento", async (t) => {
  const app = bootApp(t, NOW);
  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractExpenseInfoFromAnswer", async () => ({ amount: 80 }));
  const n = user({ defaultPayment: false });
  // "gasto fixo de luz" -> falta o valor
  const ask = await say(app, n, "gasto fixo de luz", { type: "unknown", likely_intent: "expense", description: "luz", is_fixed: true });
  assert.match(ask, /Quanto foi/i);
  await say(app, n, "80"); // valor -> falta categoria (nao conhecida)
  assert.match(app.last(), /Qual categoria/i);
  await say(app, n, "Moradia"); // categoria -> falta forma de pagamento (sem padrao)
  assert.match(app.last(), /forma de pagamento/i);
  await say(app, n, "Pix");
  const [row] = rows(n);
  assert.equal(row.amount, 80);
  assert.equal(row.fixed_source, "user", "a marca atravessou as tres perguntas");
  assert.match(app.last(), /\(conta fixa\)/);
});

test("Card 15: gasto incompleto SEM a palavra fixo termina avulso", async (t) => {
  const app = bootApp(t, NOW);
  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractExpenseInfoFromAnswer", async () => ({ amount: 80 }));
  const n = user();
  know(n, "luz");
  await say(app, n, "luz", { type: "unknown", likely_intent: "expense", description: "luz" });
  await say(app, n, "80");
  assert.equal(rows(n)[0].fixed_source, null);
});

test("Card 15: gasto lancado pelo cron / opcao 'lancar o deste mes' do gasto fixo automatico fica com a marca 'recurring'", async () => {
  const n = user();
  const recurring = createRecurringExpense({ fromNumber: n, description: "Academia", amount: 89.9, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  launchRecurringExpense(listRecurringExpenses(n)[0], TODAY);
  const [row] = rows(n);
  assert.equal(row.fixed_source, "recurring");
  assert.equal(row.fixed_ref_id, recurring.id);
});

test("Card 15: gastos antigos (colunas nulas) continuam nao fixos; apagar nao quebra", async () => {
  const n = user();
  db.prepare(`INSERT INTO expenses (from_number, amount, description, date, created_at) VALUES (?, 10, 'antigo', ?, ?)`).run(n, TODAY, new Date().toISOString());
  const [row] = rows(n);
  assert.equal(row.fixed_source, null);
  assert.equal(row.fixed_ref_id, null);
});
