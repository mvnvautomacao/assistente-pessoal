// Card 16 (RN13 a RN15): data inexistente no mes (31/04, 30/02, 29/02 fora de ano bissexto) vira o ultimo dia do mes,
// com aviso, na criacao, na edicao (previa so grava no 1), no menu de campos e no adiar.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createReminder, getReminderById } from "../../src/reminders/service";
import { createEvent, getEventById } from "../../src/events/service";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();

let seq = 0;
function user(): string {
  const n = `55110009600${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const remindersOf = (n: string) => db.prepare(`SELECT * FROM reminders WHERE to_number = ? ORDER BY id`).all(n) as { id: number; message: string; due_at: string }[];
const eventsOf = (n: string) => db.prepare(`SELECT * FROM events WHERE from_number = ? ORDER BY id`).all(n) as { id: number; title: string; start: string; end: string }[];

test("Card 16: 'me lembra dia 31 as 9h' em abril grava 30/04 as 09:00 e avisa", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const reply = await say(app, n, "me lembra dia 31 de pagar o aluguel às 9h", { type: "reminder", message: "pagar o aluguel", due_at: "2026-04-31T09:00:00-03:00" });
  assert.match(reply, /^⏰ Lembrete criado: "pagar o aluguel" — vou avisar em qui 30\/04 às 09:00\nAbril só tem 30 dias, então marquei pro dia 30\/04\.\n/);
  assert.equal(remindersOf(n)[0].due_at, "2026-04-30T09:00:00-03:00");
});

test("Card 16: lembrete com data normal nao ganha aviso (regressao)", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const reply = await say(app, n, "me lembra dia 20 de pagar a luz às 9h", { type: "reminder", message: "pagar a luz", due_at: "2026-04-20T09:00:00-03:00" });
  assert.ok(!reply.includes("só tem"), reply);
  assert.equal(remindersOf(n)[0].due_at, "2026-04-20T09:00:00-03:00");
});

test("Card 16: evento 'dia 30 de fevereiro' vai pro dia 28 (2027) ou 29 (2028) e o termino acompanha o mesmo dia", async (t) => {
  const app = bootApp(t, at("2027-02-10T12:00:00-03:00"));
  const n = user();
  const reply = await say(app, n, "reunião dia 30 de fevereiro às 14h", {
    type: "event",
    title: "Reunião",
    start: "2027-02-30T14:00:00-03:00",
    end: "2027-02-30T15:30:00-03:00",
  });
  assert.match(reply, /28\/02/);
  assert.match(reply, /\nFevereiro só tem 28 dias, então marquei pro dia 28\/02\.\n/);
  const row = eventsOf(n)[0];
  assert.equal(new Date(row.start).getTime(), at("2027-02-28T14:00:00-03:00"));
  assert.equal(new Date(row.end).getTime(), at("2027-02-28T15:30:00-03:00"));

  const app2 = bootApp(t, at("2028-02-10T12:00:00-03:00"));
  await say(app2, n, "reunião dia 29 às 10h", { type: "event", title: "Bissexto", start: "2028-02-29T10:00:00-03:00" });
  assert.ok(!app2.last().includes("só tem"), "29/02/2028 existe");
  await say(app2, n, "reunião dia 30 às 11h", { type: "event", title: "Bissexto 30", start: "2028-02-30T11:00:00-03:00" });
  assert.match(app2.last(), /Fevereiro só tem 29 dias, então marquei pro dia 29\/02\./);
  assert.equal(new Date(eventsOf(n).find((e) => e.title === "Bissexto 30")!.start).getTime(), at("2028-02-29T11:00:00-03:00"));
});

test("Card 16 (RN14): 'dia 31 as 9h' em 30/04 as 15h cai no passado -- vale 31/05 e avisa a data final", async (t) => {
  const app = bootApp(t, at("2026-04-30T15:00:00-03:00"));
  const n = user();
  const reply = await say(app, n, "me lembra dia 31 às 9h de pagar", { type: "reminder", message: "pagar", due_at: "2026-04-31T09:00:00-03:00" });
  assert.match(reply, /\nAbril só tem 30 dias, e o dia 30\/04 já passou, então marquei pro dia 31\/05\.\n/);
  assert.equal(remindersOf(n)[0].due_at, "2026-05-31T09:00:00-03:00");
});

test("Card 16: dia 32 e mes 13 NAO sao ajustados", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const reply = await say(app, n, "me lembra dia 32 de pagar", { type: "reminder", message: "pagar", due_at: "2026-04-32T09:00:00-03:00" });
  assert.ok(!reply.includes("só tem"), reply);
  assert.equal(remindersOf(n)[0].due_at, "2026-04-32T09:00:00-03:00", "segue o tratamento de hoje");
});

test("Card 16: editar lembrete pra 'dia 31' em abril mostra a data ajustada + aviso na previa e so grava no 1", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const id = createReminder(n, "Pagar boleto", "2026-04-20T09:00:00-03:00");
  const preview = await say(app, n, "muda o lembrete do boleto pro dia 31", { type: "edit_reminder", query: "boleto", new_date: "2026-04-31" });
  assert.match(preview, /^✏️ Pagar boleto\nQuando: .*20\/04.* → .*30\/04.*09:00\nAbril só tem 30 dias, então marquei pro dia 30\/04\.\n\n1 ✅/s);
  assert.equal(getReminderById(n, id)?.due_at, "2026-04-20T09:00:00-03:00", "nada gravado antes do 1");
  await say(app, n, "1");
  assert.equal(getReminderById(n, id)?.due_at, "2026-04-30T09:00:00-03:00");
});

test("Card 16: corrigir (opcao 2) a data da previa pra um dia inexistente tambem ajusta e avisa; corrigir pra data normal tira o aviso", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const id = createReminder(n, "Pagar boleto", "2026-04-20T09:00:00-03:00");
  await say(app, n, "muda o lembrete do boleto pro dia 25", { type: "edit_reminder", query: "boleto", new_date: "2026-04-25" });
  assert.match(await say(app, n, "2"), /^Qual é a data e hora certas\?/);
  // a resposta livre passa pela IA de data: simula
  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractDateTimeFromAnswer", async () => ({ newDate: "2026-04-31" }));
  const again = await say(app, n, "dia 31");
  assert.match(again, /→ .*30\/04.*09:00\nAbril só tem 30 dias, então marquei pro dia 30\/04\./s);
  await say(app, n, "1");
  assert.equal(getReminderById(n, id)?.due_at, "2026-04-30T09:00:00-03:00");
});

test("Card 16: editar evento pra 'dia 31' em abril: previa com aviso, termino no mesmo dia, grava no 1", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const created = createEvent({ fromNumber: n, title: "Dentista", start: "2026-04-20T10:00:00-03:00", end: "2026-04-20T11:00:00-03:00" });
  const preview = await say(app, n, "remarca o dentista pro dia 31", { type: "edit_event", query: "dentista", new_date: "2026-04-31" });
  assert.match(preview, /Abril só tem 30 dias, então marquei pro dia 30\/04\./);
  assert.equal(getEventById(n, created.id)?.start, "2026-04-20T10:00:00-03:00");
  await say(app, n, "1");
  const row = getEventById(n, created.id)!;
  assert.equal(new Date(row.start).getTime(), at("2026-04-30T10:00:00-03:00"));
  assert.equal(new Date(row.end).getTime(), at("2026-04-30T11:00:00-03:00"));
});

test("Card 16: menu de campos 'Dia e hora' do lembrete com dia inexistente cai na previa ajustada", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const id = createReminder(n, "Pagar boleto", "2026-04-20T09:00:00-03:00");
  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractDateTimeFromAnswer", async () => ({ newDate: "2026-04-31" }));
  await say(app, n, "editar");
  await say(app, n, "5"); // lembrete
  await say(app, n, "1"); // o item
  await say(app, n, "1"); // Dia e hora
  const preview = await say(app, n, "dia 31");
  assert.match(preview, /Abril só tem 30 dias, então marquei pro dia 30\/04\./);
  await say(app, n, "1");
  assert.equal(getReminderById(n, id)?.due_at, "2026-04-30T09:00:00-03:00");
});

// Card 18 (RF05): `let dateWarning` em applyEventCorrection era gravada e nunca lida -- o aviso do evento ficava velho depois da correcao
test("Card 18: corrigir (opcao 2) a data da previa de EVENTO atualiza o aviso de dia ajustado (some com data normal, volta com dia inexistente)", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  const created = createEvent({ fromNumber: n, title: "Dentista", start: "2026-04-20T10:00:00-03:00", end: "2026-04-20T11:00:00-03:00" });
  const preview = await say(app, n, "remarca o dentista pro dia 31", { type: "edit_event", query: "dentista", new_date: "2026-04-31" });
  assert.match(preview, /Abril só tem 30 dias, então marquei pro dia 30\/04\./);

  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractDateTimeFromAnswer", async (text: string) => ({ newDate: text.includes("31") ? "2026-04-31" : "2026-04-25" }));
  await say(app, n, "2");
  const normal = await say(app, n, "dia 25");
  assert.match(normal, /→ .*25\/04/s);
  assert.ok(!normal.includes("Abril só tem"), `o aviso antigo nao pode ficar na previa: ${normal}`);

  await say(app, n, "2");
  const again = await say(app, n, "dia 31");
  assert.match(again, /Abril só tem 30 dias, então marquei pro dia 30\/04\./);
  await say(app, n, "1");
  assert.equal(new Date(getEventById(n, created.id)!.start).getTime(), at("2026-04-30T10:00:00-03:00"));
});
