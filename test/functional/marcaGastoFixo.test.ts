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

// ---- filtro "so contas fixas" e o 🔁 (RN06) ------------------------------------------------------------

import { insertExpense } from "../../src/expenses/service";
import { FixedMark } from "../../src/expenses/fixedMark";

function addExpense(n: string, over: { amount: number; description: string; date: string; category?: string; payment?: string; fixed?: FixedMark | null }) {
  return insertExpense({
    fromNumber: n,
    amount: over.amount,
    description: over.description,
    categoryId: over.category ? getOrCreateCategory(n, over.category).id : null,
    paymentMethodId: over.payment ? getOrCreatePaymentMethod(n, over.payment).id : null,
    date: over.date,
    fixed: over.fixed ?? null,
  });
}

test("Card 15: 'mostra so as contas fixas deste mes' lista so os gastos com marca (as tres origens), com 🔁 e total", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  addExpense(n, { amount: 120, description: "Conta de água", date: TODAY, category: "Moradia", fixed: { source: "bill_alert", refId: 1 } });
  addExpense(n, { amount: 89.9, description: "Academia", date: "2026-10-05", category: "Saúde", payment: "Crédito", fixed: { source: "recurring", refId: 2 } });
  addExpense(n, { amount: 80, description: "Luz", date: "2026-10-10", category: "Moradia", fixed: { source: "user" } });
  addExpense(n, { amount: 50, description: "Mercado", date: TODAY, category: "Mercado" });
  addExpense(n, { amount: 999, description: "Conta de setembro", date: "2026-09-10", category: "Moradia", fixed: { source: "bill_alert", refId: 1 } });

  const text = await say(app, n, "mostra só as contas fixas deste mês", { type: "list_expenses", fixed_only: true, month: "2026-10" });
  assert.match(text, /^🧾 Contas fixas — outubro\/2026\n\n/);
  assert.ok(text.includes("R$ 120,00 — Conta de água (Moradia)") && text.includes("R$ 89,90 — Academia (Saúde, Crédito)") && text.includes("R$ 80,00 — Luz (Moradia)"));
  assert.ok(!text.includes("Mercado") && !text.includes("Conta de setembro"), "so os marcados, so do mes");
  assert.equal(text.split("\n").filter((l) => l.endsWith(" 🔁")).length, 3, "toda linha de conta fixa ganha 🔁");
  assert.match(text, /💰 Total: R\$ 289,90\n/);
});

test("Card 15: sem o filtro, a mesma lista mostra todos e so os fixos ganham 🔁", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  addExpense(n, { amount: 120, description: "Conta de água", date: TODAY, category: "Moradia", fixed: { source: "bill_alert", refId: 1 } });
  addExpense(n, { amount: 50, description: "Mercado", date: TODAY, category: "Mercado" });
  const text = await say(app, n, "gastos de hoje", { type: "list_expenses", date: TODAY });
  const lines = text.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(lines.length, 2);
  assert.ok(lines.find((l) => l.includes("Mercado"))?.endsWith("— hoje"), "avulso sem 🔁");
  assert.ok(lines.find((l) => l.includes("Conta de água"))?.endsWith(" 🔁"));
});

test("Card 15: 'contas fixas de setembro' aplica o mes; combina com categoria; outro numero nao aparece; sem nenhuma, mensagem propria", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const other = user();
  addExpense(n, { amount: 100, description: "Internet", date: "2026-09-10", category: "Moradia", fixed: { source: "bill_alert", refId: 1 } });
  addExpense(n, { amount: 40, description: "Streaming", date: "2026-09-12", category: "Lazer", fixed: { source: "recurring", refId: 2 } });
  addExpense(other, { amount: 777, description: "Segredo", date: "2026-09-10", category: "Moradia", fixed: { source: "user" } });

  const setembro = await say(app, n, "contas fixas de setembro", { type: "list_expenses", fixed_only: true, month: "2026-09" });
  assert.match(setembro, /^🧾 Contas fixas — setembro\/2026\n/);
  assert.match(setembro, /💰 Total: R\$ 140,00\n/);
  assert.ok(!setembro.includes("Segredo"));

  const lazer = await say(app, n, "contas fixas de lazer em setembro", { type: "list_expenses", fixed_only: true, category: "Lazer", month: "2026-09" });
  assert.match(lazer, /^🧾 Contas fixas de Lazer — setembro\/2026\n/);
  assert.ok(lazer.includes("Streaming") && !lazer.includes("Internet"));

  assert.equal(await say(app, n, "contas fixas de agosto", { type: "list_expenses", fixed_only: true, month: "2026-08" }), "Nenhuma conta fixa lançada nesse período.");
  assert.equal(await say(app, other, "contas fixas de outubro", { type: "list_expenses", fixed_only: true, month: "2026-10" }), "Nenhuma conta fixa lançada nesse período.");

  // sem periodo: os ultimos com o filtro
  const recentes = await say(app, n, "minhas contas fixas lançadas", { type: "list_expenses", fixed_only: true });
  assert.match(recentes, /^🧾 Contas fixas — últimos 2 gastos\n/);
});

