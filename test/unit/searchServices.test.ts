// Card 11 (D-06): as seis buscas por texto ignoram acento e caixa, tratam % e _ como texto
// comum, filtram por numero antes do texto e mantem ordem e limite de 10 DEPOIS do filtro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvent, findEditableEvents, findUpcomingEvents } from "../../src/events/service";
import { createReminder, findPendingRemindersByText, findRecentSentReminders, markReminderSent } from "../../src/reminders/service";
import { createBillAlert, findActiveBillAlertByName, deactivateBillAlert } from "../../src/bills/service";
import { createRecurringExpense, findActiveRecurringExpenseByDescription } from "../../src/expenses/recurring";
import { db } from "../../src/db";

const A = "551100110001";
const B = "551100110002";
const minutes = (m: number) => new Date(Date.now() + m * 60 * 1000).toISOString();

test("eventos (futuros): acento, caixa e palavras em qualquer ordem", () => {
  const medica = createEvent({ fromNumber: A, title: "Consulta médica", start: minutes(60 * 24) });
  const cliente = createEvent({ fromNumber: A, title: "Reunião com o cliente X", start: minutes(60 * 48) });
  const ids = (q: string) => findUpcomingEvents(A, q).map((e) => e.id);
  assert.deepEqual(ids("consulta medica"), [medica.id]);
  assert.deepEqual(ids("CONSULTA MÉDICA"), [medica.id]);
  assert.deepEqual(ids("reuniao cliente"), [cliente.id]);
  assert.deepEqual(ids("cliente reuniao"), [cliente.id]);
  assert.deepEqual(ids("o cliente"), [cliente.id], "artigo ignorado");
  assert.deepEqual(ids("naoexiste"), []);
  assert.deepEqual(ids("%"), [], "% nao e curinga");
  assert.deepEqual(ids("_"), [], "_ nao e curinga");
  assert.deepEqual(ids("").sort(), [medica.id, cliente.id].sort(), "sem texto = sem filtro, como antes");
});

test("eventos: titulo sem acento acha consulta com acento, e titulos so com numeros ou emoji", () => {
  const semAcento = createEvent({ fromNumber: A, title: "consulta medica sem acento", start: minutes(60 * 30) });
  const numeros = createEvent({ fromNumber: A, title: "2026", start: minutes(60 * 31) });
  const emoji = createEvent({ fromNumber: A, title: "🎂 Aniversário da Ana", start: minutes(60 * 32) });
  assert.ok(findUpcomingEvents(A, "médica").some((e) => e.id === semAcento.id));
  assert.deepEqual(findUpcomingEvents(A, "2026").map((e) => e.id), [numeros.id]);
  assert.deepEqual(findUpcomingEvents(A, "aniversario ana").map((e) => e.id), [emoji.id]);
});

test("eventos: isolamento por numero, passado fora dos futuros, em andamento dentro dos editaveis", () => {
  const other = createEvent({ fromNumber: B, title: "Segredo do outro número", start: minutes(60 * 24) });
  assert.deepEqual(findUpcomingEvents(A, "segredo"), []);
  assert.deepEqual(findEditableEvents(A, "segredo"), []);
  assert.deepEqual(findUpcomingEvents(B, "segredo").map((e) => e.id), [other.id]);

  const ongoing = createEvent({ fromNumber: A, title: "Reunião de acompanhamento", start: minutes(-30), end: minutes(30) });
  assert.ok(!findUpcomingEvents(A, "acompanhamento").some((e) => e.id === ongoing.id));
  assert.ok(findEditableEvents(A, "ACOMPANHAMENTO").some((e) => e.id === ongoing.id));
  createEvent({ fromNumber: A, title: "Reunião antiga demais", start: minutes(-60 * 24), end: minutes(-60 * 23) });
  assert.deepEqual(findEditableEvents(A, "antiga demais"), []);
});

test("eventos: mais de 10 acertos devolve os 10 primeiros na ordem do inicio", () => {
  const C = "551100110003";
  const created = Array.from({ length: 14 }, (_, i) => createEvent({ fromNumber: C, title: `Treino número ${i}`, start: minutes(60 * (i + 1)) }));
  createEvent({ fromNumber: C, title: "Outro assunto", start: minutes(30) });
  const expected = created.slice(0, 10).map((e) => e.id);
  assert.deepEqual(findUpcomingEvents(C, "treino numero").map((e) => e.id), expected);
  assert.deepEqual(findEditableEvents(C, "TREINO").map((e) => e.id), expected);
});

test("lembretes pendentes: acento e caixa, ordem por horario, limite 10 e isolamento", () => {
  const remedio = createReminder(A, "Remédio da pressão", minutes(60 * 5));
  const outro = createReminder(A, "REMÉDIO da gastrite", minutes(60 * 2));
  createReminder(B, "Remédio do outro número", minutes(60));
  const ids = (q: string) => findPendingRemindersByText(A, q).map((r) => r.id);
  assert.deepEqual(ids("remedio"), [outro, remedio], "mais cedo primeiro");
  assert.deepEqual(ids("remedio pressao"), [remedio]);
  assert.deepEqual(ids("o remédio da gastrite"), [outro]);
  assert.deepEqual(ids("%"), []);
  assert.deepEqual(ids("vitamina"), []);

  const D = "551100110004";
  for (let i = 0; i < 13; i++) createReminder(D, `Tomar água ${i}`, minutes(60 + i));
  const found = findPendingRemindersByText(D, "tomar agua");
  assert.equal(found.length, 10);
  assert.deepEqual(found.map((r) => r.message), Array.from({ length: 10 }, (_, i) => `Tomar água ${i}`));
});

