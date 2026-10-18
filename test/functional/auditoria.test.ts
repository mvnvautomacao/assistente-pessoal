// Auditoria dos Cards 1 a 7: testes que FALTAVAM pra provar criterios de aceitacao
// (ver docs/auditoria-cards-1-a-7.md). Nenhum codigo de producao foi alterado.
//
// Convencao dos defeitos achados: o teste descreve o comportamento ESPERADO e esta
// marcado { todo } -- falha hoje, nao quebra a suite e vira teste de regressao quando
// o defeito for corrigido (basta tirar o "todo"). Ids "D-xx" = ids do relatorio.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import cron from "node-cron";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import * as aiTranscribe from "../../src/ai/transcribe";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import {
  ensureUserSeeded,
  getOrCreateCategory,
  getOrCreatePaymentMethod,
  setDefaultPaymentMethod,
  insertExpense,
  getExpenseById,
  findRecentExpense,
} from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { resetRateLimitForTests } from "../../src/access/rateLimit";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";
import { spDateString, addDaysToDateString } from "../../src/timeSP";
import { db } from "../../src/db";
import * as eventsService from "../../src/events/service";
import * as remindersService from "../../src/reminders/service";
import * as incomesService from "../../src/incomes/service";
import { createRecurringExpense, getRecurringExpenseById } from "../../src/expenses/recurring";
import { startReminderScheduler, SNOOZE_HINT } from "../../src/reminders/scheduler";
import { startPendingCleanup } from "../../src/pending/cleanup";
import { setPending, getPending } from "../../src/pending/store";

// ---- helpers (mesmo padrao de webhook.test.ts) ---------------------------------

function evolutionMessage(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `aud-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

function evolutionAudioMessage(from: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `aud-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "audioMessage" as const,
    message: { base64: "ZmFrZS1hdWRpby1kYXRh" },
  };
}

type Sent = { to: string; text: string };

function withMocks(t: TestContext) {
  resetRateLimitForTests();
  resetOwnerAlertForTests();
  const sent: Sent[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  const queue: Interpretation[][] = [];
  t.mock.method(aiInterpret, "interpretText", async () => queue.shift() ?? []);
  return { sent, queueReply: (actions: Interpretation[]) => queue.push(actions) };
}

function seed(...numbers: string[]) {
  for (const n of numbers) {
    ensureUserSeeded(n);
    allowNumber(n);
    setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  }
}

const today = () => spDateString();
const futureAt = (daysAhead: number, hour: number) => `${addDaysToDateString(spDateString(), daysAhead)}T${String(hour).padStart(2, "0")}:00:00-03:00`;
const last = (sent: Sent[]) => sent[sent.length - 1].text;
const pendingKinds = (n: string) =>
  (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);

// ---- "reinicio do servidor": descarta TODOS os modulos de src (menos o banco e a config) ----
// e carrega o router de novo. Todo estado em memoria some; o SQLite (mesmo handle) continua.
interface FreshApp {
  handle: (data: unknown) => Promise<void>;
  sent: Sent[];
  queueReply: (actions: Interpretation[]) => void;
  setNow: (offsetMs: number) => void;
}

// UM relogio por teste: empilhar varios t.mock.method(Date, "now") (um por reinicio) e restaurar na
// ordem de criacao deixa Date.now preso num mock antigo e contamina os testes seguintes.
const clocks = new WeakMap<TestContext, { offset: number }>();
function testClock(t: TestContext) {
  let clock = clocks.get(t);
  if (!clock) {
    const realNow = Date.now();
    const created = { offset: 0 };
    clock = created;
    clocks.set(t, created);
    t.mock.method(Date, "now", () => realNow + created.offset);
  }
  return clock;
}

function restartApp(t: TestContext): FreshApp {
  const srcDir = path.join(__dirname, "..", "..", "src");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir) && !/[\\/](db|config)\.js$/.test(key)) delete require.cache[key];
  }
  const client = require("../../src/whatsapp/client");
  const ai = require("../../src/ai/interpret");
  const router = require("../../src/router");
  const sent: Sent[] = [];
  t.mock.method(client, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  const queue: Interpretation[][] = [];
  t.mock.method(ai, "interpretText", async () => queue.shift() ?? []);
  const clock = testClock(t);
  return { handle: router.handleIncomingMessage, sent, queueReply: (a) => queue.push(a), setNow: (ms) => (clock.offset = ms) };
}

// ============================================================================
// RF09 (a): lista -> menu -> previa -> confirmar -> desfazer, com reinicio entre TODOS os passos
// ============================================================================
test("RF09(a): lista de escolha -> menu guiado -> previa -> confirmar -> desfazer, reiniciando o servidor entre cada passo", async (t) => {
  const N = "551100091801";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const first = insertExpense({ fromNumber: N, amount: 10, description: "Mercado aud 1", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 20, description: "Mercado aud 2", categoryId: cat.id, paymentMethodId: null, date: today() });

  let app = restartApp(t);
  app.queueReply([{ type: "edit_expense", query: "mercado aud" }]);
  await app.handle(evolutionMessage(N, "edita o mercado aud"));
  assert.match(last(app.sent), /^Achei 2 gastos com "mercado aud":\n1\. Mercado aud 2[\s\S]*\n2\. Mercado aud 1/);
  assert.deepEqual(pendingKinds(N), ["target_choice"]);

  app = restartApp(t); // reinicio 1: a lista de escolha sobrevive
  await app.handle(evolutionMessage(N, "2"));
  assert.match(last(app.sent), /^✏️ Mercado aud 1 — R\$ 10,00 · \d{2}\/\d{2}\nO que você quer mudar\?/);
  assert.deepEqual(pendingKinds(N), ["field_menu"]);

  app = restartApp(t); // reinicio 2: o menu sobrevive
  await app.handle(evolutionMessage(N, "1"));
  assert.match(last(app.sent), /^Qual é o valor certo\?/);

  app = restartApp(t); // reinicio 3: a pergunta de valor (etapa do menu) sobrevive
  await app.handle(evolutionMessage(N, "45"));
  assert.match(last(app.sent), /Valor: R\$ 10,00 → R\$ 45,00\n\n1 ✅ Confirmar/);
  assert.deepEqual(pendingKinds(N), ["edit_expense"]);

  app = restartApp(t); // reinicio 4: a previa sobrevive
  await app.handle(evolutionMessage(N, "1"));
  assert.equal(last(app.sent), '✏️ "Mercado aud 1" atualizado: valor R$ 45,00.\nErrou? Responde *desfazer*.');
  assert.equal(getExpenseById(N, first.id)?.amount, 45);
  assert.deepEqual(pendingKinds(N), ["undo"]);

  app = restartApp(t); // reinicio 5: o desfazer sobrevive
  app.queueReply([{ type: "undo" }]);
  await app.handle(evolutionMessage(N, "desfaz isso"));
  assert.match(last(app.sent), /desfiz a última alteração em "Mercado aud 1"/);
  assert.equal(getExpenseById(N, first.id)?.amount, 10);
  assert.deepEqual(pendingKinds(N), []);
});