test("Card 15: o relatorio 'quanto paguei de conta fixa em setembro' soma so os marcados", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  addExpense(n, { amount: 100, description: "Internet", date: "2026-09-10", category: "Moradia", fixed: { source: "bill_alert", refId: 1 } });
  addExpense(n, { amount: 40, description: "Streaming", date: "2026-09-12", category: "Lazer", fixed: { source: "recurring", refId: 2 } });
  addExpense(n, { amount: 500, description: "Viagem", date: "2026-09-20", category: "Lazer" });
  const text = await say(app, n, "quanto paguei de conta fixa em setembro", { type: "expense_report", fixed_only: true, month: "2026-09" });
  assert.match(text, /^💰 Contas fixas — setembro\/2026\n\nTotal: R\$ 140,00 em 2 gasto\(s\)/);
  assert.match(text, /• Moradia: R\$ 100,00\n• Lazer: R\$ 40,00$/);
  assert.equal(
    await say(app, n, "quanto paguei de conta fixa em agosto", { type: "expense_report", fixed_only: true, month: "2026-08" }),
    "💰 Contas fixas — agosto/2026\n\nNenhuma conta fixa lançada nesse período."
  );
});

// ---- campo "Tipo" na edicao de gasto (RN14) -------------------------------------------------------------

import { getExpenseById } from "../../src/expenses/service";

const markOf = (n: string, id: number) => {
  const row = getExpenseById(n, id)!;
  return [row.fixed_source, row.fixed_ref_id];
};

test("Card 15: 'marca o ultimo gasto como conta fixa' mostra 'Tipo: avulso → conta fixa' e so grava no 1; desfazer restaura", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = addExpense(n, { amount: 80, description: "Luz", date: TODAY, category: "Moradia", payment: "Pix" });
  const preview = await say(app, n, "marca o último gasto como conta fixa", { type: "edit_expense", query: "luz", changes: [{ field: "fixed", value: "sim" }] });
  assert.match(preview, /^✏️ Luz — R\$ 80,00 · 14\/10 · Pix\nTipo: avulso → conta fixa\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar$/);
  assert.deepEqual(markOf(n, exp.id), [null, null], "nada gravado antes do 1");
  await say(app, n, "1");
  assert.match(app.last(), /^✏️ "Luz" atualizado: tipo conta fixa\./);
  assert.deepEqual(markOf(n, exp.id), ["user", null]);
  await say(app, n, "desfaz isso", { type: "undo" });
  assert.deepEqual(markOf(n, exp.id), [null, null], "o desfazer restaura a marca anterior");
});

test("Card 15: 'isso nao e conta fixa' num gasto lancado por conta fixa volta a avulso; desfazer devolve a origem e o id", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = addExpense(n, { amount: 120, description: "Conta de água", date: TODAY, category: "Moradia", fixed: { source: "bill_alert", refId: 7 } });
  const preview = await say(app, n, "isso não é conta fixa", { type: "edit_expense", query: "conta de água", changes: [{ field: "fixed", value: "não" }] });
  assert.match(preview, /\nTipo: conta fixa → avulso\n/);
  await say(app, n, "1");
  assert.deepEqual(markOf(n, exp.id), [null, null]);
  await say(app, n, "desfaz isso", { type: "undo" });
  assert.deepEqual(markOf(n, exp.id), ["bill_alert", 7]);
});

