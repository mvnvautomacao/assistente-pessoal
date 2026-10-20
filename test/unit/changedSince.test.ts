// Card 21, parte 3 (D-08): funcoes puras que dizem se o registro mudou desde a previa (so campos editaveis pelo usuario).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billChangedSince,
  billCurrentValue,
  changedWhileTalkingText,
  eventChangedSince,
  eventCurrentValue,
  recurringChangedSince,
  recurringCurrentValue,
  reminderChangedSince,
  reminderCurrentValue,
} from "../../src/confirmation/changedSince";

const event = { title: "Dentista", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00", location: null as string | null, reminderMinutes: 60 };

test("eventChangedSince: igual (inclusive mesmo instante em outro formato / local nulo x indefinido) = false; cada campo muda = true", () => {
  assert.equal(eventChangedSince({ ...event }, event), false);
  assert.equal(eventChangedSince({ ...event, start: "2026-10-20T13:00:00Z" }, event), false, "mesmo instante");
  assert.equal(eventChangedSince({ ...event, location: undefined as unknown as null }, event), false);
  assert.equal(eventChangedSince({ ...event, title: "Outro" }, event), true);
  assert.equal(eventChangedSince({ ...event, start: "2026-10-20T11:00:00-03:00" }, event), true);
  assert.equal(eventChangedSince({ ...event, end: "2026-10-20T12:00:00-03:00" }, event), true);
  assert.equal(eventChangedSince({ ...event, location: "Clinica" }, event), true);
  assert.equal(eventChangedSince({ ...event, reminderMinutes: 30 }, event), true);
  assert.equal(eventCurrentValue(event), "ter 20/10 às 10:00");
});

test("reminderChangedSince: texto ou instante", () => {
  const base = { message: "Pagar", dueAt: "2026-10-20T10:00:00-03:00" };
  assert.equal(reminderChangedSince({ ...base, dueAt: "2026-10-20T13:00:00.000Z" }, base), false);
  assert.equal(reminderChangedSince({ ...base, message: "Pagar luz" }, base), true);
  assert.equal(reminderChangedSince({ ...base, dueAt: "2026-10-21T10:00:00-03:00" }, base), true);
  assert.equal(reminderCurrentValue(base), "ter 20/10 às 10:00");
});

test("recurringChangedSince: cada campo editavel; texto do valor atual", () => {
  const base = { description: "Internet", amount: 100, categoryId: 1, paymentMethodId: null as number | null, dayOfMonth: 10 };
  assert.equal(recurringChangedSince({ ...base }, base), false);
  assert.equal(recurringChangedSince({ ...base, description: "Net" }, base), true);
  assert.equal(recurringChangedSince({ ...base, amount: 101 }, base), true);
  assert.equal(recurringChangedSince({ ...base, categoryId: 2 }, base), true);
  assert.equal(recurringChangedSince({ ...base, paymentMethodId: 3 }, base), true);
  assert.equal(recurringChangedSince({ ...base, dayOfMonth: 11 }, base), true);
  assert.equal(recurringCurrentValue({ ...base, amount: 1500.5 }), "R$ 1.500,50 todo dia 10");
});

test("billChangedSince: nome, recorrencia e proximo aviso (so no intervalo); dia do mes ignora nextDueDate", () => {
  const dia = { name: "Luz", recurrenceType: "day_of_month" as const, dayOfMonth: 7, intervalDays: null, nextDueDate: null as string | null };
  assert.equal(billChangedSince({ ...dia }, dia), false);
  assert.equal(billChangedSince({ ...dia, name: "Energia" }, dia), true);
  assert.equal(billChangedSince({ ...dia, dayOfMonth: 8 }, dia), true);
  assert.equal(billChangedSince({ ...dia, nextDueDate: "2026-11-07" }, dia), false);
  const intervalo = { name: "Racao", recurrenceType: "interval" as const, dayOfMonth: null, intervalDays: 45, nextDueDate: "2026-12-01" as string | null };
  assert.equal(billChangedSince({ ...intervalo }, intervalo), false);
  assert.equal(billChangedSince({ ...intervalo, nextDueDate: "2026-12-02" }, intervalo), true);
  assert.equal(billChangedSince({ ...intervalo, intervalDays: 30 }, intervalo), true);
  assert.equal(billChangedSince({ ...dia, recurrenceType: "interval", intervalDays: 7 }, dia), true);
  assert.equal(billCurrentValue(intervalo), "a cada 45 dias");
});

test("changedWhileTalkingText: texto exato do pedido", () => {
  assert.equal(
    changedWhileTalkingText("gasto fixo", "Internet", "R$ 150,00 todo dia 10"),
    'O gasto fixo "Internet" mudou enquanto a gente conversava (agora está R$ 150,00 todo dia 10). Me pede a alteração de novo.'
  );
});
