// Card 24, parte 2: Nivel B (IA restrita as opcoes da pergunta aberta), limites de chamadas e a chave AUTO_APPLY_INTERPRETED_PAID.
// A IA e simulada (bot.queueClassification); sem fila ela devolve 'nenhuma'. Nada interpretado e aplicado sem o "1" do cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, getOrCreatePaymentMethod, insertExpense, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { config } from "../../src/config";
import { REPLY_AI_MAX_CALLS, REPLY_AI_MAX_CHARS } from "../../src/confirmation/interpretReply";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00");
const LIST_DAY = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";
const CONFIRM_TAIL = "1 Sim, é isso\n2 Não, ver as opções";

let seq = 0;
function user(): string {
  const n = `55110009${String(1000 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

function openCheckin(n: string, name = "Conta de luz") {
  const bill = createBillAlert({ fromNumber: n, name, dayOfMonth: 14 });
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });
  return bill;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const logs = (n: string, type: string) => (db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = ? ORDER BY id`).all(n, type) as { summary: string }[]).map((r) => r.summary);

test("aviso de conta: frase sem vocabulario ('fechou, ta tudo em dia') -> IA escolhe a opcao 1 com confianca alta -> sugestao com confirmacao; nada aplicado", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  app.queueClassification({ option: 1, confidence: "alta" });
  assert.equal(await say(app, n, "fechou, tá tudo em dia"), `Entendi que foi *1 ✅ Já paguei*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(app.classifyCalls.length, 1);
  assert.deepEqual(app.classifyCalls[0], {
    questionText: 'Aviso "Conta de luz": o cliente já pagou?',
    options: [
      { number: 1, label: "✅ Já paguei", destructive: undefined },
      { number: 2, label: "⏰ Ainda não, me lembra amanhã", destructive: undefined },
      { number: 3, label: "⏭️ Não vou pagar este mês (pular)", destructive: true },
    ],
    text: "fechou, tá tudo em dia",
    fromAudio: false,
  });
  assert.equal(app.calls.length, 0, "achou a opcao: o pedido novo nem e tentado (RN01)");
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.ok(logs(n, "reply_interpreted")[0].includes("nivel B"));
  assert.match(await say(app, n, "1"), /Quanto foi/);
});

test("IA com confianca baixa, 'nenhuma', opcao invalida, resposta vazia ou erro: cai no 'Nao entendi' atual, sem erro pro cliente", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  const NOT_UNDERSTOOD = `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`;
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    for (const result of [
      { option: 1, confidence: "baixa" } as const,
      { option: null, confidence: "alta" } as const,
      { option: null, confidence: "baixa" } as const,
      new Error("Anthropic fora do ar"),
    ]) {
      app.queueClassification(result);
      assert.equal(await say(app, n, "hmm deixa eu ver aqui"), NOT_UNDERSTOOD);
      app.advance(11 * 60 * 1000); // fora da janela de limite
    }
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((e) => String(e[0]).includes("Erro ao interpretar a resposta com a IA")));
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
  assert.deepEqual(logs(n, "reply_interpreted"), []);
  assert.ok(logs(n, "pending_not_understood").length >= 4);
});

test("limites (RN10): no maximo 3 chamadas de IA por numero a cada 10 minutos; mensagem de mais de 200 caracteres e vazia nao vao a IA; depois da janela volta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  for (let i = 0; i < REPLY_AI_MAX_CALLS; i++) await say(app, n, `não sei o que dizer ${i}`);
  assert.equal(app.classifyCalls.length, REPLY_AI_MAX_CALLS);
  assert.equal(await say(app, n, "agora sim deu tudo certo"), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`, "4a mensagem: so o Nivel A");
  assert.equal(app.classifyCalls.length, REPLY_AI_MAX_CALLS, "a 4a nao chamou a IA");
  // o Nivel A continua valendo mesmo sem cota
  assert.match(await say(app, n, "eu já paguei"), /^Entendi que foi \*1 ✅ Já paguei\*/);
  await say(app, n, "3"); // descarta a sugestao e fecha (pula) o aviso pra liberar o teste seguinte

  const m = user();
  openCheckin(m);
  await say(app, m, "x".repeat(REPLY_AI_MAX_CHARS + 1));
  assert.equal(app.classifyCalls.length, REPLY_AI_MAX_CALLS, "mensagem longa nao vai a IA");

  // outra janela de 10 minutos: a cota volta
  app.advance(11 * 60 * 1000);
  const k = user();
  openCheckin(k);
  app.queueClassification({ option: 2, confidence: "alta" });
  assert.match(await say(app, k, "fica pra outro dia, valeu"), /^Entendi que foi \*2 ⏰ Ainda não, me lembra amanhã\*/);
  assert.equal(app.classifyCalls.length, REPLY_AI_MAX_CALLS + 1);
});