test("RF08/RF09: cada tipo de pendencia sobrevive a reinicio (edicao de evento, lembrete, gasto fixo, entrada, exclusao de entrada, 'editar' sem alvo)", async (t) => {
  const N = "551100091802";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "Evento reinicio", start: futureAt(3, 14), end: futureAt(3, 15) });
  const rem = remindersService.createReminder(N, "Lembrete reinicio", futureAt(2, 9));
  const rec = createRecurringExpense({ fromNumber: N, description: "Fixo reinicio", amount: 50, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const inc = incomesService.insertIncome({ fromNumber: N, amount: 100, description: "Entrada reinicio", date: today() });
  const incDel = incomesService.insertIncome({ fromNumber: N, amount: 7, description: "Entrada apagar reinicio", date: today() });

  const run = async (action: Interpretation | null, text: string, kind: string, answer: string) => {
    let app = restartApp(t);
    if (action) app.queueReply([action]);
    await app.handle(evolutionMessage(N, text));
    assert.deepEqual(pendingKinds(N).filter((k) => k !== "undo"), [kind], text); // (o desfazer do passo anterior tambem fica guardado)
    app = restartApp(t); // reinicia com a pendencia criada
    await app.handle(evolutionMessage(N, answer));
    return app.sent;
  };

  let sent = await run({ type: "edit_event", query: "evento reinicio", new_title: "Evento reiniciado" }, "muda o evento reinicio", "edit_event", "1");
  assert.match(last(sent), /^✏️ "Evento reinicio" alterado/);
  assert.equal(eventsService.getEventById(N, eventsService.findUpcomingEvents(N, "reiniciado")[0].id)?.title, "Evento reiniciado");

  sent = await run({ type: "edit_reminder", query: "lembrete reinicio", new_message: "Lembrete reiniciado" }, "muda o lembrete reinicio", "edit_reminder", "1");
  assert.match(last(sent), /^✏️ Lembrete "Lembrete reinicio" alterado/);
  assert.equal(remindersService.getReminderById(N, rem)?.message, "Lembrete reiniciado");

  sent = await run({ type: "edit_recurring_expense", query: "fixo reinicio", new_amount: 60 }, "muda o fixo", "edit_recurring", "1");
  assert.match(last(sent), /^✏️ Gasto fixo "Fixo reinicio" alterado/);
  assert.equal(getRecurringExpenseById(N, rec.id)?.amount, 60);

  sent = await run({ type: "edit_income", query: "entrada reinicio", changes: [{ field: "amount", value: "200" }] }, "muda a entrada reinicio", "edit_income", "1");
  assert.match(last(sent), /^✏️ Entrada "Entrada reinicio" atualizada/);
  assert.equal(incomesService.getIncomeById(N, inc.id)?.amount, 200);

  sent = await run({ type: "delete_income", query: "entrada apagar reinicio" }, "apaga a entrada reinicio", "delete_income", "1");
  assert.match(last(sent), /^🗑️ Entrada "Entrada apagar reinicio" apagada/);
  assert.equal(incomesService.getIncomeById(N, incDel.id), null);

  sent = await run(null, "editar", "edit_target", "5");
  assert.match(last(sent), /^Seus lembretes:|Esses lembretes|Você não tem nenhum lembrete|Seus próximos lembretes|1\. Lembrete reiniciado/);
});

test("RF09 (pendencia recem-criada x quase vencida) com reinicio: 9m59s ainda vale, 10m01s explica a expiracao", async (t) => {
  const A = "551100091803";
  const B = "551100091804";
  seed(A, B);
  const cat = getOrCreateCategory(A, "Alimentação");
  const ea = insertExpense({ fromNumber: A, amount: 10, description: "Item quase vencido", categoryId: cat.id, paymentMethodId: null, date: today() });
  const eb = insertExpense({ fromNumber: B, amount: 10, description: "Item vencido", categoryId: cat.id, paymentMethodId: null, date: today() });

  let app = restartApp(t);
  app.queueReply([{ type: "edit_expense", query: "item quase vencido", changes: [{ field: "amount", value: "40" }] }]);
  await app.handle(evolutionMessage(A, "muda o item quase vencido pra 40"));
  app.queueReply([{ type: "edit_expense", query: "item vencido", changes: [{ field: "amount", value: "40" }] }]);
  await app.handle(evolutionMessage(B, "muda o item vencido pra 40"));

  app = restartApp(t);
  app.setNow(10 * 60 * 1000 - 1000); // 9m59s depois
  await app.handle(evolutionMessage(A, "1"));
  assert.match(last(app.sent), /atualizado: valor R\$ 40,00/);
  assert.equal(getExpenseById(A, ea.id)?.amount, 40);

  app = restartApp(t);
  app.setNow(10 * 60 * 1000 + 1000); // 10m01s depois
  await app.handle(evolutionMessage(B, "1"));
  assert.match(last(app.sent), /^⌛ A confirmação de "Item vencido — R\$ 10,00" expirou/);
  assert.equal(getExpenseById(B, eb.id)?.amount, 10);
});

