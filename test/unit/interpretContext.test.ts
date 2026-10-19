import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../src/ai/interpret";
import { setLastShownExpenses, clearLastShownExpenses } from "../../src/expenses/listCache";
import { ensureUserSeeded, insertExpense, getOrCreateCategory } from "../../src/expenses/service";

const A = "551100140001";
const B = "551100140002";

// Achado real: "muda valor de 1 para 10,49" logo depois do bot mostrar a lista
// de gastos virou "nao entendido" -- a IA classifica cada mensagem sozinha e nao
// sabia que existia uma lista aberta. O prompt agora leva essa lista.
test("com lista de gastos aberta, o prompt da IA inclui a lista numerada e a regra do list_ref", () => {
  ensureUserSeeded(A);
  const cat = getOrCreateCategory(A, "Lazer");
  const e1 = insertExpense({ fromNumber: A, amount: 10.5, description: "chocolate acai", categoryId: cat.id, paymentMethodId: null, date: "2026-10-08" });
  const e2 = insertExpense({ fromNumber: A, amount: 7, description: "milho", categoryId: cat.id, paymentMethodId: null, date: "2026-10-08" });
  setLastShownExpenses(A, [e1.id, e2.id], "hoje");

  const prompt = buildSystemPrompt(A);
  assert.match(prompt, /CONTEXTO DA CONVERSA/);
  assert.match(prompt, /1\. R\$10\.50 — chocolate acai/);
  assert.match(prompt, /2\. R\$7\.00 — milho/);
  assert.match(prompt, /list_ref/);
  assert.match(prompt, /muda valor de 1 para 10,49/);
});

test("sem lista aberta (ou lista de outro numero, ou limpa), o prompt NAO inclui o contexto", () => {
  ensureUserSeeded(B);
  assert.doesNotMatch(buildSystemPrompt(B), /CONTEXTO DA CONVERSA/); // B nunca viu lista (isolamento entre numeros)

  clearLastShownExpenses(A);
  assert.doesNotMatch(buildSystemPrompt(A), /CONTEXTO DA CONVERSA/);
});

// Card 20: a ultima lista pode ser a AGENDA; a IA recebe o numero, o tipo e o horario de cada item
test("com a agenda numerada aberta, o prompt traz a lista (evento / lembrete / ja tocou) e a regra de qual acao usar; a lista de gastos depois a substitui", async () => {
  const { createEvent } = await import("../../src/events/service");
  const { createReminder, markReminderSent } = await import("../../src/reminders/service");
  const { setLastShownAgenda } = await import("../../src/lists/lastShown");
  const C = "551100140003";
  ensureUserSeeded(C);
  const event = createEvent({ fromNumber: C, title: "Dentista", start: "2026-10-19T16:30:00-03:00", end: "2026-10-19T17:30:00-03:00" });
  const boleto = createReminder(C, "Pagar boleto", "2026-10-19T14:00:00-03:00");
  const remedio = createReminder(C, "Remédio", "2026-10-19T07:00:00-03:00");
  markReminderSent(C, remedio);
  setLastShownAgenda(C, [
    { kind: "reminder", id: remedio },
    { kind: "reminder", id: boleto },
    { kind: "event", id: event.id },
    { kind: "event", id: 999999 }, // sumiu: nao entra
  ]);
  const prompt = buildSystemPrompt(C);
  assert.match(prompt, /CONTEXTO DA CONVERSA: o usuario acabou de ver esta lista numerada da AGENDA/);
  assert.match(prompt, /1\. lembrete \(ja tocou\): Remédio \(2026-10-19 07:00\)/);
  assert.match(prompt, /2\. lembrete: Pagar boleto \(2026-10-19 14:00\)/);
  assert.match(prompt, /3\. evento: Dentista \(2026-10-19 16:30\)/);
  assert.doesNotMatch(prompt, /4\. evento/);
  assert.match(prompt, /EVENTO = edit_event, delete_event, add_event_reminder ou remove_event_reminder; LEMBRETE = edit_reminder, delete_reminder ou snooze_reminder/);
  assert.match(prompt, /cancela o 3/);
  assert.doesNotMatch(buildSystemPrompt(B), /AGENDA/, "outro numero nao ve a lista");

  const cat = getOrCreateCategory(C, "Lazer");
  const e = insertExpense({ fromNumber: C, amount: 5, description: "pastel", categoryId: cat.id, paymentMethodId: null, date: "2026-10-19" });
  setLastShownExpenses(C, [e.id], "hoje");
  const afterExpenses = buildSystemPrompt(C);
  assert.doesNotMatch(afterExpenses, /lista numerada da AGENDA/);
  assert.match(afterExpenses, /1\. R\$5\.00 — pastel/);
});