test("previa de edicao: IA escolhe a opcao 1 para uma frase sem vocabulario e so aplica depois do '1'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = insertExpense({ fromNumber: n, amount: 20, description: "Janta IA", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  await say(app, n, "muda a janta ia pra 25", { type: "edit_expense", query: "janta ia", changes: [{ field: "amount", value: "25" }] });
  app.queueClassification({ option: 1, confidence: "alta" });
  assert.equal(await say(app, n, "tudo certo por aqui"), `Entendi que foi *1 ✅ Confirmar*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(getExpenseById(n, exp.id)?.amount, 20);
  assert.equal(app.classifyCalls[0].questionText, 'Prévia de uma alteração de "Janta IA" pedindo para confirmar, corrigir ou cancelar');
  await say(app, n, "1");
  assert.equal(getExpenseById(n, exp.id)?.amount, 25);
});

test("apagar: IA 'baixa' para 'acho que sim' nunca sugere apagar; o gasto fica", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = insertExpense({ fromNumber: n, amount: 15, description: "Lanche IA", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  await say(app, n, "apaga o lanche ia", { type: "delete_expense", query: "lanche ia" });
  app.queueClassification({ option: 1, confidence: "baixa" });
  assert.match(await say(app, n, "acho que sim"), /^Não entendi 🤔 Responde \*1\* pra apagar/);
  assert.ok(getExpenseById(n, exp.id));
  assert.equal(app.classifyCalls[0].options[0].destructive, true, "a opcao de apagar vai marcada como destrutiva para a IA");
});

test("sem a chave, 'pago' interpretado SEMPRE pede confirmacao; com AUTO_APPLY_INTERPRETED_PAID ligada vai direto pra pergunta do valor repetindo o que entendeu (e so para 'pago')", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  assert.match(await say(app, n, "já paguei a conta hoje"), /^Entendi que foi \*1 ✅ Já paguei\*\. Confirma\?/);

  const saved = config.autoApplyInterpretedPaid;
  t.after(() => {
    config.autoApplyInterpretedPaid = saved;
  });
  config.autoApplyInterpretedPaid = true;
  const m = user();
  openCheckin(m);
  const before = app.sent.length;
  await say(app, m, "Já paguei a conta hoje.");
  const sent = app.sent.slice(before).map((s) => s.text);
  assert.equal(sent[0], 'Entendi "Já paguei a conta hoje." como já paguei.');
  assert.match(sent[1], /Quanto foi/);
  assert.equal(getPendingBillCheckin(m)?.step, "ask_value");
  assert.ok(!db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? AND kind = 'reply_confirm'`).get(m));
  assert.ok(logs(m, "reply_interpreted")[0].includes("AUTO_APPLY_INTERPRETED_PAID"));

  // adiar interpretado continua pedindo confirmacao mesmo com a chave ligada
  const k = user();
  openCheckin(k);
  assert.match(await say(app, k, "ainda não deu pra pagar"), /^Entendi que foi \*2 ⏰/);
});