// ============================================================================
// RF09 (f): lista de gastos antiga depois de reinicio (listCache continua em memoria)
// ============================================================================
test("RF09(f): lista de gastos mostrada antes do reinicio nao e reaproveitada -- 'edita o 2' cai na lista expirada e oferece os recentes", async (t) => {
  const N = "551100091805";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 10, description: "Primeiro lista reinicio", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 20, description: "Segundo lista reinicio", categoryId: cat.id, paymentMethodId: null, date: today() });

  let app = restartApp(t);
  app.queueReply([{ type: "list_expenses", date: today() }]);
  await app.handle(evolutionMessage(N, "gastos de hoje"));
  assert.match(last(app.sent), /^🧾 Gastos/);

  app = restartApp(t);
  app.queueReply([{ type: "edit_expense", list_ref: 2, changes: [{ field: "amount", value: "99" }] }]);
  await app.handle(evolutionMessage(N, "edita o 2 pra 99"));
  assert.match(last(app.sent), /^Essa lista já expirou, então não vou adivinhar pelo número\. Seus últimos gastos:/);
  await app.handle(evolutionMessage(N, "cancelar"));
  assert.equal(findRecentExpense(N, "segundo lista reinicio")?.amount, 20); // nada mudou
});

// ============================================================================
// RF09 (b): pendencia ativa + mensagem que dispara outro tipo
// ============================================================================
test("RF09(b): previa ativa e pedido novo LONGO com verbo de edicao -> descarta com aviso; edicao de evento junto de uma de gasto -> adiada", async (t) => {
  const N = "551100091806";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 10, description: "Item precedencia", categoryId: cat.id, paymentMethodId: null, date: today() });
  eventsService.createEvent({ fromNumber: N, title: "Evento precedencia", start: futureAt(3, 14) });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "edit_expense", query: "item precedencia", changes: [{ field: "amount", value: "40" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o item precedencia pra 40"));
  queueReply([{ type: "edit_event", query: "evento precedencia", new_title: "Evento novo" }]);
  await handleIncomingMessage(evolutionMessage(N, "renomeia o evento precedencia para evento novo"));
  assert.equal(sent[1].text, 'Cancelei a alteração de "Item precedencia" e entendi seu novo pedido.');
  assert.match(sent[2].text, /Nome: Evento precedencia → Evento novo/);
  assert.deepEqual(pendingKinds(N), ["edit_event"]); // so a confirmacao nova ficou
  await handleIncomingMessage(evolutionMessage(N, "3"));
});

test("RF09(c): dois numeros usando o bot ao mesmo tempo -- previas intercaladas, sem vazamento de estado", async (t) => {
  const A = "551100091807";
  const B = "551100091808";
  seed(A, B);
  const cat = getOrCreateCategory(A, "Alimentação");
  const ea = insertExpense({ fromNumber: A, amount: 10, description: "Item simultaneo A", categoryId: cat.id, paymentMethodId: null, date: today() });
  const eb = insertExpense({ fromNumber: B, amount: 10, description: "Item simultaneo B", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "edit_expense", query: "item simultaneo a", changes: [{ field: "amount", value: "11" }] }]);
  await handleIncomingMessage(evolutionMessage(A, "muda o item simultaneo a"));
  queueReply([{ type: "edit_expense", query: "item simultaneo b", changes: [{ field: "amount", value: "22" }] }]);
  await handleIncomingMessage(evolutionMessage(B, "muda o item simultaneo b"));
  // as duas respostas chegam juntas: cada uma vale so pra previa do proprio numero
  await Promise.all([handleIncomingMessage(evolutionMessage(B, "3")), handleIncomingMessage(evolutionMessage(A, "1"))]);
  assert.equal(getExpenseById(A, ea.id)?.amount, 11);
  assert.equal(getExpenseById(B, eb.id)?.amount, 10); // B cancelou
  assert.ok(sent.some((m) => m.to === A && /atualizado/.test(m.text)));
  assert.ok(!sent.some((m) => m.to === B && /atualizado/.test(m.text)));
  assert.deepEqual(pendingKinds(B), []);
  assert.deepEqual(pendingKinds(A), ["undo"]);
});

// ============================================================================
// RF09 (d): "cancelar" com pendencia persistida
// ============================================================================
test("RF09(d): 'cancelar' (e variantes de uma palavra) com pendencia persistida apaga a linha e nao altera nada", async (t) => {
  const N = "551100091809";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 10, description: "Item cancelar", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 11, description: "Aula cancelar 1", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 12, description: "Aula cancelar 2", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { queueReply } = withMocks(t);

  const casos: [Interpretation | null, string, string, string][] = [
    [{ type: "edit_expense", query: "item cancelar", changes: [{ field: "amount", value: "40" }] }, "muda o item", "edit_expense", "cancelar"],
    [{ type: "edit_expense", query: "item cancelar" }, "edita o item", "field_menu", "Cancelar"],
    [{ type: "edit_expense", query: "aula cancelar", changes: [{ field: "amount", value: "40" }] }, "muda a aula", "target_choice", "cancelar"],
    [null, "editar", "edit_target", "cancelar"],
    [{ type: "edit_expense", query: "item cancelar", changes: [{ field: "amount", value: "40" }] }, "muda o item", "edit_expense", "esquece"], // comando geral (cancelAllPendings)
  ];
  for (const [action, text, kind, cancel] of casos) {
    resetRateLimitForTests();
    if (action) queueReply([action]);
    await handleIncomingMessage(evolutionMessage(N, text));
    assert.deepEqual(pendingKinds(N), [kind], text);
    await handleIncomingMessage(evolutionMessage(N, cancel));
    assert.deepEqual(pendingKinds(N), [], `${text} / ${cancel}`);
  }
  assert.equal(getExpenseById(N, exp.id)?.amount, 10);
});

