// Card 24, parte 3: audio -- "🎧 Ouvi: ..." (so em audio), dica de vocabulario ao Whisper quando ha pergunta aberta, filtro de eco e o registro da
// transcricao (so nos casos nao entendidos ou interpretados). O Whisper e simulado (bot.queueTranscription).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { audioMsg, bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, getOrCreatePaymentMethod, insertExpense, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { REPLY_VOCAB_HINT } from "../../src/ai/transcribe";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00");
const LIST_DAY = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";
const CONFIRM_TAIL = "1 Sim, é isso\n2 Não, ver as opções";

let seq = 0;
function user(): string {
  const n = `55110009${String(1200 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

function openCheckin(n: string) {
  const bill = createBillAlert({ fromNumber: n, name: "Conta de luz", dayOfMonth: 14 });
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });
  return bill;
}

async function speak(app: BotApp, n: string, transcript: string | Error, ...actions: Interpretation[]) {
  app.queueTranscription(transcript);
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(audioMsg(n));
  return app.last();
}

async function type(app: BotApp, n: string, text: string) {
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const logs = (n: string, type: string) => (db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = ? ORDER BY id`).all(n, type) as { summary: string }[]).map((r) => r.summary);

test("REPRODUCAO: audio 'Já paguei a conta hoje.' ao aviso de conta -> mostra o que ouviu e pede confirmacao; o Whisper recebe a dica de vocabulario e temperatura 0", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  const reply = await speak(app, n, "Já paguei a conta hoje.");
  assert.equal(reply, `🎧 Ouvi: "Já paguei a conta hoje."\nEntendi que foi *1 ✅ Já paguei*. Confirma?\n${CONFIRM_TAIL}`);
  assert.deepEqual(app.transcribeCalls, [{ filename: "audio.ogg", options: { prompt: REPLY_VOCAB_HINT, temperature: 0 } }]);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null, "nada aplicado ainda");
  assert.match(await type(app, n, "1"), /Quanto foi/);
});

test("sem pergunta aberta o Whisper nao recebe dica; texto digitado nunca mostra 'Ouvi'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  app.queueTranscription("oi tudo bem");
  app.queueReply([]);
  await app.handle(audioMsg(n));
  assert.deepEqual(app.transcribeCalls, [{ filename: "audio.ogg", options: undefined }]);

  const m = user();
  openCheckin(m);
  assert.doesNotMatch(await type(app, m, "Já paguei a conta hoje."), /🎧/);
  const k = user();
  openCheckin(k);
  assert.doesNotMatch(await type(app, k, "não, já paguei"), /🎧/);
});

test("'Nao entendi' em audio mostra o que foi ouvido (ate 120 caracteres); conflito, ambiguidade e sem vocabulario nao viram sugestao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  assert.equal(await speak(app, n, "Não, já paguei."), `🎧 Ouvi: "Não, já paguei."\nNão entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);
  const longText = `hmm ${"deixa eu pensar ".repeat(12)}`.trim();
  const long = await speak(app, n, longText);
  assert.ok(long.startsWith(`🎧 Ouvi: "hmm deixa eu pensar`));
  assert.ok(long.split("\n")[0].endsWith('…"'), "truncado");
  assert.ok(Array.from(long.split("\n")[0]).length <= `🎧 Ouvi: ""`.length + 120);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
});

test("resposta exata em audio ('Sim.', 'Um.', 'Já paguei.') segue como hoje: sem 'Ouvi', sem confirmacao extra, sem registro novo", async (t) => {
  const app = bootApp(t, NOW);
  for (const heard of ["Sim.", "Um.", "Já paguei."]) {
    const n = user();
    openCheckin(n);
    const reply = await speak(app, n, heard);
    assert.match(reply, /Quanto foi/, heard);
    assert.doesNotMatch(reply, /🎧/, heard);
    assert.deepEqual(logs(n, "reply_interpreted"), [], heard);
    assert.deepEqual(logs(n, "pending_not_understood"), [], heard);
  }
});

