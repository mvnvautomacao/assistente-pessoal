// Card 21, parte 3 (D-08, RN13): ao confirmar a previa de edicao de evento, lembrete, gasto fixo ou alerta de conta fixa, o registro atual
// e comparado com o `previous` da previa. Mudou no meio da conversa -> nada e aplicado e o usuario e avisado (molde do gasto/entrada).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createEvent, getEventById, updateEvent } from "../../src/events/service";
import { createReminder, getReminderById, updateReminder, deleteReminder } from "../../src/reminders/service";
import { createRecurringExpense, getRecurringExpenseById, updateRecurringExpense } from "../../src/expenses/recurring";
import { createBillAlert, getBillAlertById, updateBillAlert } from "../../src/bills/service";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-15T10:00:00-03:00");

let seq = 0;
function user(): string {
  const n = `55110008700${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function ask(app: BotApp, n: string, text: string, action: Interpretation) {
  app.queueReply([action]);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

async function say(app: BotApp, n: string, text: string) {
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("D-08 evento: remarcado por outro caminho durante a previa -> avisa, nao aplica e mostra o horario atual", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Dentista mudou", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  assert.match(await ask(app, n, "remarca o dentista pras 15h", { type: "edit_event", query: "dentista mudou", new_time: "15:00" }), /^✏️ Dentista mudou/);
  updateEvent(n, ev.id, { title: "Dentista mudou", start: "2026-10-21T09:00:00-03:00", end: "2026-10-21T10:00:00-03:00", reminderMinutes: 60 });
  const reply = await say(app, n, "1");
  assert.equal(reply, 'O evento "Dentista mudou" mudou enquanto a gente conversava (agora está qua 21/10 às 09:00). Me pede a alteração de novo.');
  assert.equal(getEventById(n, ev.id)?.start, "2026-10-21T09:00:00-03:00", "nada foi aplicado em cima");
});

test("D-08 evento: sem mudanca no meio, confirma normalmente; evento apagado -> 'Não achei mais esse item.'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Dentista igual", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  await ask(app, n, "remarca o dentista pras 15h", { type: "edit_event", query: "dentista igual", new_time: "15:00" });
  assert.match(await say(app, n, "1"), /^✏️ "Dentista igual" alterado: de ter 20\/10 às 10:00 pra ter 20\/10 às 15:00/);
  assert.match(getEventById(n, ev.id)!.start, /T15:00/);

  const gone = createEvent({ fromNumber: n, title: "Evento some", start: "2026-10-22T10:00:00-03:00", end: "2026-10-22T11:00:00-03:00" });
  await ask(app, n, "remarca o evento some pras 15h", { type: "edit_event", query: "evento some", new_time: "15:00" });
  const { deleteEvent } = await import("../../src/events/service");
  deleteEvent(n, gone.id);
  assert.equal(await say(app, n, "1"), "Não achei mais esse item.");
});

test("D-08 lembrete: horario ou texto mudou durante a previa -> avisa e nao aplica; apagado -> 'Não achei mais esse item.'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const id = createReminder(n, "Pagar boleto mudou", "2026-10-20T10:00:00-03:00");
  assert.match(await ask(app, n, "muda o lembrete pra 16h", { type: "edit_reminder", query: "pagar boleto mudou", new_time: "16:00" }), /^✏️ Pagar boleto mudou/);
  updateReminder(n, id, { message: "Pagar boleto mudou", dueAt: "2026-10-22T08:00:00-03:00" });
  assert.equal(
    await say(app, n, "1"),
    'O lembrete "Pagar boleto mudou" mudou enquanto a gente conversava (agora está qui 22/10 às 08:00). Me pede a alteração de novo.'
  );
  assert.equal(getReminderById(n, id)?.due_at, "2026-10-22T08:00:00-03:00");

  const id2 = createReminder(n, "Texto antigo", "2026-10-20T10:00:00-03:00");
  await ask(app, n, "muda o lembrete pra 16h", { type: "edit_reminder", query: "texto antigo", new_time: "16:00" });
  updateReminder(n, id2, { message: "Texto novo", dueAt: "2026-10-20T10:00:00-03:00" });
  assert.match(await say(app, n, "1"), /^O lembrete "Texto novo" mudou enquanto a gente conversava/);

  const id3 = createReminder(n, "Lembrete some", "2026-10-20T10:00:00-03:00");
  await ask(app, n, "muda o lembrete pra 16h", { type: "edit_reminder", query: "lembrete some", new_time: "16:00" });
  deleteReminder(n, id3);
  assert.equal(await say(app, n, "1"), "Não achei mais esse item.");
});

test("D-08 gasto fixo: valor mudou durante a previa -> avisa com o valor atual e nao aplica; sem mudanca, confirma", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const fixo = createRecurringExpense({ fromNumber: n, description: "Internet mudou", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 10 });
  assert.match(await ask(app, n, "muda a internet pra 120", { type: "edit_recurring_expense", query: "internet mudou", new_amount: 120 }), /R\$ 100,00 → R\$ 120,00/);
  updateRecurringExpense(n, fixo.id, { amount: 150 });
  assert.equal(
    await say(app, n, "1"),
    'O gasto fixo "Internet mudou" mudou enquanto a gente conversava (agora está R$ 150,00 todo dia 10). Me pede a alteração de novo.'
  );
  assert.equal(getRecurringExpenseById(n, fixo.id)?.amount, 150);

  const ok = createRecurringExpense({ fromNumber: n, description: "Aluguel igual", amount: 900, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  await ask(app, n, "muda o aluguel pra 950", { type: "edit_recurring_expense", query: "aluguel igual", new_amount: 950 });
  assert.match(await say(app, n, "1"), /^✏️ Gasto fixo "Aluguel igual" alterado/);
  assert.equal(getRecurringExpenseById(n, ok.id)?.amount, 950);
});

test("D-08 alerta de conta fixa: dia mudou durante a previa -> avisa e nao aplica; sem mudanca, confirma", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Luz mudou", dayOfMonth: 7 });
  assert.match(await ask(app, n, "muda o alerta da luz pro dia 12", { type: "edit_bill_alert", query: "luz mudou", day_of_month: 12 }), /todo dia 7 → todo dia 12/);
  updateBillAlert(n, bill.id, { dayOfMonth: 20 });
  assert.equal(
    await say(app, n, "1"),
    'O alerta "Luz mudou" mudou enquanto a gente conversava (agora está todo dia 20). Me pede a alteração de novo.'
  );
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 20);

  const ok = createBillAlert({ fromNumber: n, name: "Agua igual", dayOfMonth: 8 });
  await ask(app, n, "muda o alerta da agua pro dia 12", { type: "edit_bill_alert", query: "agua igual", day_of_month: 12 });
  assert.match(await say(app, n, "1"), /^✏️ Alerta atualizado: "Agua igual"/);
  assert.equal(getBillAlertById(n, ok.id)?.day_of_month, 12);
});
