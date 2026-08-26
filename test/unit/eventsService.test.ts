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

test("findUpcomingEvents busca por titulo, so no numero certo e nos proximos 60 dias", () => {
  createEvent({ fromNumber: A, title: "Reuniao com cliente importante", start: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() });
  createEvent({ fromNumber: B, title: "Reuniao com cliente importante", start: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() });

  const matches = findUpcomingEvents(A, "cliente");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].from_number, A);
});

test("getDueEventReminders so traz o que passou do horario de aviso e ainda nao foi avisado", () => {
  createEvent({ fromNumber: A, title: "Aviso ja deveria ter saido", start: "2020-01-01T00:00:00-03:00", reminderMinutes: 60 });
  createEvent({ fromNumber: A, title: "Aviso ainda nao chegou", start: "2099-01-01T00:00:00-03:00", reminderMinutes: 60 });
  const due = getDueEventReminders();
  const titles = due.map((e) => e.title);
  assert.ok(titles.includes("Aviso ja deveria ter saido"));
  assert.ok(!titles.includes("Aviso ainda nao chegou"));
});
