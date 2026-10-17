// Card 16 (RN01 a RN10, RF02 a RF05): recortes, texto e servicos da consulta de agenda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgendaRange, AgendaParams, INVALID_AGENDA_DATE_TEXT } from "../../src/agenda/range";
import { formatAgenda, truncateTitle, dayHeader } from "../../src/agenda/format";
import { runAgendaReport, runListReminders } from "../../src/agenda/queries";
import { createEvent, listEventsBetween } from "../../src/events/service";
import { countPendingReminders, createReminder, listNextPendingReminders, listRemindersBetween, markReminderSent } from "../../src/reminders/service";

const THU = new Date("2026-10-15T10:00:00-03:00"); // quinta 15/10/2026
const range = (params: AgendaParams, now: Date = THU) => {
  const result = resolveAgendaRange(params, now);
  assert.ok(result.ok, JSON.stringify(result));
  return result.range;
};

test("resolveAgendaRange: um dia -- hoje, amanha, ontem e outro dia, com o dia da semana", () => {
  const today = range({ date: "2026-10-15" });
  assert.deepEqual(
    [today.label, today.mode, today.onlyUpcoming, today.startIso, today.endIso],
    ["hoje (qui 15/10)", "day", false, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00"]
  );
  assert.equal(range({ date: "2026-10-16" }).label, "amanhã (sex 16/10)");
  assert.equal(range({ date: "2026-10-14" }).label, "ontem (qua 14/10)");
  assert.equal(range({ date: "2026-10-20" }).label, "dia 20/10 (ter)");
  assert.equal(range({ date: "2027-01-05" }).label, "dia 05/01/2027 (ter)", "outro ano mostra o ano");
  assert.equal(range({ date: "2026-12-31" }).endIso, "2027-01-01T00:00:00-03:00", "virada de ano");
});

test("resolveAgendaRange: dia inexistente mostra o ultimo dia do mes com aviso; dia 32, mes 13 e texto dao erro", () => {
  const abril = range({ date: "2026-04-31" }, new Date("2026-04-10T12:00:00-03:00"));
  assert.equal(abril.label, "dia 30/04 (qui)");
  assert.equal(abril.startDate, "2026-04-30");
  assert.equal(abril.notice, "Abril só tem 30 dias — mostrando o dia 30/04.");
  assert.equal(range({ date: "2027-02-30" }).notice, "Fevereiro só tem 28 dias — mostrando o dia 28/02.");
  assert.equal(range({ date: "2027-02-29" }).startDate, "2027-02-28");
  assert.equal(range({ date: "2028-02-29" }).notice, undefined, "29/02/2028 existe");
  assert.equal(range({ date: "2028-02-30" }).startDate, "2028-02-29");
  for (const bad of ["2026-04-32", "2026-13-01", "banana", "2026-00-10", "20/10"]) {
    assert.deepEqual(resolveAgendaRange({ date: bad }, THU), { ok: false, error: INVALID_AGENDA_DATE_TEXT }, bad);
  }
});

test("resolveAgendaRange: semana atual (restante), segunda inteira, domingo, e semana que vem", () => {
  const thu = range({ week: "current" });
  assert.deepEqual([thu.label, thu.mode, thu.onlyUpcoming, thu.startIso, thu.endIso], ["restante da semana (15/10 a 18/10)", "period", true, "2026-10-15T00:00:00-03:00", "2026-10-19T00:00:00-03:00"]);
  assert.equal(range({ week: "current" }, new Date("2026-10-12T08:00:00-03:00")).label, "semana (12/10 a 18/10)", "segunda: semana inteira");
  assert.equal(range({ week: "current" }, new Date("2026-10-18T08:00:00-03:00")).label, "restante da semana (18/10 a 18/10)", "domingo: so hoje");
  const next = range({ week: "next" });
  assert.deepEqual([next.label, next.startIso, next.endIso], ["semana que vem (19/10 a 25/10)", "2026-10-19T00:00:00-03:00", "2026-10-26T00:00:00-03:00"]);
  assert.equal(range({ week: "next" }, new Date("2026-10-18T22:00:00-03:00")).label, "semana que vem (19/10 a 25/10)", "no domingo a que vem e a de amanha");
  assert.equal(range({ week: "current" }, new Date("2026-12-30T10:00:00-03:00")).endIso, "2027-01-04T00:00:00-03:00", "virada de ano");
});

test("resolveAgendaRange: proximos N dias (padrao 7, limites), mes nomeado (inteiro) e mes invalido", () => {
  const def = range({});
  assert.deepEqual([def.label, def.startIso, def.endIso, def.onlyUpcoming], ["próximos 7 dias", THU.toISOString(), new Date(THU.getTime() + 7 * 86400000).toISOString(), true]);
  assert.equal(range({ days: 15 }).label, "próximos 15 dias");
  assert.equal(range({ days: 1 }).label, "próximas 24 horas");
  assert.equal(range({ days: 0 }).label, "próximas 24 horas");
  assert.equal(range({ days: 9999 }).label, "próximos 365 dias");
  const nov = range({ month: "2026-11" });
  assert.deepEqual([nov.label, nov.mode, nov.onlyUpcoming, nov.startIso, nov.endIso], ["novembro/2026", "period", false, "2026-11-01T00:00:00-03:00", "2026-12-01T00:00:00-03:00"]);
  assert.equal(range({ month: "2026-12" }).endIso, "2027-01-01T00:00:00-03:00");
  assert.equal(resolveAgendaRange({ month: "2026-13" }, THU).ok, false);
  assert.equal(resolveAgendaRange({ month: "novembro" }, THU).ok, false);
  assert.equal(range({ days: 3, date: "2026-10-16" }).label, "amanhã (sex 16/10)", "date vence days");
});

test("resolveAgendaRange: servidor em UTC -- 22h30 de Sao Paulo ainda e o mesmo dia", () => {
  const night = new Date("2026-10-16T01:30:00Z"); // 22:30 de 15/10 em SP
  assert.equal(range({ date: "2026-10-15" }, night).label, "hoje (qui 15/10)");
  assert.equal(range({ week: "current" }, night).label, "restante da semana (15/10 a 18/10)");
  const early = new Date("2026-10-15T03:10:00Z"); // 00:10 de 15/10 em SP
  assert.equal(range({ date: "2026-10-15" }, early).label, "hoje (qui 15/10)");
});

const ev = (over: Partial<{ title: string; start: string; end: string | null; location: string | null }> = {}) => ({
  title: "Reunião",
  start: "2026-10-16T09:00:00-03:00",
  end: "2026-10-16T10:00:00-03:00",
  location: null,
  ...over,
});
const rem = (message: string, due_at: string, sent = 0) => ({ message, due_at, sent });

const base = { now: THU, startDate: "2026-10-15", link: "https://painel.test", emptyText: "Nada agendado." };

test("formatAgenda: um dia -- sem cabecalho, ordem de horario, evento antes de lembrete no mesmo minuto, local so quando ha", () => {
  const text = formatAgenda({
    ...base,
    title: "📅 Agenda — amanhã (sex 16/10)",
    mode: "day",
    events: [ev({ title: "Consulta", start: "2026-10-16T15:00:00-03:00", end: "2026-10-16T16:00:00-03:00", location: "Clínica Sorriso" }), ev({ location: "Sala 2" }), ev({ title: "Sem local", start: "2026-10-16T14:00:00-03:00", end: "2026-10-16T14:30:00-03:00" })],
    reminders: [rem("Pagar boleto", "2026-10-16T14:00:00-03:00"), rem("Ligar", "2026-10-16T09:00:00-03:00")],
  });
  assert.equal(
    text,
    "📅 Agenda — amanhã (sex 16/10)\n\n• 09:00–10:00 Reunião · Sala 2\n• ⏰ 09:00 Ligar\n• 14:00–14:30 Sem local\n• ⏰ 14:00 Pagar boleto\n• 15:00–16:00 Consulta · Clínica Sorriso"
  );
  assert.ok(!/\d{4}, \d{2}:\d{2}:\d{2}/.test(text), "sem data completa nem segundos");
});

test("formatAgenda: periodo -- cabecalho por dia (Hoje, Amanha, outros), 'agora' no evento em andamento e dias vazios somem", () => {
  const text = formatAgenda({
    ...base,
    title: "📅 Agenda — restante da semana (15/10 a 18/10)",
    mode: "period",
    events: [ev({ title: "Reunião", start: "2026-10-15T09:30:00-03:00", end: "2026-10-15T11:00:00-03:00" }), ev({ title: "Dentista", start: "2026-10-17T10:00:00-03:00", end: "2026-10-17T11:00:00-03:00", location: "Clínica" })],
    reminders: [rem("Ligar pro contador", "2026-10-15T18:00:00-03:00"), rem("Remédio", "2026-10-16T08:00:00-03:00")],
  });
  assert.equal(
    text,
    "📅 Agenda — restante da semana (15/10 a 18/10)\n\nHoje · qui 15/10\n• agora 09:30–11:00 Reunião\n• ⏰ 18:00 Ligar pro contador\nAmanhã · sex 16/10\n• ⏰ 08:00 Remédio\nSáb 17/10\n• 10:00–11:00 Dentista · Clínica"
  );
});

test("formatAgenda: lembrete ja enviado ganha ✔️; evento que terminou fica sem marca; evento sem fim mostra so o inicio e usa 1h", () => {
  const text = formatAgenda({
    ...base,
    title: "📅 Agenda — hoje (qui 15/10)",
    mode: "day",
    events: [ev({ title: "Consulta", start: "2026-10-15T08:00:00-03:00", end: "2026-10-15T08:30:00-03:00" }), ev({ title: "Reunião", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00" }), ev({ title: "Antigo", start: "2026-10-15T09:45:00-03:00", end: null })],
    reminders: [rem("Remédio", "2026-10-15T07:00:00-03:00", 1)],
  });
  assert.equal(text, "📅 Agenda — hoje (qui 15/10)\n\n• ✔️ 07:00 Remédio\n• 08:00–08:30 Consulta\n• agora 09:00–11:00 Reunião\n• agora 09:45 Antigo");
});

test("formatAgenda: vazio, aviso antes do titulo, rodape, teto de 30 com link e singular", () => {
  assert.equal(formatAgenda({ ...base, title: "📅 Agenda — amanhã (sex 16/10)", mode: "day", events: [], reminders: [] }), "📅 Agenda — amanhã (sex 16/10)\n\nNada agendado.");
  assert.equal(formatAgenda({ ...base, title: "⏰ Lembretes — amanhã (sex 16/10)", mode: "day", events: [], reminders: [], emptyText: "Nenhum lembrete." }), "⏰ Lembretes — amanhã (sex 16/10)\n\nNenhum lembrete.");
  assert.equal(
    formatAgenda({ ...base, title: "📅 Agenda — dia 30/04 (qui)", notice: "Abril só tem 30 dias — mostrando o dia 30/04.", mode: "day", events: [], reminders: [rem("Aluguel", "2026-04-30T09:00:00-03:00")] }),
    "Abril só tem 30 dias — mostrando o dia 30/04.\n\n📅 Agenda — dia 30/04 (qui)\n\n• ⏰ 09:00 Aluguel"
  );
  const many = Array.from({ length: 33 }, (_, i) => rem(`Item ${i + 1}`, `2026-10-16T${String(Math.floor(i / 2) + 6).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00-03:00`));
  const capped = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: many });
  assert.equal(capped.split("\n").filter((l) => l.startsWith("• ")).length, 30);
  assert.ok(capped.endsWith("…e mais 3 itens. Veja tudo no painel: https://painel.test"));
  const one = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: many.slice(0, 31) });
  assert.ok(one.endsWith("…e mais 1 item. Veja tudo no painel: https://painel.test"));
  assert.ok(capped.length < 3500, "cabe numa mensagem");
  assert.equal(formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: [rem("a", "2026-10-16T09:00:00-03:00")], footer: "rodape" }), "T\n\n• ⏰ 09:00 a\n\nrodape");
});

