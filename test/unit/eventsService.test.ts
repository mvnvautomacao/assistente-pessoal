import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEventReminderMinutes,
  setEventReminderMinutes,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
  listUpcomingEvents,
  findUpcomingEvents,
  getDueEventReminders,
  markEventReminderSent,
  getEventsForMonth,
  formatMinutesBefore,
  listEventReminderMinutes,
  addEventExtraReminder,
  removeEventReminder,
  getDueExtraEventReminders,
  getSkippedEventReminders,
  findEditableEvents,
  listEditableEvents,
  markEventExtraReminderSent,
  MAX_REMINDERS_PER_EVENT,
} from "../../src/events/service";
import { db } from "../../src/db";

const A = "551100040001";
const B = "551100040002";

// "agora" injetado: 30 min antes de 2020-01-01 00:00 -03:00 (o aviso de 60 min ja venceu e o evento ainda nao comecou)
const BEFORE_2020 = new Date("2019-12-31T23:30:00-03:00");
// 30 s antes do inicio (para eventos com aviso de 1 minuto)
const NEAR_2020 = new Date("2019-12-31T23:59:30-03:00");
const BEFORE_2020_FEB = new Date("2020-01-31T23:30:00-03:00");

test("getEventReminderMinutes tem padrao de 60 antes de qualquer configuracao", () => {
  assert.equal(getEventReminderMinutes("551100040099"), 60);
});

test("setEventReminderMinutes muda o padrao desse numero, sem afetar outro", () => {
  setEventReminderMinutes(A, 15);
  assert.equal(getEventReminderMinutes(A), 15);
  assert.equal(getEventReminderMinutes(B), 60);
});

test("createEvent usa o padrao do usuario quando reminderMinutes nao e passado", () => {
  setEventReminderMinutes(A, 30);
  const event = createEvent({ fromNumber: A, title: "Reuniao", start: "2099-06-01T10:00:00-03:00" });
  assert.equal(event.reminder_minutes, 30);
});

test("createEvent sem 'end' cai pra 1h depois do inicio", () => {
  const event = createEvent({ fromNumber: A, title: "Dentista", start: "2099-06-02T09:00:00-03:00" });
  const startMs = new Date(event.start).getTime();
  const endMs = new Date(event.end).getTime();
  assert.equal(endMs - startMs, 60 * 60 * 1000);
});

test("getEventById/updateEvent/deleteEvent respeitam o dono", () => {
  const event = createEvent({ fromNumber: A, title: "Evento do A", start: "2099-06-03T09:00:00-03:00" });

  assert.equal(getEventById(B, event.id), undefined);
  updateEvent(B, event.id, { title: "hackeado", start: "2000-01-01T00:00:00-03:00", reminderMinutes: 5 });
  assert.equal(getEventById(A, event.id)!.title, "Evento do A");

  deleteEvent(B, event.id); // B tentando excluir evento de A: nao deve afetar nada
  assert.ok(getEventById(A, event.id));

  updateEvent(A, event.id, { title: "Evento renomeado", start: "2099-06-03T11:00:00-03:00", reminderMinutes: 20 });
  const updated = getEventById(A, event.id)!;
  assert.equal(updated.title, "Evento renomeado");
  assert.equal(updated.reminder_minutes, 20);

  deleteEvent(A, event.id);
  assert.equal(getEventById(A, event.id), undefined);
});

test("SEGURANCA: markEventReminderSent nunca alcanca evento de outro numero", () => {
  const event = createEvent({ fromNumber: A, title: "Protegido de B", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 1 });
  const due = getDueEventReminders(NEAR_2020).find((e) => e.id === event.id)!;
  markEventReminderSent(B, due.id);
  assert.equal(getEventById(A, event.id)!.reminder_sent, 0); // continua sem marcar
});

test("updateEvent reseta reminder_sent=0 (reagenda o aviso se o evento mudou de horario)", () => {
  const event = createEvent({ fromNumber: A, title: "Reagendar", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 1 });
  const due = getDueEventReminders(NEAR_2020).find((e) => e.id === event.id)!;
  markEventReminderSent(A, due.id);
  assert.equal(getEventById(A, event.id)!.reminder_sent, 1);

  updateEvent(A, event.id, { title: "Reagendar", start: "2099-01-01T00:00:00-03:00", reminderMinutes: 1 });
  assert.equal(getEventById(A, event.id)!.reminder_sent, 0);
});