test("Card 15: pedir o tipo que o gasto ja tem responde 'Ja esta assim'; cancelar nao muda; valor invalido pergunta de novo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const fixo = addExpense(n, { amount: 80, description: "Luz fixa", date: TODAY, category: "Moradia", fixed: { source: "user" } });
  addExpense(n, { amount: 10, description: "Cafe", date: TODAY, category: "Mercado" });
  assert.equal(await say(app, n, "marca a luz fixa como conta fixa", { type: "edit_expense", query: "luz fixa", changes: [{ field: "fixed", value: "sim" }] }), "Já está assim, não mexi em nada.");
  assert.equal(await say(app, n, "o café não é conta fixa", { type: "edit_expense", query: "cafe", changes: [{ field: "fixed", value: "não" }] }), "Já está assim, não mexi em nada.");

  await say(app, n, "a luz fixa não é fixa", { type: "edit_expense", query: "luz fixa", changes: [{ field: "fixed", value: "avulso" }] });
  await say(app, n, "3");
  assert.equal(app.last(), "Beleza, não mexi em nada.");
  assert.deepEqual(markOf(n, fixo.id), ["user", null]);

  assert.match(await say(app, n, "a luz fixa é meio fixa", { type: "edit_expense", query: "luz fixa", changes: [{ field: "fixed", value: "meio" }] }), /^Não entendi o tipo "meio"\. Responde \*fixo\* ou \*avulso\*\./);
});

test("Card 15: o menu de campos do gasto ganhou 'Tipo' (6) e a resposta passa pela previa", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = addExpense(n, { amount: 80, description: "Luz menu", date: TODAY, category: "Moradia", payment: "Pix" });
  await say(app, n, "editar");
  await say(app, n, "1"); // gasto
  await say(app, n, "1"); // o item
  assert.match(app.last(), /\n5 Pagamento\n6 Tipo\n\nPode escolher mais de um: "1 e 6"/);
  assert.match(await say(app, n, "6"), /^Esse gasto é \*fixo\* \(conta fixa\) ou \*avulso\*\? Responde fixo ou avulso\./);
  assert.equal(await say(app, n, "talvez"), "Responde *fixo* (conta fixa) ou *avulso*.\nEsse gasto é *fixo* (conta fixa) ou *avulso*? Responde fixo ou avulso. Ou *cancelar*.");
  const preview = await say(app, n, "fixo");
  assert.match(preview, /\nTipo: avulso → conta fixa\n/);
  await say(app, n, "1");
  assert.deepEqual(markOf(n, exp.id), ["user", null]);

  // por nome tambem: "tipo"
  await say(app, n, "editar");
  await say(app, n, "1");
  await say(app, n, "1");
  assert.match(await say(app, n, "tipo"), /Esse gasto é \*fixo\*/);
});

test("Card 15: o 2 (Corrigir) da previa de Tipo pergunta o novo tipo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = addExpense(n, { amount: 80, description: "Luz corrige", date: TODAY, category: "Moradia", payment: "Pix" });
  await say(app, n, "marca a luz corrige como fixa", { type: "edit_expense", query: "luz corrige", changes: [{ field: "fixed", value: "sim" }] });
  assert.equal(await say(app, n, "2"), "Qual é o novo tipo (fixo ou avulso)? Ou responde *cancelar*.");
  assert.match(await say(app, n, "fixo"), /Tipo: avulso → conta fixa/);
  await say(app, n, "1");
  assert.deepEqual(markOf(n, exp.id), ["user", null]);
});

test("Card 15: editar o valor de um gasto marcado nao mexe na marca", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = addExpense(n, { amount: 120, description: "Conta de agua marcada", date: TODAY, category: "Moradia", fixed: { source: "bill_alert", refId: 9 } });
  await say(app, n, "muda o valor pra 130", { type: "edit_expense", query: "conta de agua marcada", changes: [{ field: "amount", value: "130" }] });
  await say(app, n, "1");
  assert.equal(getExpenseById(n, exp.id)?.amount, 130);
  assert.deepEqual(markOf(n, exp.id), ["bill_alert", 9]);
  await say(app, n, "desfaz isso", { type: "undo" });
  assert.deepEqual(markOf(n, exp.id), ["bill_alert", 9]);
});