// ============================================================================
// RF09 (e): evento com varios campos + correcao + local/termino
// ============================================================================
test("RF09(e): evento -- titulo + termino + local + dia na mesma frase, corrige so o 'Quando', confirma e o desfazer devolve tudo", async (t) => {
  const N = "551100091810";
  seed(N);
  const ev = eventsService.createEvent({ fromNumber: N, title: "Consulta aud", start: futureAt(3, 14), end: futureAt(3, 15), location: "Clínica A" });
  const { sent, queueReply } = withMocks(t);
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: addDaysToDateString(spDateString(), 6) }));

  queueReply([
    {
      type: "edit_event",
      query: "consulta aud",
      new_title: "Dentista aud",
      new_date: addDaysToDateString(spDateString(), 5),
      new_end_time: "17:00",
      new_location: "Clínica B",
    },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "remarca a consulta aud"));
  assert.match(sent[0].text, /Quando: .*\nTérmino: 15:00 → 17:00\nNome: Consulta aud → Dentista aud\nLocal: Clínica A → Clínica B\n/);

  await handleIncomingMessage(evolutionMessage(N, "2"));
  assert.equal(sent[1].text, "Qual você quer corrigir?\n1 Quando\n2 Término\n3 Nome\n4 Local\n\nOu responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.match(sent[2].text, /^Qual é a data e hora certas\?/);
  await handleIncomingMessage(evolutionMessage(N, "daqui a 6 dias"));
  // o dia mudou mas o termino explicito (17:00), o nome e o local continuam
  assert.match(sent[3].text, /Término: 15:00 → 17:00\nNome: Consulta aud → Dentista aud\nLocal: Clínica A → Clínica B/);

  await handleIncomingMessage(evolutionMessage(N, "1"));
  const after = eventsService.getEventById(N, ev.id)!;
  assert.equal(after.title, "Dentista aud");
  assert.equal(after.location, "Clínica B");
  assert.equal(after.start.slice(0, 10), addDaysToDateString(spDateString(), 6));
  assert.match(after.end, /T17:00|T20:00/);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  const undone = eventsService.getEventById(N, ev.id)!;
  assert.equal(undone.title, "Consulta aud");
  assert.equal(undone.location, "Clínica A");
  assert.equal(undone.start.slice(0, 10), addDaysToDateString(spDateString(), 3));
  assert.equal(new Date(undone.end).getTime() - new Date(undone.start).getTime(), 3600 * 1000);
});

// ============================================================================
// RF09 (g): desfazer depois de duas edicoes seguidas -- so a ultima volta
// ============================================================================
test("RF09(g): duas edicoes seguidas -- 'desfaz' volta so a ultima, e um segundo 'desfaz' nao volta a primeira", async (t) => {
  const N = "551100091811";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 10, description: "Item dupla edicao", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);

  for (const value of ["20", "30"]) {
    queueReply([{ type: "edit_expense", query: "item dupla edicao", changes: [{ field: "amount", value }] }]);
    await handleIncomingMessage(evolutionMessage(N, `muda o item dupla edicao pra ${value}`));
    await handleIncomingMessage(evolutionMessage(N, "1"));
  }
  assert.equal(getExpenseById(N, exp.id)?.amount, 30);
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 20); // so a ultima voltou
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 20);
  assert.equal(last(sent), "Não tem nada recente pra eu desfazer.");
});

// ============================================================================
// RF09 (h): audio transcrito, acento e emoji
// ============================================================================
test("RF09(h): resposta por audio transcrito ('Sim.'), com acento ('Sím') e emoji (👍) confirma a previa; '❌' e 'Não' cancelam", async (t) => {
  const N = "551100091812";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 10, description: "Item audio", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { queueReply } = withMocks(t);
  let transcript = "Sim.";
  t.mock.method(aiTranscribe, "transcribeAudio", async () => transcript);

  const preview = async (value: string) => {
    resetRateLimitForTests();
    queueReply([{ type: "edit_expense", query: "item audio", changes: [{ field: "amount", value }] }]);
    await handleIncomingMessage(evolutionMessage(N, `muda o item audio pra ${value}`));
  };
  await preview("20");
  await handleIncomingMessage(evolutionAudioMessage(N)); // audio dizendo "Sim."
  assert.equal(getExpenseById(N, exp.id)?.amount, 20);

  await preview("30");
  await handleIncomingMessage(evolutionMessage(N, "Sím"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 30);
  await preview("40");
  await handleIncomingMessage(evolutionMessage(N, "👍"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 40);

  await preview("50");
  await handleIncomingMessage(evolutionMessage(N, "❌"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 40);
  await preview("60");
  transcript = "Não.";
  await handleIncomingMessage(evolutionAudioMessage(N));
  assert.equal(getExpenseById(N, exp.id)?.amount, 40);
  assert.deepEqual(pendingKinds(N), ["undo"]); // so o desfazer da ultima edicao confirmada
});

// ============================================================================
// DEFEITOS (esperado = comportamento correto; "todo" ate o defeito ser corrigido)
// ============================================================================
test("D-01 (Alto): 'cancela o evento X e renomeia o evento X' deixa DUAS perguntas abertas com instrucoes conflitantes", { todo: "defeito D-01 -- ver docs/auditoria-cards-1-a-7.md" }, async (t) => {
  const N = "551100091813";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "Reuniao conflito", start: futureAt(4, 10) });
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "delete_event", query: "reuniao conflito" },
    { type: "edit_event", query: "reuniao conflito", new_title: "Reuniao conflito 2" },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a reuniao conflito e renomeia a reuniao conflito"));
  // esperado (RN10 do Card 3): a segunda acao e adiada, so existe UMA pergunta aberta
  assert.ok(sent.some((m) => /Deixei a alteração de/.test(m.text)), "a segunda acao deveria ser adiada com aviso");
  assert.ok(!sent.some((m) => /1 ✅ Confirmar/.test(m.text) && sent.some((x) => /Confirma que quer cancelar/.test(x.text))));
});

test("D-01b (Alto): 'apaga o gasto X e muda o gasto Y' idem -- o '1' da previa cai na pergunta 'sim/nao' da exclusao", { todo: "defeito D-01 -- ver docs/auditoria-cards-1-a-7.md" }, async (t) => {
  const N = "551100091814";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 10, description: "Gasto um conflito", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 20, description: "Gasto dois conflito", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "delete_expense", query: "gasto um conflito" },
    { type: "edit_expense", query: "gasto dois conflito", changes: [{ field: "amount", value: "25" }] },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "apaga o gasto um conflito e muda o gasto dois conflito pra 25"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.ok(!/Não entendi — confirma que quer apagar/.test(last(sent)), "o 1 da previa de edicao nao pode cair na pergunta de exclusao");
});