test("listUpcomingEvents so traz eventos futuros, dentro da janela e do numero certo", () => {
  createEvent({ fromNumber: A, title: "Passado", start: "2000-01-01T00:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Daqui 2 dias", start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() });
  createEvent({ fromNumber: A, title: "Daqui 60 dias", start: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() });
  createEvent({ fromNumber: B, title: "Evento do B", start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() });

  const upcoming = listUpcomingEvents(A, 5);
  const titles = upcoming.map((e) => e.title);
  assert.ok(titles.includes("Daqui 2 dias"));
  assert.ok(!titles.includes("Passado"));
  assert.ok(!titles.includes("Daqui 60 dias"));
  assert.ok(!titles.includes("Evento do B"));
});

test("findUpcomingEvents busca por titulo, so no numero certo, sem limite de dias a frente", () => {
  createEvent({ fromNumber: A, title: "Reuniao com cliente importante", start: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() });
  createEvent({ fromNumber: B, title: "Reuniao com cliente importante", start: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() });

  const matches = findUpcomingEvents(A, "cliente");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].from_number, A);
});

// Regressao: um evento criado (por erro da IA ou de proposito) mais de 60 dias
// no futuro tinha que continuar achavel pra cancelar/remarcar -- um teto
// artificial aqui travava justamente o caso de corrigir esse tipo de erro
// (relatado em producao: consulta marcada sem querer pra daqui 66 dias, e
// "muda a consulta pra outro dia" respondia "nao encontrei nenhum evento").
test("findUpcomingEvents acha evento bem no futuro (mais de 60 dias), mas nao acha evento passado", () => {
  createEvent({ fromNumber: A, title: "Consulta daqui a 6 meses", start: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString() });
  createEvent({ fromNumber: A, title: "Consulta que ja passou", start: "2000-01-01T00:00:00-03:00" });

  const matches = findUpcomingEvents(A, "consulta");
  const titles = matches.map((e) => e.title);
  assert.ok(titles.includes("Consulta daqui a 6 meses"));
  assert.ok(!titles.includes("Consulta que ja passou"));
});

test("getDueEventReminders so traz o que passou do horario de aviso e ainda nao foi avisado", () => {
  createEvent({ fromNumber: A, title: "Aviso ja deveria ter saido", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 60 });
  createEvent({ fromNumber: A, title: "Aviso ainda nao chegou", start: "2099-01-01T00:00:00-03:00", reminderMinutes: 60 });
  const due = getDueEventReminders(BEFORE_2020);
  const titles = due.map((e) => e.title);
  assert.ok(titles.includes("Aviso ja deveria ter saido"));
  assert.ok(!titles.includes("Aviso ainda nao chegou"));
});

test("getEventsForMonth so traz eventos daquele mes, isolado por numero", () => {
  createEvent({ fromNumber: A, title: "Dentro do mes", start: "2031-06-15T10:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Mes anterior", start: "2031-05-31T23:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Mes seguinte", start: "2031-07-01T00:00:00-03:00" });
  createEvent({ fromNumber: B, title: "De outro numero", start: "2031-06-10T10:00:00-03:00" });

  const titles = getEventsForMonth(A, "2031-06").map((e) => e.title);
  assert.deepEqual(titles, ["Dentro do mes"]);
});

test("getEventsForMonth pega eventos exatamente no primeiro e no ultimo instante do mes", () => {
  createEvent({ fromNumber: A, title: "Bem no inicio do mes", start: "2032-03-01T00:00:00-03:00" });
  createEvent({ fromNumber: A, title: "Quase no fim do mes", start: "2032-03-31T23:59:00-03:00" });

  const titles = getEventsForMonth(A, "2032-03").map((e) => e.title);
  assert.ok(titles.includes("Bem no inicio do mes"));
  assert.ok(titles.includes("Quase no fim do mes"));
});

