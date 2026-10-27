// Revisao do Card 24: pedido novo nao vira resposta, IA so quando faz sentido, origem (audio/texto) sem corrida entre mensagens simultaneas, texto vazio
// sem IA, assinatura da pergunta por nome do tipo e leitura unica das pendencias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { audioMsg, bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { createEvent } from "../../src/events/service";
import { listOpenPendingKinds, setPending } from "../../src/pending/store";
import { REPLY_VOCAB_HINT } from "../../src/ai/transcribe";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00");
const LIST_DAY = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";
const NOT_UNDERSTOOD = `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`;

let seq = 0;
function user(): string {
  const n = `55110009${String(1500 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

function openCheckin(n: string, step: "ask_paid" | "ask_value" = "ask_paid") {
  const bill = createBillAlert({ fromNumber: n, name: "Conta de luz", dayOfMonth: 14 });
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days, step });
  return bill;
}

async function say(app: BotApp, n: string, text: string) {
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const logs = (n: string, type: string) => (db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = ? ORDER BY id`).all(n, type) as { summary: string }[]).map((r) => r.summary);

test("pedido novo de lembrete ('me lembra de ...', 'me lembra amanha de ...') nao vira a resposta 2 do aviso; 'me lembra amanha' sozinho continua valendo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  for (const phrase of ["me lembra de ligar pro dentista amanhã", "me lembra amanhã de ligar pro dentista", "me lembra que preciso renovar o seguro"]) {
    const reply = await say(app, n, phrase);
    assert.doesNotMatch(reply, /Entendi que foi/, phrase);
  }
  assert.deepEqual(app.calls.length > 0, true, "o pedido novo foi tentado");
  assert.match(await say(app, n, "me lembra amanhã por favor"), /^Entendi que foi \*2 ⏰ Ainda não, me lembra amanhã\*/);
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
});

test("a IA de resposta nao e chamada para frase com digito (valor, data, hora) nem para frase longa: so o pedido novo roda", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  app.queueReply([{ type: "expense", amount: 50, description: "mercado", category: "Mercado", date: "2026-10-14" }]);
  await say(app, n, "gastei 50 no mercado");
  await say(app, n, "marca dentista amanhã às 15h");
  await say(app, n, "uma frase muito longa que passa de doze palavras e claramente nao e uma resposta curta a pergunta do aviso");
  assert.equal(app.classifyCalls.length, 0, "nenhuma chamada de classify_reply");
  assert.ok(app.calls.length >= 2, "os pedidos novos seguiram para a interpretacao normal");
  // frase curta sem digito continua indo a IA
  await say(app, n, "fechou, tá tudo em dia");
  assert.equal(app.classifyCalls.length, 1);
});

test("origem sem corrida: audio e texto do MESMO numero em paralelo -- so o do audio mostra 'Ouvi', e cada um com o seu texto", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  app.queueTranscription("hmm deixa eu pensar");
  app.resetLimit();
  const before = app.sent.length;
  await Promise.all([app.handle(audioMsg(n)), app.handle(msg(n, "talvez outro dia"))]);
  const replies = app.sent.slice(before).map((m) => m.text);
  assert.equal(replies.length, 2);
  const heard = replies.filter((r) => r.startsWith("🎧"));
  assert.equal(heard.length, 1, "so o audio tem 'Ouvi'");
  assert.equal(heard[0], `🎧 Ouvi: "hmm deixa eu pensar"\n${NOT_UNDERSTOOD}`);
  assert.ok(replies.includes(NOT_UNDERSTOOD), "o texto digitado fica sem 'Ouvi'");
  assert.ok(logs(n, "pending_not_understood").some((s) => s.includes('ouvi: "hmm deixa eu pensar"')));
  assert.ok(logs(n, "pending_not_understood").some((s) => !s.includes("ouvi:")));
});

test("audio vazio ou eco da dica numa previa de evento: nenhuma chamada a IA de data; so o 'Nao entendi'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createEvent({ fromNumber: n, title: "Reunião vazia", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  app.queueReply([{ type: "edit_event", query: "reunião vazia", new_time: "15:00" }]);
  await say(app, n, "remarca a reunião vazia pras 15h");
  const ai = require("../../src/ai/interpret");
  let aiCalls = 0;
  t.mock.method(ai, "extractDateTimeFromAnswer", async () => {
    aiCalls++;
    return null;
  });
  for (const heard of ["", REPLY_VOCAB_HINT, "   "]) {
    app.queueTranscription(heard);
    app.resetLimit();
    await app.handle(audioMsg(n));
    assert.match(app.last(), /^Não entendi 🤔 Responde \*1\* pra confirmar/);
  }
  assert.equal(aiCalls, 0);
});

