// Card 16 (RN01 a RN10, RN16): a consulta de agenda pelo WhatsApp -- hoje, amanha, dia X, semana, proximos dias, mes,
// filtro por tipo, "meus lembretes", teto com link e dia inexistente no mes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createReminder, markReminderSent } from "../../src/reminders/service";
import { createEvent } from "../../src/events/service";
import { config } from "../../src/config";

const at = (iso: string) => new Date(iso).getTime();
const THU_10H = at("2026-10-15T10:00:00-03:00");

let seq = 0;
function user(): string {
  const n = `55110009500${String(seq++).padStart(2, "0")}`;
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

test("Card 16: 'o que tenho hoje' as 10h mostra o dia inteiro -- lembrete das 7h ✔️, consulta das 8h e reuniao 9h-11h em andamento", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const sent = createReminder(n, "Remédio", "2026-10-15T07:00:00-03:00");
  markReminderSent(n, sent);
  createEvent({ fromNumber: n, title: "Consulta", start: "2026-10-15T08:00:00-03:00", end: "2026-10-15T08:45:00-03:00" });
  createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00", location: "Sala 2" });
  createReminder(n, "Ligar pro contador", "2026-10-15T18:00:00-03:00");
  const text = await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.equal(
    text,
    "📅 Agenda — hoje (qui 15/10)\n\n• ✔️ 07:00 Remédio\n• 08:00–08:45 Consulta\n• agora 09:00–11:00 Reunião · Sala 2\n• ⏰ 18:00 Ligar pro contador"
  );
});

test("Card 16: 'agenda de amanha' mistura eventos e lembretes em ordem de horario com termino e local; 'Nada agendado.' num dia vazio", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  createEvent({ fromNumber: n, title: "Consulta", start: "2026-10-16T15:00:00-03:00", end: "2026-10-16T16:00:00-03:00", location: "Clínica Sorriso" });
  createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-16T09:00:00-03:00", end: "2026-10-16T10:00:00-03:00", location: "Sala 2" });
  createReminder(n, "Pagar boleto", "2026-10-16T14:00:00-03:00");
  assert.equal(
    await say(app, n, "agenda de amanhã", { type: "report", date: "2026-10-16" }),
    "📅 Agenda — amanhã (sex 16/10)\n\n• 09:00–10:00 Reunião · Sala 2\n• ⏰ 14:00 Pagar boleto\n• 15:00–16:00 Consulta · Clínica Sorriso"
  );
  assert.equal(await say(app, n, "agenda de domingo", { type: "report", date: "2026-10-18" }), "📅 Agenda — dia 18/10 (dom)\n\nNada agendado.");
  assert.equal(await say(app, n, "lembretes de domingo", { type: "report", date: "2026-10-18", scope: "reminders" }), "⏰ Lembretes — dia 18/10 (dom)\n\nNenhum lembrete.");
});

test("Card 16: semana atual numa quinta mostra de quinta a domingo; semana que vem e a seguinte; so eventos / so lembretes", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  createEvent({ fromNumber: n, title: "Hoje cedo", start: "2026-10-15T08:00:00-03:00", end: "2026-10-15T09:00:00-03:00" }); // ja terminou
  createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-15T09:30:00-03:00", end: "2026-10-15T11:00:00-03:00" });
  createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-17T10:00:00-03:00", end: "2026-10-17T11:00:00-03:00", location: "Clínica Sorriso" });
  createEvent({ fromNumber: n, title: "Segunda que vem", start: "2026-10-19T09:00:00-03:00", end: "2026-10-19T10:00:00-03:00" });
  createReminder(n, "Ligar pro contador", "2026-10-15T18:00:00-03:00");
  createReminder(n, "Segunda lembrete", "2026-10-19T08:00:00-03:00");

  assert.equal(
    await say(app, n, "agenda da semana", { type: "report", week: "current" }),
    "📅 Agenda — restante da semana (15/10 a 18/10)\n\nHoje · qui 15/10\n• agora 09:30–11:00 Reunião\n• ⏰ 18:00 Ligar pro contador\nSáb 17/10\n• 10:00–11:00 Dentista · Clínica Sorriso"
  );
  assert.equal(
    await say(app, n, "semana que vem", { type: "report", week: "next" }),
    "📅 Agenda — semana que vem (19/10 a 25/10)\n\nSeg 19/10\n• ⏰ 08:00 Segunda lembrete\n• 09:00–10:00 Segunda que vem"
  );
  assert.equal(
    await say(app, n, "eventos da semana", { type: "report", week: "current", scope: "events" }),
    "📅 Eventos — restante da semana (15/10 a 18/10)\n\nHoje · qui 15/10\n• agora 09:30–11:00 Reunião\nSáb 17/10\n• 10:00–11:00 Dentista · Clínica Sorriso"
  );
  assert.equal(
    await say(app, n, "lembretes da semana", { type: "report", week: "current", scope: "reminders" }),
    "⏰ Lembretes — restante da semana (15/10 a 18/10)\n\nHoje · qui 15/10\n• ⏰ 18:00 Ligar pro contador"
  );
});