test("formatMinutesBefore mostra dias/horas por extenso em vez de minutos crus", () => {
  assert.equal(formatMinutesBefore(0), "na hora");
  assert.equal(formatMinutesBefore(30), "30 min");
  assert.equal(formatMinutesBefore(60), "1 hora");
  assert.equal(formatMinutesBefore(120), "2 horas");
  assert.equal(formatMinutesBefore(90), "1h30");
  assert.equal(formatMinutesBefore(1440), "1 dia");
  assert.equal(formatMinutesBefore(2880), "2 dias");
});

// Pedido do usuario: um evento pode ter ate 3 avisos (principal + 2 extras),
// em qualquer combinacao de minutos/horas/dias.
test("addEventExtraReminder/listEventReminderMinutes: acumula ate o maximo, rejeita duplicado e 4o alerta", () => {
  const event = createEvent({ fromNumber: A, title: "Consulta com varios avisos", start: "2099-08-01T15:00:00-03:00", reminderMinutes: 60 });
  assert.deepEqual(listEventReminderMinutes(A, event.id), [60]);

  assert.deepEqual(addEventExtraReminder(A, event.id, 1440), { ok: true }); // 1 dia antes
  assert.deepEqual(listEventReminderMinutes(A, event.id), [1440, 60]);

  assert.deepEqual(addEventExtraReminder(A, event.id, 120), { ok: true }); // 2 horas antes
  assert.deepEqual(listEventReminderMinutes(A, event.id), [1440, 120, 60]);
  assert.equal(listEventReminderMinutes(A, event.id).length, MAX_REMINDERS_PER_EVENT);

  assert.deepEqual(addEventExtraReminder(A, event.id, 30), { ok: false, reason: "max_reached" });
  assert.deepEqual(addEventExtraReminder(A, event.id, 60), { ok: false, reason: "duplicate" }); // ja tem 60
  assert.deepEqual(addEventExtraReminder(A, 999999, 30), { ok: false, reason: "not_found" });
});