test("formatAgenda: fuso de SP -- 23:30 e 00:10 ficam cada um no seu dia, com o titulo longo truncado", () => {
  const text = formatAgenda({
    ...base,
    title: "P",
    mode: "period",
    events: [ev({ title: "Jantar", start: "2026-10-16T23:30:00-03:00", end: "2026-10-16T23:59:00-03:00" })],
    reminders: [rem("Meia-noite", "2026-10-17T00:10:00-03:00"), rem("x".repeat(80), "2026-10-17T08:00:00-03:00")],
  });
  assert.match(text, /Amanhã · sex 16\/10\n• 23:30–23:59 Jantar\nSáb 17\/10\n• ⏰ 00:10 Meia-noite\n• ⏰ 08:00 x{59}…/);
  assert.equal(truncateTitle("a".repeat(60)), "a".repeat(60));
  assert.equal(Array.from(truncateTitle("😀".repeat(70))).length, 60);
  assert.equal(dayHeader("2026-10-20", "2026-10-15"), "Ter 20/10");
  assert.equal(dayHeader("2027-01-05", "2026-10-15"), "Ter 05/01/2027");
});

// ---- servicos (SQLite de teste) ----------------------------------------------------------------------------------

const A = "551100071601";
const B = "551100071602";

test("listEventsBetween: sobreposicao, em andamento, evento sem fim (1h), onlyNotEnded e isolamento por numero", () => {
  createEvent({ fromNumber: A, title: "Reuniao 9h", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Cedo", start: "2026-10-15T07:00:00-03:00", end: "2026-10-15T08:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Amanha", start: "2026-10-16T09:00:00-03:00", end: "2026-10-16T10:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Virada", start: "2026-10-15T23:30:00-03:00", end: "2026-10-16T00:30:00-03:00" });
  createEvent({ fromNumber: B, title: "De outro numero", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T10:00:00-03:00" });
  const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
  const day = listEventsBetween(A, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00", { now: THU });
  assert.deepEqual(titles(day), ["Cedo", "Reuniao 9h", "Virada"], "dia inteiro, inclusive o que ja passou; o da virada entra por sobreposicao");
  const upcoming = listEventsBetween(A, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00", { now: THU, onlyNotEnded: true });
  assert.deepEqual(titles(upcoming), ["Reuniao 9h", "Virada"], "em andamento fica; terminado sai");
  // o evento que vira a noite entra tambem no dia seguinte (sobreposicao)
  assert.deepEqual(titles(listEventsBetween(A, "2026-10-16T00:00:00-03:00", "2026-10-17T00:00:00-03:00", { now: THU })), ["Virada", "Amanha"]);
  assert.deepEqual(titles(listEventsBetween(B, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00", { now: THU })), ["De outro numero"]);
  // fronteira: termino exatamente no inicio do intervalo nao conta
  assert.deepEqual(titles(listEventsBetween(A, "2026-10-15T08:00:00-03:00", "2026-10-15T09:00:00-03:00", { now: THU })), []);
});

test("listEventsBetween: evento sem 'end' usa 1h para decidir se terminou", () => {
  const C = "551100071603";
  createEvent({ fromNumber: C, title: "Sem fim", start: "2026-10-15T09:30:00-03:00" });
  const rows = listEventsBetween(C, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00", { now: new Date("2026-10-15T10:10:00-03:00"), onlyNotEnded: true });
  assert.equal(rows.length, 1, "9h30 + 1h = 10h30, ainda nao terminou as 10h10");
  const later = listEventsBetween(C, "2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00", { now: new Date("2026-10-15T10:40:00-03:00"), onlyNotEnded: true });
  assert.equal(later.length, 0);
});

test("lembretes: listRemindersBetween com e sem enviados; proximos pendentes, contagem, offset e isolamento", () => {
  const D = "551100071604";
  const E = "551100071605";
  const enviado = createReminder(D, "Enviado", "2026-10-15T07:00:00-03:00");
  markReminderSent(D, enviado);
  createReminder(D, "Pendente hoje", "2026-10-15T18:00:00-03:00");
  createReminder(D, "Amanha", "2026-10-16T08:00:00-03:00");
  createReminder(E, "Do outro", "2026-10-15T18:00:00-03:00");
  const day = ["2026-10-15T00:00:00-03:00", "2026-10-16T00:00:00-03:00"] as const;
  assert.deepEqual(listRemindersBetween(D, ...day, { includeSent: true }).map((r) => r.message), ["Enviado", "Pendente hoje"]);
  assert.deepEqual(listRemindersBetween(D, ...day).map((r) => r.message), ["Pendente hoje"]);
  assert.deepEqual(listRemindersBetween(E, ...day).map((r) => r.message), ["Do outro"]);
  assert.equal(countPendingReminders(D, THU), 2);
  assert.deepEqual(listNextPendingReminders(D, 10, 0, THU).map((r) => r.message), ["Pendente hoje", "Amanha"]);
  assert.deepEqual(listNextPendingReminders(D, 1, 1, THU).map((r) => r.message), ["Amanha"]);
  assert.equal(countPendingReminders(D, new Date("2026-10-16T09:00:00-03:00")), 0, "depois do horario nao e mais 'proximo'");
});

test("runAgendaReport e runListReminders: texto final, erro de recorte e teto/rodape de 'meus lembretes'", () => {
  const F = "551100071606";
  createEvent({ fromNumber: F, title: "Reunião", start: "2026-10-16T09:00:00-03:00", end: "2026-10-16T10:00:00-03:00", location: "Sala 2" });
  createReminder(F, "Pagar boleto", "2026-10-16T14:00:00-03:00");
  const out = runAgendaReport(F, { date: "2026-10-16" }, THU, "https://painel.test");
  assert.equal(out.text, "📅 Agenda — amanhã (sex 16/10)\n\n• 09:00–10:00 Reunião · Sala 2\n• ⏰ 14:00 Pagar boleto");
  assert.equal(runAgendaReport(F, { date: "2026-10-16", scope: "events" }, THU).text, "📅 Eventos — amanhã (sex 16/10)\n\n• 09:00–10:00 Reunião · Sala 2");
  assert.equal(runAgendaReport(F, { date: "2026-10-16", scope: "reminders" }, THU).text, "⏰ Lembretes — amanhã (sex 16/10)\n\n• ⏰ 14:00 Pagar boleto");
  assert.equal(runAgendaReport(F, { date: "2026-10-18", scope: "reminders" }, THU).text, "⏰ Lembretes — dia 18/10 (dom)\n\nNenhum lembrete.");
  assert.equal(runAgendaReport(F, { date: "2026-10-18" }, THU).text, "📅 Agenda — dia 18/10 (dom)\n\nNada agendado.");
  assert.equal(runAgendaReport(F, { date: "lixo" }, THU).text, INVALID_AGENDA_DATE_TEXT);

  const G = "551100071607";
  for (let i = 1; i <= 16; i++) createReminder(G, `Lembrete ${i}`, `2026-10-${String(15 + Math.floor(i / 4)).padStart(2, "0")}T${String(10 + (i % 4)).padStart(2, "0")}:00:00-03:00`);
  const next = runListReminders(G, false, THU, "https://painel.test");
  assert.match(next.text, /^⏰ Lembretes — próximos 10\n\n/);
  assert.equal(next.text.split("\n").filter((l) => l.startsWith("• ")).length, 10);
  assert.ok(next.text.endsWith('…e mais 6. Diga "todos os meus lembretes" pra ver tudo.'));
  const everything = runListReminders(G, true, THU, "https://painel.test");
  assert.match(everything.text, /^⏰ Lembretes — todos\n\n/);
  assert.equal(everything.text.split("\n").filter((l) => l.startsWith("• ")).length, 16);
  assert.ok(!everything.text.includes("Veja tudo no painel"));
  assert.equal(runListReminders("551100071699", false, THU).text, "⏰ Lembretes — próximos 10\n\nNenhum lembrete.");

  const H = "551100071608";
  for (let i = 0; i < 35; i++) createReminder(H, `Item ${i}`, `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T09:${String(i).padStart(2, "0")}:00-03:00`);
  const capped = runListReminders(H, true, THU, "https://painel.test");
  assert.equal(capped.text.split("\n").filter((l) => l.startsWith("• ")).length, 30);
  assert.ok(capped.text.endsWith("…e mais 5 itens. Veja tudo no painel: https://painel.test"));
});