test("D-02 (corrigido no Card 10): mover um evento pro passado nao dispara o 'Daqui a...' no minuto seguinte", async (t) => {
  const N = "551100091815";
  seed(N);
  const ev = eventsService.createEvent({ fromNumber: N, title: "Evento movido pro passado", start: futureAt(3, 14) });
  eventsService.markEventReminderSent(N, ev.id);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento movido pro passado", new_date: addDaysToDateString(spDateString(), -2) }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o evento movido pro passado pra anteontem"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.ok(!eventsService.getDueEventReminders().some((e) => e.id === ev.id), "evento que ja comecou nao deveria gerar aviso");
});

test("D-03 (corrigido no Card 18): ' cancelar ' com espacos durante a previa fica com o resolvedor da edicao (regex com '\\s')", async (t) => {
  const N = "551100091816";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 10, description: "Item espacos", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "item espacos", changes: [{ field: "amount", value: "40" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o item espacos pra 40"));
  await handleIncomingMessage(evolutionMessage(N, " cancelar "));
  assert.equal(last(sent), "Beleza, não mexi em nada.");
});

test("D-03 (Card 18): variantes com espaco e pontuacao cancelam a previa e a escolha por numero com 'Beleza, nao mexi em nada.'", async (t) => {
  const N = "551100091990";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 10, description: "Item variantes", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  for (const variant of ["Cancelar.", "cancela!", "  cancela  ", "\tCancelar \n", "cancelar", "CANCELA."]) {
    queueReply([{ type: "edit_expense", query: "item variantes", changes: [{ field: "amount", value: "40" }] }]);
    await handleIncomingMessage(evolutionMessage(N, "muda o item variantes pra 40"));
    await handleIncomingMessage(evolutionMessage(N, variant));
    assert.equal(last(sent), "Beleza, não mexi em nada.", JSON.stringify(variant));
    assert.deepEqual(pendingKinds(N), [], JSON.stringify(variant));
  }
  assert.equal(getExpenseById(N, exp.id)?.amount, 10, "nada foi alterado");

  // escolha por numero (lista aberta)
  insertExpense({ fromNumber: N, amount: 20, description: "Item variantes dois", categoryId: cat.id, paymentMethodId: null, date: today() });
  queueReply([{ type: "edit_expense", query: "item variantes" }]);
  await handleIncomingMessage(evolutionMessage(N, "edita o item variantes"));
  assert.match(last(sent), /Qual deles/);
  await handleIncomingMessage(evolutionMessage(N, "  Cancelar. "));
  assert.equal(last(sent), "Beleza, não mexi em nada.");
});

test("D-03 (Card 18): 'cancelass' e 'scancelar' NAO sao cancelamento; 'cancelar' sem pendencia de edicao segue no cancelamento geral", async (t) => {
  const N = "551100091991";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 10, description: "Item negativo", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "item negativo", changes: [{ field: "amount", value: "40" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o item negativo pra 40"));
  for (const word of ["cancelass", "scancelar", "ssscancelar", "cancelarr"]) {
    await handleIncomingMessage(evolutionMessage(N, word));
    assert.notEqual(last(sent), "Beleza, não mexi em nada.", word);
    assert.ok(!last(sent).startsWith("Beleza, cancelei"), word);
    assert.deepEqual(pendingKinds(N), ["edit_expense"], `${word}: a previa continua aberta`);
  }
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  assert.equal(last(sent), "Beleza, não mexi em nada.");

  // sem nenhuma pendencia: comportamento anterior (cancelamento geral)
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  assert.match(last(sent), /^Não tem nada pendente pra cancelar agora\./);
});

test("D-04 (corrigido no Card 11): numeros por extenso ('um', 'dois', 'tres') -- tipicos de audio -- respondem a previa 1/2/3", async (t) => {
  const N = "551100091817";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 10, description: "Item por extenso", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "item por extenso", changes: [{ field: "amount", value: "40" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o item por extenso pra 40"));
  await handleIncomingMessage(evolutionMessage(N, "Um.")); // audio transcrito de "1"
  assert.equal(getExpenseById(N, exp.id)?.amount, 40);
});

// ============================================================================
// Agendadores (cron mockado): dica de adiar no toque (RN16) e limpeza do Card 7 (RN12)
// ============================================================================
test("Card 6 RN16: o agendador envia o lembrete COM a dica de adiar (cron mockado)", async (t) => {
  const N = "551100091820";
  seed(N);
  const id = remindersService.createReminder(N, "Lembrete do agendador", new Date(Date.now() - 60 * 1000).toISOString());
  const { sent } = withMocks(t);
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (_expr: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop() {} };
  });
  startReminderScheduler();
  assert.ok(tick);
  await tick!();
  const mine = sent.filter((m) => m.to === N);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, `🔔 Lembrete: Lembrete do agendador\n${SNOOZE_HINT}`);
  assert.equal(remindersService.getReminderById(N, id)?.sent, 1);
});

test("Card 7 RN12: a limpeza roda na inicializacao e a cada 10 minutos, e remove so o que venceu ha mais de 60 min", async (t) => {
  const N = "551100091821";
  const now = Date.now();
  setPending(N, "edit_event", { payload: {}, label: "velha", ttlMs: 10 * 60 * 1000, version: 1, now: now - 80 * 60 * 1000 });
  setPending(N, "edit_income", { payload: {}, label: "recente", ttlMs: 10 * 60 * 1000, version: 1, now: now - 30 * 60 * 1000 });
  const schedules: string[] = [];
  t.mock.method(cron, "schedule", (expr: string) => {
    schedules.push(expr);
    return { stop() {} };
  });
  startPendingCleanup();
  assert.deepEqual(schedules, ["*/10 * * * *"]);
  assert.equal(getPending(N, "edit_event", 1, now - 60 * 1000), null);
  assert.deepEqual(pendingKinds(N), ["edit_income"]); // a "velha" foi removida na inicializacao; a "recente" (venceu ha 20 min) fica pro aviso
});

// ============================================================================
// Lacunas de teste dos Cards 1, 3 e 5 (ramos de erro / correcao que nenhum teste exercitava)
// ============================================================================
test("Card 1: gasto fixo -- valor invalido (0, absurdo) e recusado ANTES da previa; mesma mudanca => 'Ja esta assim'", async (t) => {
  const N = "551100091830";
  seed(N);
  const rec = createRecurringExpense({ fromNumber: N, description: "Fixo validacao", amount: 50, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const { sent, queueReply } = withMocks(t);
  const ask = async (a: Interpretation, text: string) => {
    queueReply([a]);
    await handleIncomingMessage(evolutionMessage(N, text));
    return last(sent);
  };
  assert.match(await ask({ type: "edit_recurring_expense", query: "fixo validacao", new_amount: 2000000 }, "muda pra 2000000"), /muito alto \(limite R\$ 1\.000\.000,00\)/);
  assert.match(await ask({ type: "edit_recurring_expense", query: "fixo validacao", new_amount: 0 }, "muda pra 0"), /maior que R\$ 0,00/);
  assert.match(await ask({ type: "edit_recurring_expense", query: "fixo validacao", new_day_of_month: 40 }, "dia 40"), /dia do mês precisa ser entre 1 e 31/);
  assert.equal(await ask({ type: "edit_recurring_expense", query: "fixo validacao", new_amount: 50, new_day_of_month: 5 }, "igual"), "Já está assim, não mexi em nada.");
  assert.deepEqual(pendingKinds(N), []);
  assert.equal(getRecurringExpenseById(N, rec.id)?.amount, 50);
});

test("Card 1: gasto fixo -- opcao 2 pergunta o dia, resposta invalida repete com exemplo, valor solto corrige, 'cancelar' sai", async (t) => {
  const N = "551100091831";
  seed(N);
  const rec = createRecurringExpense({ fromNumber: N, description: "Fixo correcao", amount: 50, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_recurring_expense", query: "fixo correcao", new_day_of_month: 12 }]);
  await handleIncomingMessage(evolutionMessage(N, "o fixo correcao vence dia 12"));
  assert.match(last(sent), /Dia do mês: 5 → 12/);
  await handleIncomingMessage(evolutionMessage(N, "2"));
  assert.equal(last(sent), "Qual é o dia do mês certo? (1 a 31) Ou responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(N, "40"));
  assert.match(last(sent), /^O dia do mês precisa ser de 1 a 31\.\nQual é o dia do mês certo\?/);
  await handleIncomingMessage(evolutionMessage(N, "dia 15"));
  assert.match(last(sent), /Dia do mês: 5 → 15/);
  await handleIncomingMessage(evolutionMessage(N, "20")); // valor solto numa previa de dia unico = nova previa
  assert.match(last(sent), /Dia do mês: 5 → 20/);
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  assert.equal(last(sent), "Beleza, não mexi em nada.");
  assert.equal(getRecurringExpenseById(N, rec.id)?.day_of_month, 5);
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 1: lembrete -- correcao de data/hora invalida repete a pergunta; 'Ja esta assim' com o mesmo texto; cancelar na correcao", async (t) => {
  const N = "551100091832";
  seed(N);
  const id = remindersService.createReminder(N, "Lembrete correcao aud", futureAt(2, 9));
  const { sent, queueReply } = withMocks(t);
  let extracted: { newDate?: string; newTime?: string } | null = null;
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => extracted);

  queueReply([{ type: "edit_reminder", query: "lembrete correcao aud", new_message: "Lembrete correcao aud" }]);
  await handleIncomingMessage(evolutionMessage(N, "x"));
  assert.equal(last(sent), "Já está assim, não mexi em nada.");

  queueReply([{ type: "edit_reminder", query: "lembrete correcao aud", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o lembrete pra 10h"));
  await handleIncomingMessage(evolutionMessage(N, "2"));
  assert.match(last(sent), /^Qual é a data e hora certas\?/);
  await handleIncomingMessage(evolutionMessage(N, "sei la"));
  assert.match(last(sent), /^Não entendi a data e hora "sei la"\.\nQual é a data e hora certas\?/);
  extracted = { newTime: "11:00" };
  await handleIncomingMessage(evolutionMessage(N, "11h"));
  assert.match(last(sent), /Quando: .* → .*11:00/);
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  assert.equal(last(sent), "Beleza, não mexi em nada.");
  assert.match(remindersService.getReminderById(N, id)!.due_at, /T09:00/);
});

test("Card 1/6: evento -- corrige antecedencia, titulo e local pela opcao 2; mudanca igual vira 'Ja esta assim'", async (t) => {
  const N = "551100091833";
  seed(N);
  const ev = eventsService.createEvent({ fromNumber: N, title: "Evento correcao aud", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento correcao aud", new_title: "Titulo novo", new_reminder_minutes: 120, new_location: "Sala 1" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o evento correcao aud"));
  assert.match(last(sent), /Nome: Evento correcao aud → Titulo novo\nLocal: sem local → Sala 1\nAviso: 1 hora antes → 2 horas antes/);

  await handleIncomingMessage(evolutionMessage(N, "2"));
  assert.equal(last(sent), "Qual você quer corrigir?\n1 Nome\n2 Local\n3 Aviso\n\nOu responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(N, "3"));
  await handleIncomingMessage(evolutionMessage(N, "30 minutos"));
  assert.match(last(sent), /Aviso: 1 hora antes → 30 min antes/);
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  await handleIncomingMessage(evolutionMessage(N, "Titulo corrigido"));
  assert.match(last(sent), /Nome: Evento correcao aud → Titulo corrigido/);
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "x".repeat(101))); // local longo: repete a pergunta
  assert.match(last(sent), /muito longo \(máximo 100 caracteres\)\.\nQual é o local\?/);
  await handleIncomingMessage(evolutionMessage(N, "Sala 2"));
  assert.match(last(sent), /Local: sem local → Sala 2/);
  await handleIncomingMessage(evolutionMessage(N, "1"));
  const e = eventsService.getEventById(N, ev.id)!;
  assert.deepEqual([e.title, e.location, e.reminder_minutes], ["Titulo corrigido", "Sala 2", 30]);

  queueReply([{ type: "edit_event", query: "titulo corrigido", new_title: "Titulo corrigido", new_location: "Sala 2" }]);
  await handleIncomingMessage(evolutionMessage(N, "igual"));
  assert.equal(last(sent), "Já está assim, não mexi em nada.");
});

test("Card 3: lote -- erros (lista expirada, numero desconhecido, sem mudanca, valor invalido) e dois pedidos no MESMO gasto viram uma previa so", async (t) => {
  const N = "551100091834";
  seed(N);
  const cat = getOrCreateCategory(N, "Alimentação");
  const a = insertExpense({ fromNumber: N, amount: 10, description: "Lote erro A", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: N, amount: 20, description: "Lote erro B", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  const change = (value: string) => [{ field: "amount" as const, value }];

  // lista expirada (nenhuma lista de gastos foi mostrada)
  queueReply([
    { type: "edit_expense", list_ref: 1, changes: change("11") },
    { type: "edit_expense", list_ref: 2, changes: change("22") },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "muda o 1 pra 11 e o 2 pra 22"));
  assert.equal(last(sent), "A lista de gastos que eu tinha mostrado já expirou. Pede a lista de novo e me manda as alterações.");

  // sem mudanca em um dos gastos
  queueReply([
    { type: "edit_expense", query: "lote erro a", changes: change("11") },
    { type: "edit_expense", query: "lote erro b" },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "muda o lote erro a pra 11 e edita o lote erro b"));
  assert.equal(last(sent), 'Me diz o que mudar em cada gasto, ex: "o mercado foi no pix e o uber no dinheiro".');

  // valor invalido em um dos gastos: nada e criado
  queueReply([
    { type: "edit_expense", query: "lote erro a", changes: change("11") },
    { type: "edit_expense", query: "lote erro b", changes: change("2000000") },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "muda os dois"));
  assert.match(last(sent), /muito alto/);
  assert.deepEqual(pendingKinds(N), []);

  // dois pedidos no mesmo gasto: uma previa so, o ultimo valor vale
  queueReply([
    { type: "edit_expense", query: "lote erro a", changes: change("11") },
    { type: "edit_expense", query: "lote erro a", changes: [{ field: "payment_method", value: "Dinheiro" }] },
  ]);
  await handleIncomingMessage(evolutionMessage(N, "muda o lote erro a pra 11 e no dinheiro"));
  assert.match(last(sent), /^✏️ Lote erro A — R\$ 10,00[\s\S]*Valor: R\$ 10,00 → R\$ 11,00\nPagamento: .* → Dinheiro/);
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(getExpenseById(N, a.id)?.amount, 11);
});

test("Card 5: entrada -- cancelar na correcao, opcao invalida no seletor, descricao longa na correcao", async (t) => {
  const N = "551100091835";
  seed(N);
  const e = incomesService.insertIncome({ fromNumber: N, amount: 1000, description: "Entrada correcao aud", date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_income", query: "entrada correcao aud", changes: [{ field: "amount", value: "1200" }, { field: "description", value: "Entrada nova aud" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "muda a entrada correcao aud"));
  await handleIncomingMessage(evolutionMessage(N, "2"));
  await handleIncomingMessage(evolutionMessage(N, "2")); // Descricao
  assert.match(last(sent), /^Qual é a nova descrição\?/);
  await handleIncomingMessage(evolutionMessage(N, "x".repeat(101)));
  assert.match(last(sent), /muito longo[\s\S]*Qual é a nova descrição\?/);
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  assert.equal(last(sent), "Beleza, não mexi em nada.");
  assert.equal(incomesService.getIncomeById(N, e.id)?.amount, 1000);
  assert.deepEqual(pendingKinds(N), []);
});

// ============================================================================
// Mais criterios que nenhum teste provava de ponta a ponta
// ============================================================================
test("Card 6 RN10 vale tambem pelo PAINEL: editar so titulo/local de evento e so texto de lembrete ja avisados nao reenvia o aviso", async () => {
  const { startDashboardTestServer } = await import("../helpers/app");
  const { baseUrl, close, authHeaders } = await startDashboardTestServer();
  try {
    const A = "551100091840";
    seed(A);
    const day = addDaysToDateString(spDateString(), 3);
    const ev = eventsService.createEvent({ fromNumber: A, title: "Evento painel rn10", start: `${day}T14:00:00-03:00`, end: `${day}T15:00:00-03:00` });
    eventsService.markEventReminderSent(A, ev.id);
    const form = { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders(A) };
    await fetch(`${baseUrl}/dashboard/events/${ev.id}`, {
      method: "POST",
      headers: form,
      redirect: "manual",
      body: new URLSearchParams({ title: "Evento painel renomeado", start: `${day}T14:00`, end: `${day}T16:00`, location: "Sala X", reminder_minutes: String(ev.reminder_minutes) }),
    });
    const after = eventsService.getEventById(A, ev.id)!;
    assert.equal(after.title, "Evento painel renomeado");
    assert.equal(after.location, "Sala X");
    assert.equal(after.reminder_sent, 1);

    const rid = remindersService.createReminder(A, "Lembrete painel rn10", `${day}T09:00:00-03:00`);
    remindersService.markReminderSent(A, rid);
    await fetch(`${baseUrl}/dashboard/reminders/${rid}`, {
      method: "POST",
      headers: form,
      redirect: "manual",
      body: new URLSearchParams({ message: "Lembrete painel renomeado", due_at: `${day}T09:00` }),
    });
    assert.equal(remindersService.getReminderById(A, rid)?.message, "Lembrete painel renomeado");
    assert.equal(remindersService.getReminderById(A, rid)?.sent, 1);
    // mudar o horario pelo painel reativa
    await fetch(`${baseUrl}/dashboard/reminders/${rid}`, {
      method: "POST",
      headers: form,
      redirect: "manual",
      body: new URLSearchParams({ message: "Lembrete painel renomeado", due_at: `${day}T10:00` }),
    });
    assert.equal(remindersService.getReminderById(A, rid)?.sent, 0);
  } finally {
    await close();
  }
});

test("Card 5: o desfazer devolve a entrada com os MESMOS valores, descricao e data (edicao e exclusao)", async (t) => {
  const N = "551100091841";
  seed(N);
  const date = addDaysToDateString(spDateString(), -3);
  const e = incomesService.insertIncome({ fromNumber: N, amount: 3000.55, description: "Salário original", date });
  const { queueReply } = withMocks(t);

  queueReply([{ type: "edit_income", query: "salario original", changes: [{ field: "amount", value: "1" }, { field: "description", value: "Outra coisa" }, { field: "date", value: "ontem" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "corrige a entrada salario original com tudo novo"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(incomesService.getIncomeById(N, e.id)?.description, "Outra coisa");
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  const restored = incomesService.getIncomeById(N, e.id)!;
  assert.deepEqual([restored.amount, restored.description, restored.date], [3000.55, "Salário original", date]);

  queueReply([{ type: "delete_income", query: "salario original" }]);
  await handleIncomingMessage(evolutionMessage(N, "apaga a entrada do aud"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(incomesService.getIncomeById(N, e.id), null);
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  const recreated = incomesService.findRecentIncome(N, "salario original")!;
  assert.deepEqual([recreated.amount, recreated.description, recreated.date], [3000.55, "Salário original", date]);
});

test("Card 7 RN11: a edicao de gasto fixo tambem termina com a dica de desfazer, uma vez so", async (t) => {
  const N = "551100091842";
  seed(N);
  createRecurringExpense({ fromNumber: N, description: "Fixo dica aud", amount: 50, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_recurring_expense", query: "fixo dica aud", new_amount: 60 }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o fixo dica aud pra 60"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(last(sent), '✏️ Gasto fixo "Fixo dica aud" alterado: valor R$50.00 → R$60.00\nErrou? Responde *desfazer*.');
  assert.equal(last(sent).split("Errou? Responde *desfazer*.").length - 1, 1);
});

test("D-05 (corrigido no Card 10): evento EM ANDAMENTO e encontrado -- da pra esticar o termino depois de comecar", async (t) => {
  const N = "551100091850";
  seed(N);
  t.mock.method(Date, "now", () => new Date("2026-10-14T12:00:00-03:00").getTime()); // meio-dia de SP: +3 h nao vira o dia
  const start = new Date(Date.now() - 30 * 60 * 1000);
  const end = new Date(Date.now() + 30 * 60 * 1000);
  eventsService.createEvent({ fromNumber: N, title: "Reuniao em andamento", start: start.toISOString(), end: end.toISOString() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao em andamento", new_duration_minutes: 180 }]);
  await handleIncomingMessage(evolutionMessage(N, "a reuniao em andamento vai durar 3 horas"));
  assert.match(last(sent), /Término:/, "esperado: previa do novo termino; obtido: " + last(sent));
});

test("D-06 (corrigido no Card 11): busca de evento e lembrete por texto ignora acento ('remedio' acha 'Remédio'), como gastos, entradas e gastos fixos", () => {
  const N = "551100091851";
  remindersService.createReminder(N, "Remédio da pressão", futureAt(2, 9));
  eventsService.createEvent({ fromNumber: N, title: "Consulta médica", start: futureAt(3, 14) });
  assert.equal(remindersService.findPendingRemindersByText(N, "remedio").length, 1, "lembrete");
  assert.equal(eventsService.findUpcomingEvents(N, "medica").length, 1, "evento");
});

test("Card 2: nenhum candidato -- evento, lembrete, gasto fixo, gasto e entrada recebem mensagem clara e nenhuma pendencia", async (t) => {
  const N = "551100091852";
  seed(N);
  const { sent, queueReply } = withMocks(t);
  const ask = async (a: Interpretation) => {
    queueReply([a]);
    await handleIncomingMessage(evolutionMessage(N, "pedido sem candidato"));
    return last(sent);
  };
  assert.equal(await ask({ type: "edit_event", query: "naoexiste", new_title: "x" }), 'Não encontrei nenhum evento parecido com "naoexiste" (em andamento ou futuro).');
  assert.equal(await ask({ type: "delete_event", query: "naoexiste" }), 'Não encontrei nenhum evento parecido com "naoexiste" (em andamento ou futuro).');
  assert.equal(await ask({ type: "edit_reminder", query: "naoexiste", new_message: "x" }), 'Não encontrei nenhum lembrete parecido com "naoexiste".');
  assert.equal(await ask({ type: "edit_recurring_expense", query: "naoexiste", new_amount: 10 }), 'Não achei nenhum gasto fixo parecido com "naoexiste".');
  assert.equal(await ask({ type: "edit_expense", query: "naoexiste", changes: [{ field: "amount", value: "10" }] }), 'Não achei nenhum gasto recente parecido com "naoexiste" pra editar.');
  assert.equal(await ask({ type: "delete_income", query: "naoexiste" }), 'Não achei nenhuma entrada parecida com "naoexiste".');
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 5: pedido de entrada que nao muda nada responde 'Ja esta assim' e nao deixa pendencia", async (t) => {
  const N = "551100091853";
  seed(N);
  incomesService.insertIncome({ fromNumber: N, amount: 500, description: "Entrada igual aud", date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_income", query: "entrada igual aud", changes: [{ field: "amount", value: "500" }, { field: "description", value: "Entrada igual aud" }] }]);
  await handleIncomingMessage(evolutionMessage(N, "entrada igual aud 500"));
  assert.equal(last(sent), "Já está assim, não mexi em nada.");
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 6 RN10 + desfazer: editar so o titulo de um evento ja avisado e desfazer NAO reativam o aviso; desfazer a remarcacao reativa", async (t) => {
  const N = "551100091854";
  seed(N);
  const ev = eventsService.createEvent({ fromNumber: N, title: "Evento desfazer aviso", start: futureAt(3, 14), end: futureAt(3, 15) });
  eventsService.markEventReminderSent(N, ev.id);
  const { queueReply } = withMocks(t);

  queueReply([{ type: "edit_event", query: "evento desfazer aviso", new_title: "Evento renomeado aud" }]);
  await handleIncomingMessage(evolutionMessage(N, "renomeia o evento desfazer aviso"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(eventsService.getEventById(N, ev.id)?.reminder_sent, 1);
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(N, "desfaz isso"));
  const undone = eventsService.getEventById(N, ev.id)!;
  assert.equal(undone.title, "Evento desfazer aviso");
  assert.equal(undone.reminder_sent, 1); // o desfazer de um titulo tambem nao reenvia aviso

  // remarcar o inicio reativa; desfazer a remarcacao devolve o inicio (e, como o inicio mudou de novo, reativa de novo)
  queueReply([{ type: "edit_event", query: "evento desfazer aviso", new_time: "16:00" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o evento desfazer aviso pra 16h"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(eventsService.getEventById(N, ev.id)?.reminder_sent, 0);
});