test("removeEventReminder: remove um extra sem afetar os outros, e promove um extra se remover o principal", () => {
  const event = createEvent({ fromNumber: A, title: "Reuniao com avisos", start: "2099-08-02T10:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, event.id, 1440);
  addEventExtraReminder(A, event.id, 120);

  assert.deepEqual(removeEventReminder(A, event.id, 120), { ok: true });
  assert.deepEqual(listEventReminderMinutes(A, event.id), [1440, 60]);

  // remover o PRINCIPAL (60) promove o extra restante (1440) a novo principal
  assert.deepEqual(removeEventReminder(A, event.id, 60), { ok: true });
  assert.deepEqual(listEventReminderMinutes(A, event.id), [1440]);
  assert.equal(getEventById(A, event.id)!.reminder_minutes, 1440);

  // so resta 1 -- nao pode remover o ultimo
  assert.deepEqual(removeEventReminder(A, event.id, 1440), { ok: false, reason: "last_one" });
  assert.deepEqual(removeEventReminder(A, event.id, 9999), { ok: false, reason: "not_found" });
});

test("SEGURANCA: addEventExtraReminder/removeEventReminder nunca alcancam evento de outro numero", () => {
  const event = createEvent({ fromNumber: A, title: "So do A", start: "2099-08-03T10:00:00-03:00", reminderMinutes: 60 });
  assert.deepEqual(addEventExtraReminder(B, event.id, 120), { ok: false, reason: "not_found" });
  assert.equal(listEventReminderMinutes(A, event.id).length, 1);

  addEventExtraReminder(A, event.id, 120);
  assert.deepEqual(removeEventReminder(B, event.id, 120), { ok: false, reason: "not_found" });
  assert.equal(listEventReminderMinutes(A, event.id).length, 2); // continua intacto
});

test("deleteEvent apaga tambem os alertas extras (nao deixa orfao), e so afeta evento do dono certo", () => {
  const event = createEvent({ fromNumber: A, title: "Vai ser apagado", start: "2099-08-04T10:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, event.id, 1440);

  deleteEvent(B, event.id); // B tentando apagar evento de A: nao deve afetar nada
  assert.equal(listEventReminderMinutes(A, event.id).length, 2);

  deleteEvent(A, event.id);
  assert.equal(getEventById(A, event.id), undefined);
  assert.equal(listEventReminderMinutes(A, event.id).length, 0);
});

test("getDueExtraEventReminders/markEventExtraReminderSent: so traz o que venceu e ainda nao foi avisado", () => {
  const past = createEvent({ fromNumber: A, title: "Extra ja deveria ter avisado", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, past.id, 30);
  const future = createEvent({ fromNumber: A, title: "Extra ainda nao chegou", start: "2099-01-01T00:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, future.id, 30);

  const due = getDueExtraEventReminders(BEFORE_2020);
  const dueForPast = due.find((d) => d.eventId === past.id);
  assert.ok(dueForPast);
  assert.equal(dueForPast!.minutesBefore, 30);
  assert.ok(!due.some((d) => d.eventId === future.id));

  markEventExtraReminderSent(dueForPast!.id);
  assert.ok(!getDueExtraEventReminders(BEFORE_2020).some((d) => d.eventId === past.id)); // nao avisa 2x
});

test("updateEvent reagenda tambem os alertas extras (sent volta a 0) quando o evento muda de horario", () => {
  const event = createEvent({ fromNumber: A, title: "Extra a reagendar", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, event.id, 30);
  const due = getDueExtraEventReminders(BEFORE_2020).find((d) => d.eventId === event.id)!;
  markEventExtraReminderSent(due.id);
  assert.ok(!getDueExtraEventReminders(BEFORE_2020).some((d) => d.eventId === event.id));

  updateEvent(A, event.id, { title: "Extra a reagendar", start: "2020-02-01T00:00:00-03:00", reminderMinutes: 60 });
  // novo start ja passou tambem (ainda no passado), entao volta a estar devido
  assert.ok(getDueExtraEventReminders(BEFORE_2020_FEB).some((d) => d.eventId === event.id));
});

// ---- Card 10: janela do aviso e busca de eventos editaveis (relogio injetado) ----------------

const C = "551100040010";
const sp = (iso: string) => new Date(iso);

test("Card 10: antecedencia 0 -- avisa no minuto do inicio (14:00:30) e uma unica vez", () => {
  const event = createEvent({ fromNumber: C, title: "Antecedencia zero", start: "2030-03-01T14:00:00-03:00", reminderMinutes: 0 });
  assert.ok(!getDueEventReminders(sp("2030-03-01T13:59:30-03:00")).some((e) => e.id === event.id), "antes do inicio ainda nao");
  assert.ok(getDueEventReminders(sp("2030-03-01T14:00:30-03:00")).some((e) => e.id === event.id), "no minuto do inicio avisa");
  markEventReminderSent(C, event.id);
  assert.ok(!getDueEventReminders(sp("2030-03-01T14:01:30-03:00")).some((e) => e.id === event.id), "depois de enviado nao repete");
});

test("Card 10: tolerancia de 5 min depois do inicio (14:03 avisa, 14:10 nao) e o aviso ignorado nao e gravado", () => {
  const event = createEvent({ fromNumber: C, title: "Tolerancia aviso", start: "2030-03-02T14:00:00-03:00", reminderMinutes: 30 });
  assert.ok(getDueEventReminders(sp("2030-03-02T14:03:00-03:00")).some((e) => e.id === event.id));
  assert.ok(getDueEventReminders(sp("2030-03-02T14:05:00-03:00")).some((e) => e.id === event.id), "limite: 5 min exatos ainda vale");
  assert.ok(!getDueEventReminders(sp("2030-03-02T14:10:00-03:00")).some((e) => e.id === event.id));
  // so a consulta filtra: nada e gravado (reminder_sent continua 0)
  assert.equal(getEventById(C, event.id)?.reminder_sent, 0);
});

test("Card 10: evento que ja comecou ha 10 min nunca dispara (remarcado pro passado)", () => {
  const event = createEvent({ fromNumber: C, title: "Remarcado pro passado", start: "2030-03-03T14:00:00-03:00", reminderMinutes: 60 });
  markEventReminderSent(C, event.id);
  updateEvent(C, event.id, { title: "Remarcado pro passado", start: "2030-03-03T13:50:00-03:00", reminderMinutes: 60 });
  assert.equal(getEventById(C, event.id)?.reminder_sent, 0, "remarcar o inicio continua reativando o aviso (RN10)");
  assert.ok(!getDueEventReminders(sp("2030-03-03T14:00:00-03:00")).some((e) => e.id === event.id), "ja comecou ha 10 min");
});

test("Card 10: remarcar pro FUTURO preserva o comportamento -- reativa o aviso e ele vence na hora certa", () => {
  const event = createEvent({ fromNumber: C, title: "Remarcado pro futuro", start: "2030-03-04T09:00:00-03:00", reminderMinutes: 60 });
  markEventReminderSent(C, event.id);
  updateEvent(C, event.id, { title: "Remarcado pro futuro", start: "2030-03-05T09:00:00-03:00", reminderMinutes: 60 });
  assert.equal(getEventById(C, event.id)?.reminder_sent, 0);
  assert.ok(!getDueEventReminders(sp("2030-03-05T07:59:00-03:00")).some((e) => e.id === event.id), "antes da antecedencia");
  assert.ok(getDueEventReminders(sp("2030-03-05T08:00:30-03:00")).some((e) => e.id === event.id), "na antecedencia");
});

test("Card 10: alertas extras tem a mesma janela (tolerancia de 5 min) e nao disparam em evento que ja passou", () => {
  const event = createEvent({ fromNumber: C, title: "Extra janela", start: "2030-03-06T14:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(C, event.id, 15);
  const dueAt = (iso: string) => getDueExtraEventReminders(sp(iso)).some((d) => d.eventId === event.id);
  assert.ok(!dueAt("2030-03-06T13:44:00-03:00"));
  assert.ok(dueAt("2030-03-06T13:46:00-03:00"));
  assert.ok(dueAt("2030-03-06T14:04:00-03:00"));
  assert.ok(!dueAt("2030-03-06T14:10:00-03:00"));
});

test("Card 10: getSkippedEventReminders -- so avisos ignorados (passou da tolerancia, ate 24 h) e nao enviados", () => {
  const skipped = createEvent({ fromNumber: C, title: "Aviso ignorado", start: "2030-03-07T14:00:00-03:00", reminderMinutes: 60 });
  const sent = createEvent({ fromNumber: C, title: "Aviso ja enviado", start: "2030-03-07T14:00:00-03:00", reminderMinutes: 60 });
  markEventReminderSent(C, sent.id);
  const ids = (iso: string) => getSkippedEventReminders(sp(iso)).map((e) => e.id);
  assert.ok(!ids("2030-03-07T14:04:00-03:00").includes(skipped.id), "dentro da tolerancia ainda e devido, nao ignorado");
  assert.ok(ids("2030-03-07T14:10:00-03:00").includes(skipped.id));
  assert.ok(!ids("2030-03-07T14:10:00-03:00").includes(sent.id), "ja enviado nunca e ignorado");
  assert.ok(!ids("2030-03-08T15:00:00-03:00").includes(skipped.id), "depois de 24 h nao entra mais no log");
});

test("Card 10: findEditableEvents -- futuro, em andamento e terminado ha menos de 2 h; terminado ha mais, nao", () => {
  const D = "551100040011";
  const now = sp("2030-04-01T15:00:00-03:00");
  const future = createEvent({ fromNumber: D, title: "Reuniao futura", start: "2030-04-02T10:00:00-03:00", end: "2030-04-02T11:00:00-03:00" });
  const ongoing = createEvent({ fromNumber: D, title: "Reuniao andamento", start: "2030-04-01T14:30:00-03:00", end: "2030-04-01T15:30:00-03:00" });
  const justEnded = createEvent({ fromNumber: D, title: "Reuniao terminou", start: "2030-04-01T12:00:00-03:00", end: "2030-04-01T13:30:00-03:00" });
  createEvent({ fromNumber: D, title: "Reuniao antiga", start: "2030-04-01T09:00:00-03:00", end: "2030-04-01T10:00:00-03:00" });
  const found = findEditableEvents(D, "reuniao", now).map((e) => e.id);
  // mais cedo primeiro; a "antiga" terminou ha 5 h e fica de fora
  assert.deepEqual(found, [justEnded.id, ongoing.id, future.id]);
});

test("Card 10: findEditableEvents -- limite de 2 h exato, sem 'end' gravado (1 h padrao), outro numero e texto", () => {
  const D = "551100040012";
  const now = sp("2030-04-01T15:00:00-03:00");
  // termina exatamente 13:00 (2 h antes de "agora") => ainda entra
  const edge = createEvent({ fromNumber: D, title: "Limite exato", start: "2030-04-01T12:00:00-03:00", end: "2030-04-01T13:00:00-03:00" });
  const justPast = createEvent({ fromNumber: D, title: "Limite passou", start: "2030-04-01T11:59:00-03:00", end: "2030-04-01T12:59:00-03:00" });
  // sem termino gravado ("end" vazio): termino efetivo = inicio + 1 h
  const noEnd = createEvent({ fromNumber: D, title: "Sem termino", start: "2030-04-01T14:30:00-03:00" });
  db.prepare(`UPDATE events SET end = '' WHERE id = ?`).run(noEnd.id);
  const noEndOld = createEvent({ fromNumber: D, title: "Sem termino antigo", start: "2030-04-01T11:00:00-03:00" });
  db.prepare(`UPDATE events SET end = '' WHERE id = ?`).run(noEndOld.id);
  const ids = findEditableEvents(D, "", now).map((e) => e.id);
  assert.ok(ids.includes(edge.id), "terminou exatamente ha 2 h: entra");
  assert.ok(!ids.includes(justPast.id), "terminou ha 2 h e 1 min: nao entra");
  assert.ok(ids.includes(noEnd.id), "sem termino, comecou ha 30 min: em andamento");
  assert.ok(!ids.includes(noEndOld.id), "sem termino, comecou ha 4 h: terminou ha 3 h");
  assert.deepEqual(findEditableEvents("551100040099", "", now), [], "outro numero nao ve");
  assert.deepEqual(findEditableEvents(D, "naoexiste", now), []);
});

test("Card 10: findEditableEvents -- maximo de 10 resultados; listEditableEvents -- ate 90 dias, ordenado, com limite", () => {
  const D = "551100040013";
  const now = sp("2030-05-01T09:00:00-03:00");
  for (let i = 0; i < 12; i++) {
    const day = `2030-05-0${(i % 9) + 1}`;
    createEvent({ fromNumber: D, title: `Serie ${i}`, start: `${day}T1${i % 10}:00:00-03:00`, end: `${day}T1${i % 10}:30:00-03:00` });
  }
  assert.equal(findEditableEvents(D, "serie", now).length, 10);

  const E = "551100040014";
  const near = createEvent({ fromNumber: E, title: "Perto", start: "2030-05-10T10:00:00-03:00" });
  const edge90 = createEvent({ fromNumber: E, title: "Dia 90", start: "2030-07-30T09:00:00-03:00" });
  const beyond = createEvent({ fromNumber: E, title: "Depois de 90", start: "2030-08-05T10:00:00-03:00" });
  const ongoing = createEvent({ fromNumber: E, title: "Agora", start: "2030-05-01T08:30:00-03:00", end: "2030-05-01T09:30:00-03:00" });
  const ids = listEditableEvents(E, now).map((e) => e.id);
  assert.deepEqual(ids, [ongoing.id, near.id, edge90.id]);
  assert.ok(!ids.includes(beyond.id));
  assert.deepEqual(listEditableEvents(E, now, 2).map((e) => e.id), [ongoing.id, near.id]);
});

test("Card 10: findUpcomingEvents/listUpcomingEvents continuam so com eventos futuros (nao entram os em andamento)", () => {
  const F = "551100040015";
  const ongoing = createEvent({
    fromNumber: F,
    title: "Em andamento util",
    start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  const future = createEvent({ fromNumber: F, title: "Futuro util", start: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
  assert.deepEqual(findUpcomingEvents(F, "util").map((e) => e.id), [future.id]);
  assert.deepEqual(listUpcomingEvents(F, 7).map((e) => e.id), [future.id]);
  assert.ok(findEditableEvents(F, "util").some((e) => e.id === ongoing.id), "o editavel enxerga o em andamento");
});
