import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReminder,
  getDueReminders,
  markReminderSent,
  getRemindersWithinDays,
  listReminders,
  getReminderById,
  updateReminder,
  deleteReminder,
  getRemindersForMonth,
} from "../../src/reminders/service";

const A = "551100030001";
const B = "551100030002";

test("createReminder + listReminders: isolado por numero", () => {
  createReminder(A, "lembrete do A", "2099-01-01T10:00:00Z");
  createReminder(B, "lembrete do B", "2099-01-01T10:00:00Z");
  const listA = listReminders(A);
  assert.ok(listA.some((r) => r.message === "lembrete do A"));
  assert.ok(!listA.some((r) => r.message === "lembrete do B"));
});

test("getDueReminders so traz o que ja venceu e ainda nao foi enviado", () => {
  createReminder(A, "venceu ha muito tempo", "2020-01-01T00:00:00Z");
  createReminder(A, "vence so em 2099", "2099-01-01T00:00:00Z");
  const due = getDueReminders();
  assert.ok(due.some((r) => r.message === "venceu ha muito tempo"));
  assert.ok(!due.some((r) => r.message === "vence so em 2099"));
});

test("markReminderSent tira o lembrete da lista de pendentes", () => {
  createReminder(A, "marcar como enviado", "2020-06-01T00:00:00Z");
  const due = getDueReminders();
  const target = due.find((r) => r.message === "marcar como enviado")!;
  markReminderSent(target.id);
  const dueAgain = getDueReminders();
  assert.ok(!dueAgain.some((r) => r.id === target.id));
});

test("getRemindersWithinDays respeita o limite de dias, ignora ja enviados, e e isolado por numero", () => {
  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  createReminder(A, "dentro da janela", soon);
  createReminder(A, "fora da janela", far);
  createReminder(B, "dentro da janela de B", soon); // SEGURANCA: nao pode aparecer pra A
  const within = getRemindersWithinDays(A, 5);
  assert.ok(within.some((r) => r.message === "dentro da janela"));
  assert.ok(!within.some((r) => r.message === "fora da janela"));
  assert.ok(!within.some((r) => r.message === "dentro da janela de B"));
});

test("getReminderById/updateReminder/deleteExpense respeitam o dono (nao mexe em lembrete de outro numero)", () => {
  createReminder(A, "so do A", "2099-01-01T00:00:00Z");
  const reminders = listReminders(A);
  const target = reminders.find((r) => r.message === "so do A")!;

  assert.equal(getReminderById(B, target.id), undefined); // B nao enxerga o lembrete de A

  updateReminder(B, target.id, { message: "hackeado", dueAt: "2000-01-01T00:00:00Z" });
  const stillOriginal = getReminderById(A, target.id)!;
  assert.equal(stillOriginal.message, "so do A");

  deleteReminder(B, target.id);
  assert.ok(getReminderById(A, target.id)); // continua existindo

  updateReminder(A, target.id, { message: "atualizado de verdade", dueAt: "2030-01-01T00:00:00Z" });
  assert.equal(getReminderById(A, target.id)!.message, "atualizado de verdade");

  deleteReminder(A, target.id);
  assert.equal(getReminderById(A, target.id), undefined);
});

test("updateReminder reseta sent=0 (edita um ja enviado -> volta a avisar)", () => {
  createReminder(A, "editar apos enviado", "2020-01-01T00:00:00Z");
  const target = listReminders(A).find((r) => r.message === "editar apos enviado")!;
  markReminderSent(target.id);
  assert.equal(getReminderById(A, target.id)!.sent, 1);

  updateReminder(A, target.id, { message: "editar apos enviado", dueAt: "2099-01-01T00:00:00Z" });
  assert.equal(getReminderById(A, target.id)!.sent, 0);
});

test("getRemindersForMonth: so traz lembretes nao enviados daquele mes, isolado por numero", () => {
  createReminder(A, "lembrete de novembro", "2026-11-15T10:00:00-03:00");
  createReminder(A, "lembrete de dezembro", "2026-12-01T10:00:00-03:00");
  createReminder(B, "lembrete de novembro de B", "2026-11-20T10:00:00-03:00"); // SEGURANCA: nao pode aparecer pra A

  const novembroA = getRemindersForMonth(A, "2026-11");
  assert.equal(novembroA.length, 1);
  assert.equal(novembroA[0].message, "lembrete de novembro");

  const created = createReminder(A, "ja enviado em novembro", "2026-11-05T10:00:00-03:00");
  markReminderSent(created);
  assert.ok(!getRemindersForMonth(A, "2026-11").some((r) => r.message === "ja enviado em novembro"));
});
