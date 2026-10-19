// Card 10: agenda -- aviso "Daqui a..." fora de hora (evento remarcado pro passado) e evento EM ANDAMENTO
// que nao era encontrado (defeitos D-02 e D-05 da auditoria, docs/auditoria-cards-1-a-7.md).
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import cron from "node-cron";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { resetRateLimitForTests } from "../../src/access/rateLimit";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";
import { spDateString, addDaysToDateString } from "../../src/timeSP";
import * as eventsService from "../../src/events/service";
import { startEventReminderScheduler } from "../../src/events/reminderScheduler";
import { getRecentActivity } from "../../src/activity/service";
import { hhmm } from "../../src/events/editPlan";

function evolutionMessage(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `and-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
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

const last = (sent: Sent[]) => sent[sent.length - 1].text;
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60 * 1000).toISOString();
const PAST_WARNING = "⚠️ Esse horário já passou — não vou mandar aviso.";

// reuniao que comecou ha 30 min e termina daqui a 30 min
function createOngoing(from: string, title: string) {
  return eventsService.createEvent({ fromNumber: from, title, start: minutesFromNow(-30), end: minutesFromNow(30) });
}

test("Card 10 -- menu 'editar > Evento' lista o evento em andamento (com ' · em andamento') antes dos futuros", async (t) => {
  const N = "551100092501";
  seed(N);
  createOngoing(N, "Reuniao lista andamento");
  eventsService.createEvent({ fromNumber: N, title: "Dentista lista futuro", start: minutesFromNow(60 * 24 * 3) });
  const { sent } = withMocks(t);
  await handleIncomingMessage(evolutionMessage(N, "editar"));
  await handleIncomingMessage(evolutionMessage(N, "4"));
  const list = last(sent);
  assert.match(list, /1\. Reunião lista andamento|1\. Reuniao lista andamento/);
  assert.match(list, /1\. Reuni.o lista andamento — .* · em andamento/);
  assert.match(list, /2\. Dentista lista futuro — (?!.*em andamento)/);
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
});

test("Card 10 -- esticar o termino da reuniao EM ANDAMENTO: previa mostra 'Término: antes → depois' e confirma", async (t) => {
  const N = "551100092502";
  seed(N);
  t.mock.method(Date, "now", () => new Date("2026-10-14T12:00:00-03:00").getTime()); // meio-dia de SP: +3 h nao vira o dia
  const event = createOngoing(N, "Reuniao esticar");
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao esticar", new_duration_minutes: 180 }]);
  await handleIncomingMessage(evolutionMessage(N, "a reuniao esticar vai durar 3 horas"));
  const preview = last(sent);
  const newEnd = new Date(new Date(event.start).getTime() + 180 * 60 * 1000).toISOString();
  assert.match(preview, / · em andamento/, "cabecalho informa que esta em andamento");
  assert.ok(preview.includes(`Término: ${hhmm(event.end)} → ${hhmm(newEnd)}`), preview);
  assert.ok(!preview.includes(PAST_WARNING), "so esticar o termino nao e remarcar o inicio");
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(hhmm(eventsService.getEventById(N, event.id)!.end), hhmm(newEnd));
});

test("Card 10 -- editar so o titulo do evento em andamento nao reativa o aviso ja enviado", async (t) => {
  const N = "551100092503";
  seed(N);
  const event = createOngoing(N, "Reuniao titulo andamento");
  eventsService.markEventReminderSent(N, event.id);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao titulo andamento", new_title: "Reuniao titulo novo" }]);
  await handleIncomingMessage(evolutionMessage(N, "renomeia a reuniao titulo andamento"));
  assert.ok(!last(sent).includes(PAST_WARNING));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(eventsService.getEventById(N, event.id)?.title, "Reuniao titulo novo");
  assert.equal(eventsService.getEventById(N, event.id)?.reminder_sent, 1);
});

test("Card 10 -- cancelar o evento em andamento pergunta 1/3 (nao diz que nao achou)", async (t) => {
  const N = "551100092504";
  seed(N);
  const event = createOngoing(N, "Reuniao cancelar andamento");
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "reuniao cancelar andamento" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a reuniao cancelar andamento"));
  assert.match(last(sent), /🗑️ Cancelar este evento\?/);
  assert.match(last(sent), /1 🗑️ Cancelar o evento\n3 ↩️ Manter na agenda$/);
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(eventsService.getEventById(N, event.id), undefined);
});

test("Card 10 -- nao achar o evento: textos diferentes pra editar (em andamento ou futuro) e pra avisos (so futuro)", async (t) => {
  const N = "551100092505";
  seed(N);
  createOngoing(N, "Reuniao so andamento");
  const { sent, queueReply } = withMocks(t);
  // avisos extras so valem pra evento que ainda nao comecou: o em andamento NAO e candidato
  queueReply([{ type: "add_event_reminder", query: "reuniao so andamento", minutes_before: 15 }]);
  await handleIncomingMessage(evolutionMessage(N, "avisa 15 min antes da reuniao so andamento"));
  assert.equal(last(sent), 'Não encontrei nenhum evento futuro parecido com "reuniao so andamento".');
  queueReply([{ type: "remove_event_reminder", query: "reuniao so andamento", minutes_before: 15 }]);
  await handleIncomingMessage(evolutionMessage(N, "tira o aviso de 15 min da reuniao so andamento"));
  assert.equal(last(sent), 'Não encontrei nenhum evento futuro parecido com "reuniao so andamento".');
  // editar/cancelar encontram o mesmo evento
  queueReply([{ type: "edit_event", query: "reuniao inexistente", new_title: "x" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda a reuniao inexistente"));
  assert.equal(last(sent), 'Não encontrei nenhum evento parecido com "reuniao inexistente" (em andamento ou futuro).');
});

test("Card 10 -- remarcar pro passado mostra a linha ⚠️ na previa (e ao confirmar o aviso continua desligado)", async (t) => {
  const N = "551100092506";
  seed(N);
  const event = eventsService.createEvent({
    fromNumber: N,
    title: "Evento remarcar passado",
    start: `${addDaysToDateString(spDateString(), 3)}T14:00:00-03:00`,
    end: `${addDaysToDateString(spDateString(), 3)}T15:00:00-03:00`,
  });
  eventsService.markEventReminderSent(N, event.id);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento remarcar passado", new_date: addDaysToDateString(spDateString(), -2) }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o evento remarcar passado pra anteontem"));
  const preview = last(sent);
  assert.ok(preview.includes(PAST_WARNING), preview);
  // a linha de aviso vem depois das mudancas e antes das opcoes
  assert.ok(preview.indexOf(PAST_WARNING) > preview.indexOf("→") && preview.indexOf(PAST_WARNING) < preview.indexOf("1 ✅ Confirmar"));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.ok(!eventsService.getDueEventReminders().some((e) => e.id === event.id));
});

test("Card 10 -- remarcar pro FUTURO nao mostra o ⚠️ e reativa o aviso", async (t) => {
  const N = "551100092507";
  seed(N);
  const event = eventsService.createEvent({
    fromNumber: N,
    title: "Evento remarcar futuro",
    start: `${addDaysToDateString(spDateString(), 3)}T14:00:00-03:00`,
    end: `${addDaysToDateString(spDateString(), 3)}T15:00:00-03:00`,
  });
  eventsService.markEventReminderSent(N, event.id);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento remarcar futuro", new_date: addDaysToDateString(spDateString(), 5) }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o evento remarcar futuro pra daqui a 5 dias"));
  assert.ok(!last(sent).includes(PAST_WARNING), last(sent));
  await handleIncomingMessage(evolutionMessage(N, "1"));
  assert.equal(eventsService.getEventById(N, event.id)?.reminder_sent, 0);
});

test("Card 10 -- agendador: avisa evento que comeca agora, NAO avisa o que comecou ha 10 min, e registra o ignorado so uma vez", async (t) => {
  const N = "551100092508";
  seed(N);
  const fresh = eventsService.createEvent({ fromNumber: N, title: "Evento aviso fresco", start: minutesFromNow(-2), end: minutesFromNow(58), reminderMinutes: 60 });
  const stale = eventsService.createEvent({ fromNumber: N, title: "Evento aviso velho", start: minutesFromNow(-10), end: minutesFromNow(50), reminderMinutes: 60 });
  const { sent } = withMocks(t);
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (_expr: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop() {} };
  });
  startEventReminderScheduler();
  assert.ok(tick);
  await tick!();
  await tick!();
  const mine = sent.filter((m) => m.to === N);
  assert.equal(mine.length, 1, "so o evento recente gera aviso, uma vez");
  assert.match(mine[0].text, /^🔔 Agora: Evento aviso fresco \(/);
  assert.equal(eventsService.getEventById(N, fresh.id)?.reminder_sent, 1);
  assert.equal(eventsService.getEventById(N, stale.id)?.reminder_sent, 0, "o ignorado nao e gravado como enviado");
  const logged = getRecentActivity(500).filter((a) => a.from_number === N && a.type === "event_reminder_skipped");
  assert.equal(logged.length, 1, "log do aviso ignorado: uma unica vez, mesmo com 2 ticks");
  assert.match(logged[0].summary, /Evento aviso velho/);
});

test("Card 10 -- agendador: aviso EXTRA dispara na janela, e falha de envio nao marca como enviado nem derruba o ciclo", async (t) => {
  const N = "551100092509";
  seed(N);
  const event = eventsService.createEvent({ fromNumber: N, title: "Evento extra agendador", start: minutesFromNow(30), end: minutesFromNow(90), reminderMinutes: 5 });
  eventsService.addEventExtraReminder(N, event.id, 60);
  const { sent } = withMocks(t);
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (_expr: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop() {} };
  });
  t.mock.method(console, "error", () => {});
  startEventReminderScheduler();
  await tick!();
  const mine = sent.filter((m) => m.to === N);
  assert.equal(mine.length, 1);
  assert.match(mine[0].text, /^🔔 Daqui a 30 min: Evento extra agendador \(/);
  assert.equal(eventsService.getDueExtraEventReminders().filter((d) => d.eventId === event.id).length, 0, "extra marcado como enviado");
  assert.equal(eventsService.getEventById(N, event.id)?.reminder_sent, 0, "o principal (5 min antes) ainda nao venceu");

  // falha no envio: nada e marcado e o proximo ciclo tenta de novo
  const failing = eventsService.createEvent({ fromNumber: N, title: "Evento envio falha", start: minutesFromNow(-1), end: minutesFromNow(59), reminderMinutes: 30 });
  eventsService.addEventExtraReminder(N, failing.id, 45);
  (whatsappClient.sendText as unknown as { mock: { mockImplementation(fn: () => Promise<void>): void } }).mock.mockImplementation(async () => {
    throw new Error("falha simulada");
  });
  await tick!();
  assert.equal(eventsService.getEventById(N, failing.id)?.reminder_sent, 0);
  assert.ok(eventsService.getDueEventReminders().some((e) => e.id === failing.id));
  assert.ok(eventsService.getDueExtraEventReminders().some((d) => d.eventId === failing.id));
});

test("Card 10 (revisao) -- aviso ignorado: uma linha por evento mesmo depois de reiniciar o servidor", async () => {
  const N = "551100092510";
  seed(N);
  const stale = eventsService.createEvent({ fromNumber: N, title: "Evento ignorado reinicio", start: minutesFromNow(-20), end: minutesFromNow(40), reminderMinutes: 60 });
  const countLogged = () =>
    getRecentActivity(500).filter((a) => a.from_number === N && a.type === "event_reminder_skipped" && a.summary.includes("Evento ignorado reinicio")).length;

  const scheduler = require("../../src/events/reminderScheduler");
  assert.equal(scheduler.logSkippedEventReminders(), 1);
  assert.equal(scheduler.logSkippedEventReminders(), 0, "no mesmo processo nao repete");
  assert.equal(countLogged(), 1);

  // reinicio: o cache em memoria some, o log de atividade continua
  delete require.cache[require.resolve("../../src/events/reminderScheduler")];
  const restarted = require("../../src/events/reminderScheduler");
  assert.equal(restarted.logSkippedEventReminders(), 0, "depois do reinicio nao registra de novo");
  assert.equal(countLogged(), 1);
  assert.ok(getRecentActivity(500).find((a) => a.type === "event_reminder_skipped" && a.from_number === N)!.summary.includes(`(#${stale.id})`));

  // o aviso deixa de ser "ignorado" quando o evento e remarcado pro futuro (volta a valer)
  eventsService.updateEvent(N, stale.id, { title: "Evento ignorado reinicio", start: minutesFromNow(600), reminderMinutes: 60 });
  assert.equal(restarted.logSkippedEventReminders(), 0);
});
