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

test("updateEvent reseta reminder_sent=0 (reagenda o aviso se o evento mudou de horario)", () => {
  const event = createEvent({ fromNumber: A, title: "Reagendar", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 1 });
  const due = getDueEventReminders().find((e) => e.id === event.id)!;
  markEventReminderSent(due.id);
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