test("falha da IA do pedido novo em audio: o log guarda o que foi ouvido (truncado) como no caminho normal", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  app.failNext();
  app.queueTranscription("quero uma pizza grande agora");
  app.resetLimit();
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    await app.handle(audioMsg(n));
  } finally {
    console.error = original;
  }
  const entry = logs(n, "pending_not_understood").find((s) => s.includes("IA falhou"));
  assert.ok(entry, "registrou a falha");
  assert.ok(entry!.endsWith('; ouvi: "quero uma pizza grande agora"'), entry);
});

test("assinatura da pergunta: se o aviso foi REPOSTO (nova pergunta) depois da sugestao, o '1' diz que a pergunta ja nao esta aberta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  assert.match(await say(app, n, "já paguei a conta hoje"), /^Entendi que foi \*1/);
  app.advance(1000);
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days }); // outro aviso, mesma conta
  assert.equal(await say(app, n, "1"), "Essa pergunta já não está mais aberta.");
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid", "nada foi aplicado");
});

test("assinatura da pergunta: uma pendencia que vive so em memoria (completar gasto) que apareceu depois tambem invalida a sugestao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  await say(app, n, "já paguei a conta hoje");
  const completion = require("../../src/completion/pendingCompletion");
  const before = completion.getNextPendingCompletion(n);
  assert.equal(before, null);
  completion.addPendingCompletion(n, { intent: "expense", amount: 40, description: "mercado", missing: ["amount"] });
  assert.equal(await say(app, n, "1"), "Essa pergunta já não está mais aberta.", "surgiu outra pergunta: o '1' nao vai pro aviso por engano");
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
});

test("dica do Whisper: so quando ha pergunta de opcoes aberta -- previa, apagar e aviso (ask_paid); nao no valor da conta nem sem nada aberto", async (t) => {
  const app = bootApp(t, NOW);
  const withHint = { prompt: REPLY_VOCAB_HINT, temperature: 0 };

  const a = user();
  openCheckin(a, "ask_value");
  app.queueTranscription("120");
  app.resetLimit();
  await app.handle(audioMsg(a));
  assert.equal(app.transcribeCalls[app.transcribeCalls.length - 1].options, undefined, "pergunta do valor: sem dica");

  const b = user();
  openCheckin(b, "ask_paid");
  app.queueTranscription("sim");
  app.resetLimit();
  await app.handle(audioMsg(b));
  assert.deepEqual(app.transcribeCalls[app.transcribeCalls.length - 1].options, withHint);

  const c = user();
  app.queueReply([{ type: "delete_event", query: "reuniao dica" }]);
  createEvent({ fromNumber: c, title: "Reunião dica", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  await say(app, c, "cancela a reunião dica");
  app.queueTranscription("sim");
  app.resetLimit();
  await app.handle(audioMsg(c));
  assert.deepEqual(app.transcribeCalls[app.transcribeCalls.length - 1].options, withHint);

  const d = user();
  app.queueTranscription("oi");
  app.queueReply([]);
  await app.handle(audioMsg(d));
  assert.equal(app.transcribeCalls[app.transcribeCalls.length - 1].options, undefined);
});

test("listOpenPendingKinds: uma leitura, so as abertas (nao vencidas) do proprio numero, em ordem de tipo", () => {
  const n = user();
  const other = user();
  const now = 5_000_000;
  setPending(n, "edit_event", { payload: {}, ttlMs: 1000, version: 1, now });
  setPending(n, "delete_expense", { payload: {}, ttlMs: 60_000, version: 1, now: now + 10 });
  setPending(n, "undo", { payload: {}, ttlMs: 1, version: 1, now: now - 1000 }); // ja venceu
  setPending(other, "edit_income", { payload: {}, ttlMs: 60_000, version: 1, now });
  assert.deepEqual(listOpenPendingKinds(n, now + 500), [
    { kind: "delete_expense", createdAt: now + 10 },
    { kind: "edit_event", createdAt: now },
  ]);
  assert.deepEqual(listOpenPendingKinds(n, now + 5000), [{ kind: "delete_expense", createdAt: now + 10 }], "o de 1 s ja venceu");
  assert.deepEqual(listOpenPendingKinds("5500000000000", now), []);
});