test("Card 16: proximos 15 dias (so o que ainda vale) e mes: futuro mostra tudo, atual mostra o mes inteiro inclusive o passado", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  createEvent({ fromNumber: n, title: "Passou", start: "2026-10-05T09:00:00-03:00", end: "2026-10-05T10:00:00-03:00" });
  createEvent({ fromNumber: n, title: "Em andamento", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00" });
  createEvent({ fromNumber: n, title: "Em novembro", start: "2026-11-10T14:00:00-03:00", end: "2026-11-10T15:00:00-03:00" });
  const done = createReminder(n, "Lembrete que tocou", "2026-10-06T09:00:00-03:00");
  markReminderSent(n, done);
  createReminder(n, "Lembrete em novembro", "2026-11-20T09:00:00-03:00");
  createReminder(n, "Lembrete em 5 dias", "2026-10-20T09:00:00-03:00");

  const next = await say(app, n, "próximos 15 dias", { type: "report", days: 15 });
  assert.match(next, /^📅 Agenda — próximos 15 dias\n\nHoje · qui 15\/10\n• agora 09:00–11:00 Em andamento\nTer 20\/10\n• ⏰ 09:00 Lembrete em 5 dias$/);
  assert.ok(!next.includes("Passou") && !next.includes("tocou"));

  const nov = await say(app, n, "agenda de novembro", { type: "report", month: "2026-11" });
  assert.equal(nov, "📅 Agenda — novembro/2026\n\nTer 10/11\n• 14:00–15:00 Em novembro\nSex 20/11\n• ⏰ 09:00 Lembrete em novembro");

  const oct = await say(app, n, "agenda de outubro", { type: "report", month: "2026-10" });
  assert.match(oct, /^📅 Agenda — outubro\/2026\n\nSeg 05\/10\n• 09:00–10:00 Passou\nTer 06\/10\n• ✔️ 09:00 Lembrete que tocou\nHoje · qui 15\/10\n• agora 09:00–11:00 Em andamento\nTer 20\/10\n• ⏰ 09:00 Lembrete em 5 dias$/);
});

test("Card 16: 'meus lembretes' mostra os 10 mais proximos e o '…e mais 6'; 'todos os meus lembretes' mostra os 16", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  for (let i = 1; i <= 16; i++) createReminder(n, `Lembrete ${String(i).padStart(2, "0")}`, `2026-10-${String(15 + Math.ceil(i / 4)).padStart(2, "0")}T${String(8 + (i % 4)).padStart(2, "0")}:00:00-03:00`);
  const first = await say(app, n, "meus lembretes", { type: "list_reminders" });
  assert.match(first, /^⏰ Lembretes — próximos 10\n\n/);
  assert.equal(first.split("\n").filter((l) => l.startsWith("• ")).length, 10);
  assert.ok(first.endsWith('…e mais 6. Diga "todos os meus lembretes" pra ver tudo.'));
  assert.match(first, /Lembrete 01/);
  assert.ok(!first.includes("Lembrete 16"));
  const all = await say(app, n, "todos os meus lembretes", { type: "list_reminders", all: true });
  assert.equal(all.split("\n").filter((l) => l.startsWith("• ")).length, 16);
  assert.ok(all.includes("Lembrete 16") && !all.includes("Veja tudo no painel"));
  assert.equal(await say(app, user(), "meus lembretes", { type: "list_reminders" }), "⏰ Lembretes — próximos 10\n\nNenhum lembrete.");
});

test("Card 16: mais de 30 itens mostra 30 e a linha com o link do painel; nada de outro numero aparece", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const other = user();
  for (let i = 0; i < 34; i++) createReminder(n, `Item ${i}`, `2026-10-16T${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00-03:00`);
  createReminder(other, "SEGREDO DO OUTRO", "2026-10-16T09:15:00-03:00");
  const text = await say(app, n, "agenda de amanhã", { type: "report", date: "2026-10-16" });
  assert.equal(text.split("\n").filter((l) => l.startsWith("• ")).length, 30);
  assert.ok(text.endsWith(`…e mais 4 itens. Veja tudo no painel: ${config.dashboardUrl}`));
  assert.ok(!text.includes("SEGREDO"));
  assert.ok(text.length < 3500);
});

test("Card 16 (RN16): 'agenda do dia 31' em abril mostra o dia 30/04 com o aviso; dia 32 pede a data de novo", async (t) => {
  const app = bootApp(t, at("2026-04-10T12:00:00-03:00"));
  const n = user();
  createReminder(n, "Pagar o aluguel", "2026-04-30T09:00:00-03:00");
  assert.equal(
    await say(app, n, "agenda do dia 31", { type: "report", date: "2026-04-31" }),
    "Abril só tem 30 dias — mostrando o dia 30/04.\n\n📅 Agenda — dia 30/04 (qui)\n\n• ⏰ 09:00 Pagar o aluguel"
  );
  assert.match(await say(app, n, "agenda do dia 32", { type: "report", date: "2026-04-32" }), /^Não entendi essa data\./);
});

test("Card 16: 23:30 e 00:10 ficam cada um no seu dia mesmo com o relogio do servidor em UTC (22h30 de SP)", async (t) => {
  const app = bootApp(t, at("2026-10-15T22:30:00-03:00"));
  const n = user();
  createEvent({ fromNumber: n, title: "Jantar", start: "2026-10-15T23:30:00-03:00", end: "2026-10-15T23:59:00-03:00" });
  createReminder(n, "Meia-noite", "2026-10-16T00:10:00-03:00");
  const hoje = await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.equal(hoje, "📅 Agenda — hoje (qui 15/10)\n\n• 23:30–23:59 Jantar");
  const amanha = await say(app, n, "e amanhã?", { type: "report", date: "2026-10-16" });
  assert.equal(amanha, "📅 Agenda — amanhã (sex 16/10)\n\n• ⏰ 00:10 Meia-noite");
});

test("Card 16: 'a agenda' sem recorte assume os proximos 7 dias", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  createReminder(n, "Em 3 dias", "2026-10-18T09:00:00-03:00");
  createReminder(n, "Em 10 dias", "2026-10-25T09:00:00-03:00");
  const text = await say(app, n, "a agenda", { type: "report" });
  assert.match(text, /^📅 Agenda — próximos 7 dias\n\nDom 18\/10\n• ⏰ 09:00 Em 3 dias$/);
});