test("eco da dica ou transcricao vazia: tratado como audio nao entendido (sem 'Ouvi' e sem sugestao)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  for (const heard of [REPLY_VOCAB_HINT, `${REPLY_VOCAB_HINT}.`, "sim, não, um, dois, três", "", "   "]) {
    const reply = await speak(app, n, heard);
    assert.equal(reply, `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`, JSON.stringify(heard));
  }
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
  // sem pergunta aberta nao ha dica, entao a frase "eco" e so uma frase normal (nada e filtrado)
  const m = user();
  app.queueTranscription(REPLY_VOCAB_HINT);
  app.queueReply([]);
  await app.handle(audioMsg(m));
  assert.equal(app.transcribeCalls[app.transcribeCalls.length - 1].options, undefined);
});

test("falha do Whisper: a mensagem de sempre; falha da IA em audio: 'Nao entendi' com 'Ouvi'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    assert.equal(await speak(app, n, new Error("Groq fora do ar")), "Deu erro aqui do meu lado tentando ouvir esse áudio. Tenta de novo em instantes, ou manda por texto?");
    app.queueClassification(new Error("Anthropic fora do ar"));
    assert.equal(await speak(app, n, "fechou, tá tudo em dia"), `🎧 Ouvi: "fechou, tá tudo em dia"\nNão entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);
  } finally {
    console.error = original;
  }
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid");
});

test("previa de edicao em audio: 'isso mesmo, pode salvar' mostra o Ouvi e a sugestao; so aplica depois do '1'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = insertExpense({ fromNumber: n, amount: 20, description: "Janta audio", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  app.queueReply([{ type: "edit_expense", query: "janta audio", changes: [{ field: "amount", value: "25" }] }]);
  await type(app, n, "muda a janta audio pra 25");
  assert.equal(await speak(app, n, "Isso mesmo, pode salvar."), `🎧 Ouvi: "Isso mesmo, pode salvar."\nEntendi que foi *1 ✅ Confirmar*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(getExpenseById(n, exp.id)?.amount, 20);
  await type(app, n, "1");
  assert.equal(getExpenseById(n, exp.id)?.amount, 25);
  assert.deepEqual(app.transcribeCalls[0].options, { prompt: REPLY_VOCAB_HINT, temperature: 0 });
});

test("registro (RN11): a transcricao vai pro log, truncada em 200 caracteres, so quando interpretada ou nao entendida; texto digitado nunca leva a transcricao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  await speak(app, n, "Já paguei a conta hoje.");
  assert.ok(logs(n, "reply_interpreted")[0].endsWith('; ouvi: "Já paguei a conta hoje."'), logs(n, "reply_interpreted")[0]);

  const m = user();
  openCheckin(m);
  const long = `não sei ${"muito ".repeat(60)}`.trim();
  await speak(app, m, long);
  const entry = logs(m, "pending_not_understood")[0];
  const logged = entry.slice(entry.indexOf('; ouvi: "') + '; ouvi: "'.length, -1);
  assert.equal(Array.from(logged).length, 200);
  assert.ok(logged.endsWith("…"));

  const k = user();
  openCheckin(k);
  await type(app, k, "não, já paguei");
  assert.ok(!logs(k, "pending_not_understood")[0].includes("ouvi:"));
  const j = user();
  openCheckin(j);
  await type(app, j, "já paguei a conta hoje");
  assert.ok(!logs(j, "reply_interpreted")[0].includes("ouvi:"));
});

test("isolamento: a sugestao ouvida de um numero nao aparece pro outro", async (t) => {
  const app = bootApp(t, NOW);
  const a = user();
  const b = user();
  openCheckin(a);
  openCheckin(b);
  await speak(app, a, "Já paguei a conta hoje.");
  const reply = await type(app, b, "1");
  assert.match(reply, /Quanto foi/);
  assert.equal(getPendingBillCheckin(a)?.step, "ask_paid");
});

test("ajuda por assunto 'voice_reply' explica que da pra responder por audio ou com as proprias palavras e que o bot repete o que entendeu", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  app.queueReply([{ type: "help", topic: "voice_reply" }]);
  const reply = await type(app, n, "posso responder por audio?");
  assert.match(reply, /Responder por áudio ou com suas palavras/);
  assert.match(reply, /Entendi que foi \*1 ✅ Já paguei\*\. Confirma\?/);
  assert.match(reply, /Nada é feito antes da sua confirmação/);
});