test("lembretes enviados: acento e caixa, janela de horas, mais recente primeiro, sem texto traz os recentes", () => {
  const E = "551100110005";
  const mk = (message: string, minutesAgo: number) => {
    const id = createReminder(E, message, minutes(-minutesAgo));
    markReminderSent(E, id);
    return id;
  };
  const antigo = mk("Remédio antigo", 90);
  const recente = mk("Remédio recente", 10);
  const outro = mk("Ligar para o banco", 20);
  assert.deepEqual(findRecentSentReminders(E, "remedio", 24).map((r) => r.id), [recente, antigo]);
  assert.deepEqual(findRecentSentReminders(E, "REMÉDIO", 1).map((r) => r.id), [recente], "janela de 1 h");
  assert.deepEqual(findRecentSentReminders(E, undefined, 24).map((r) => r.id), [recente, outro, antigo]);
  assert.deepEqual(findRecentSentReminders(E, "  ", 24).map((r) => r.id), [recente, outro, antigo], "texto em branco = sem filtro");
  assert.deepEqual(findRecentSentReminders(E, "%", 24), []);
  assert.deepEqual(findRecentSentReminders(E, "remedio", 24, 1).map((r) => r.id), [recente], "limite depois do filtro");
  assert.deepEqual(findRecentSentReminders("551100110099", "remedio", 24), [], "outro numero");
  // lembrete ainda pendente nao aparece nos enviados
  createReminder(E, "Remédio pendente", minutes(60));
  assert.ok(!findRecentSentReminders(E, "pendente", 24).length);
});

test("alerta de conta: acento, caixa, o mais recente primeiro e so os ativos", () => {
  const F = "551100110006";
  const agua = createBillAlert({ fromNumber: F, name: "Água", dayOfMonth: 10 });
  const agua2 = createBillAlert({ fromNumber: F, name: "Conta de água do sítio", dayOfMonth: 15 });
  createBillAlert({ fromNumber: "551100110007", name: "Água do outro número", dayOfMonth: 5 });
  assert.equal(findActiveBillAlertByName(F, "agua")?.id, agua2.id, "o mais recente (id maior) vence, como antes");
  assert.equal(findActiveBillAlertByName(F, "ÁGUA")?.id, agua2.id);
  assert.equal(findActiveBillAlertByName(F, "conta agua")?.id, agua2.id);
  assert.equal(findActiveBillAlertByName(F, "sitio")?.id, agua2.id);
  assert.equal(findActiveBillAlertByName(F, "luz"), null);
  assert.equal(findActiveBillAlertByName(F, "%"), null);
  assert.equal(findActiveBillAlertByName(F, "outro numero"), null, "isolamento");
  deactivateBillAlert(F, agua2.id);
  assert.equal(findActiveBillAlertByName(F, "agua")?.id, agua.id, "inativo some da busca");
  deactivateBillAlert(F, agua.id);
  assert.equal(findActiveBillAlertByName(F, "agua"), null);
});

test("gasto fixo: acento, caixa, o mais recente primeiro, so ativos e isolamento", () => {
  const G = "551100110008";
  const base = { amount: 100, categoryId: null, paymentMethodId: null };
  const mensalidade = createRecurringExpense({ fromNumber: G, description: "Mensalidade acadêmica", dayOfMonth: 5, ...base });
  const academia = createRecurringExpense({ fromNumber: G, description: "Academia", dayOfMonth: 10, ...base });
  createRecurringExpense({ fromNumber: "551100110009", description: "Academia do outro número", dayOfMonth: 1, ...base });
  assert.equal(findActiveRecurringExpenseByDescription(G, "academica")?.id, mensalidade.id);
  assert.equal(findActiveRecurringExpenseByDescription(G, "ACADÊMICA")?.id, mensalidade.id);
  assert.equal(findActiveRecurringExpenseByDescription(G, "academia")?.id, academia.id, "o mais recente vence");
  assert.equal(findActiveRecurringExpenseByDescription(G, "mensalidade academica")?.id, mensalidade.id);
  assert.equal(findActiveRecurringExpenseByDescription(G, "nada"), null);
  assert.equal(findActiveRecurringExpenseByDescription(G, "%"), null);
  assert.equal(findActiveRecurringExpenseByDescription(G, "outro numero"), null);
  db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ?`).run(academia.id);
  assert.equal(findActiveRecurringExpenseByDescription(G, "academia"), null, "inativo some; o 'Academia' do outro numero nao vale");
});

test("busca varre no maximo 500 linhas (as mais recentes/proximas) e filtra depois", () => {
  const H = "551100110010";
  const insert = db.prepare(`INSERT INTO reminders (to_number, message, due_at, sent) VALUES (?, ?, ?, 0)`);
  for (let i = 0; i < 520; i++) insert.run(H, i === 519 ? "Alvo depois do teto" : `Item ${i}`, minutes(60 + i));
  assert.deepEqual(findPendingRemindersByText(H, "item 3").length, 10, "mais de 10 acertos dentro do teto");
  assert.deepEqual(findPendingRemindersByText(H, "alvo depois do teto"), [], "linha 520 fica fora da varredura de 500");
  insert.run(H, "Alvo cedo", minutes(1));
  assert.equal(findPendingRemindersByText(H, "alvo cedo").length, 1);
});
