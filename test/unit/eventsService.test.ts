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
  markEventExtraReminderSent,
  MAX_REMINDERS_PER_EVENT,
} from "../../src/events/service";

const A = "551100040001";
const B = "551100040002";

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
  const due = getDueEventReminders().find((e) => e.id === event.id)!;
  markEventReminderSent(B, due.id);
  assert.equal(getEventById(A, event.id)!.reminder_sent, 0); // continua sem marcar
});

test("updateEvent reseta reminder_sent=0 (reagenda o aviso se o evento mudou de horario)", () => {
  const event = createEvent({ fromNumber: A, title: "Reagendar", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 1 });
  const due = getDueEventReminders().find((e) => e.id === event.id)!;
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
  const due = getDueEventReminders();
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

  const due = getDueExtraEventReminders();
  const dueForPast = due.find((d) => d.eventId === past.id);
  assert.ok(dueForPast);
  assert.equal(dueForPast!.minutesBefore, 30);
  assert.ok(!due.some((d) => d.eventId === future.id));

  markEventExtraReminderSent(dueForPast!.id);
  assert.ok(!getDueExtraEventReminders().some((d) => d.eventId === past.id)); // nao avisa 2x
});

test("updateEvent reagenda tambem os alertas extras (sent volta a 0) quando o evento muda de horario", () => {
  const event = createEvent({ fromNumber: A, title: "Extra a reagendar", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 60 });
  addEventExtraReminder(A, event.id, 30);
  const due = getDueExtraEventReminders().find((d) => d.eventId === event.id)!;
  markEventExtraReminderSent(due.id);
  assert.ok(!getDueExtraEventReminders().some((d) => d.eventId === event.id));

  updateEvent(A, event.id, { title: "Extra a reagendar", start: "2020-02-01T00:00:00-03:00", reminderMinutes: 60 });
  // novo start ja passou tambem (ainda no passado), entao volta a estar devido
  assert.ok(getDueExtraEventReminders().some((d) => d.eventId === event.id));
});
