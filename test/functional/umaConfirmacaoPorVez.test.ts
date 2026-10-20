// Card 21, parte 1 (D-01): numa mesma mensagem so a PRIMEIRA acao que mexe em registro gera pergunta; as demais sao adiadas.
// Antes, apagar + editar deixava duas perguntas abertas e o "1" da previa podia cair na pergunta de exclusao e apagar o item.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, insertExpense } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createEvent, getEventById } from "../../src/events/service";
import { createReminder, getReminderById } from "../../src/reminders/service";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-15T10:00:00-03:00");

let seq = 0;
function user(): string {
  const n = `55110008600${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

const pendingKinds = (n: string) => (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);

// manda UMA mensagem que a IA devolve como varias acoes; devolve os textos novos enviados
async function sayMany(app: BotApp, n: string, text: string, actions: Interpretation[]) {
  const before = app.sent.length;
  app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.sent.slice(before).map((m) => m.text);
}

async function say(app: BotApp, n: string, text: string) {
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

function expense(n: string, description: string, amount = 10) {
  return insertExpense({ fromNumber: n, amount, description, categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-15" });
}

test("D-01: apagar evento + renomear o mesmo evento -- uma pergunta so (a de exclusao); o '1' cancela o evento e a edicao nao aconteceu", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Reuniao conflito", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  const texts = await sayMany(app, n, "cancela a reuniao conflito e renomeia a reuniao conflito", [
    { type: "delete_event", query: "reuniao conflito" },
    { type: "edit_event", query: "reuniao conflito", new_title: "Reuniao 2" },
  ]);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /Cancelar este evento\?/);
  assert.equal(texts[1], 'Deixei a alteração de "reuniao conflito" pra depois: confirma a de "Reuniao conflito" primeiro e me pede de novo.');
  assert.deepEqual(pendingKinds(n), ["delete_event"], "so a pergunta de exclusao esta aberta, nenhuma previa de edicao");
  await say(app, n, "1");
  assert.equal(getEventById(n, ev.id), undefined, "a exclusao era a pergunta ativa");
});

test("D-01 (inverso): renomear + cancelar -- a previa de edicao e a unica pergunta; o '1' confirma a edicao e o evento NAO e cancelado", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Reuniao inversa", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  const texts = await sayMany(app, n, "renomeia a reuniao inversa e cancela a reuniao inversa", [
    { type: "edit_event", query: "reuniao inversa", new_title: "Reuniao nova" },
    { type: "delete_event", query: "reuniao inversa" },
  ]);
  assert.match(texts[0], /^✏️ Reuniao inversa/);
  assert.equal(texts[1], 'Deixei a exclusão de "reuniao inversa" pra depois: confirma a de "Reuniao inversa" primeiro e me pede de novo.');
  await say(app, n, "1");
  assert.equal(getEventById(n, ev.id)?.title, "Reuniao nova");
});

test("D-01b: apagar gasto + mudar outro gasto, e a ordem inversa -- o '1' vale pra pergunta que ficou", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const um = expense(n, "Gasto um", 10);
  const dois = expense(n, "Gasto dois", 20);
  const first = await sayMany(app, n, "apaga o gasto um e muda o gasto dois pra 25", [
    { type: "delete_expense", query: "gasto um" },
    { type: "edit_expense", query: "gasto dois", changes: [{ field: "amount", value: "25" }] },
  ]);
  assert.match(first[0], /Apagar este gasto\?/);
  assert.match(first[1], /^Deixei a alteração de "gasto dois" pra depois: confirma a de "Gasto um" primeiro/);
  await say(app, n, "3"); // cancela a exclusao
  assert.ok(getExpenseById(n, um.id));
  assert.equal(getExpenseById(n, dois.id)?.amount, 20, "a edicao adiada nao aconteceu");

  const second = await sayMany(app, n, "muda o gasto dois pra 25 e apaga o gasto um", [
    { type: "edit_expense", query: "gasto dois", changes: [{ field: "amount", value: "25" }] },
    { type: "delete_expense", query: "gasto um" },
  ]);
  assert.match(second[0], /^✏️ Gasto dois/);
  assert.match(second[1], /^Deixei a exclusão de "gasto um" pra depois: confirma a de "Gasto dois" primeiro/);
  await say(app, n, "1");
  assert.equal(getExpenseById(n, dois.id)?.amount, 25);
  assert.ok(getExpenseById(n, um.id), "o gasto um continua la");
});

test("D-01: apagar + apagar -- so a primeira exclusao pergunta; a segunda e adiada ('Deixei a exclusao de ...')", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const reminder = createReminder(n, "Lembrete A", "2026-10-20T10:00:00-03:00");
  const ev = createEvent({ fromNumber: n, title: "Evento B", start: "2026-10-21T10:00:00-03:00", end: "2026-10-21T11:00:00-03:00" });
  const texts = await sayMany(app, n, "apaga o lembrete A e apaga o evento B", [
    { type: "delete_reminder", query: "lembrete a" },
    { type: "delete_event", query: "evento b" },
  ]);
  assert.match(texts[0], /Apagar este lembrete\?/);
  assert.equal(texts[1], 'Deixei a exclusão de "evento b" pra depois: confirma a de "Lembrete A" primeiro e me pede de novo.');
  await say(app, n, "1");
  assert.equal(getReminderById(n, reminder), undefined);
  assert.ok(getEventById(n, ev.id), "o evento B nao foi apagado");
});

test("D-01: tres acoes (apagar, editar, editar) -- so a primeira pergunta e as duas outras sao citadas como adiadas", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  expense(n, "Gasto A");
  const b = createEvent({ fromNumber: n, title: "Evento B", start: "2026-10-21T10:00:00-03:00", end: "2026-10-21T11:00:00-03:00" });
  const r = createReminder(n, "Lembrete C", "2026-10-22T10:00:00-03:00");
  const texts = await sayMany(app, n, "apaga o gasto A, remarca o evento B pra 15h e muda o lembrete C pra 16h", [
    { type: "delete_expense", query: "gasto a" },
    { type: "edit_event", query: "evento b", new_time: "15:00" },
    { type: "edit_reminder", query: "lembrete c", new_time: "16:00" },
  ]);
  assert.equal(texts.length, 3);
  assert.match(texts[0], /Apagar este gasto\?/);
  assert.match(texts[1], /^Deixei a alteração de "evento b" pra depois/);
  assert.match(texts[2], /^Deixei a alteração de "lembrete c" pra depois/);
  assert.equal(pendingKinds(n).filter((k) => k.startsWith("edit_")).length, 0);
  assert.ok(b && r);
});

test("D-01: outras exclusoes e remocoes entram na regra (remover gasto fixo, alerta, orcamento, apagar categoria)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const { createRecurringExpense } = await import("../../src/expenses/recurring");
  const { createBillAlert } = await import("../../src/bills/service");
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 10 });
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 7 });
  expense(n, "Mercado A");
  const first = await sayMany(app, n, "para o gasto fixo da internet e o alerta da luz", [
    { type: "remove_recurring_expense", query: "internet" },
    { type: "remove_bill_alert", query: "luz" },
  ]);
  assert.match(first[0], /Parar de lançar este gasto fixo\?/);
  assert.match(first[1], /^Deixei a exclusão de "luz" pra depois: confirma a de "Internet" primeiro/);
  await say(app, n, "3");
  const second = await sayMany(app, n, "cancela o alerta da luz e renomeia a categoria mercado", [
    { type: "remove_bill_alert", query: "luz" },
    { type: "rename_category", category: "Mercado", new_name: "Supermercado" },
  ]);
  assert.match(second[0], /Parar o alerta de "Luz"\?/);
  assert.match(second[1], /^Deixei a alteração de "esse item" pra depois: confirma a de "Luz" primeiro/);
});

test("D-01: acoes da agenda numerada (list_ref) tambem entram -- 'edita o 3 e cancela o 4' pergunta so a primeira e cita 'item 4 da agenda'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createReminder(n, "Remédio", "2026-10-15T07:00:00-03:00");
  createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00" });
  createReminder(n, "Pagar boleto", "2026-10-15T14:00:00-03:00");
  createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-15T16:30:00-03:00", end: "2026-10-15T17:30:00-03:00" });
  await sayMany(app, n, "o que tenho hoje", [{ type: "report", date: "2026-10-15" }]);
  const texts = await sayMany(app, n, "edita o 3 pra 15h e cancela o 4", [
    { type: "edit_reminder", query: "", list_ref: 3, new_time: "15:00" },
    { type: "delete_event", query: "", list_ref: 4 },
  ]);
  assert.match(texts[0], /^✏️ Pagar boleto/);
  assert.equal(texts[1], 'Deixei a exclusão de "item 4 da agenda" pra depois: confirma a de "Pagar boleto" primeiro e me pede de novo.');
  assert.equal(texts.length, 2);
});

test("D-01: se a primeira acao nao abre pergunta (nao achou nada), a segunda segue normalmente", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const ev = createEvent({ fromNumber: n, title: "Evento existe", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  const texts = await sayMany(app, n, "apaga o evento fantasma e remarca o evento existe", [
    { type: "delete_event", query: "fantasma zzz" },
    { type: "edit_event", query: "evento existe", new_time: "15:00" },
  ]);
  assert.match(texts[0], /Não encontrei nenhum evento parecido/);
  assert.match(texts[1], /^✏️ Evento existe/);
  assert.ok(ev);
});
