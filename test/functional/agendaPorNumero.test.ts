// Card 20: editar, remarcar, cancelar, apagar e adiar pelo numero da lista da agenda ("edita o 2", "cancela o 3"), passando pelos
// fluxos guiados que ja existem (previa 1/2/3, confirmacao 1/3, desfazer).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreateCategory, insertExpense } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createReminder, deleteReminder, getReminderById, markReminderSent } from "../../src/reminders/service";
import { createEvent, deleteEvent, getEventById, listEventReminderMinutes } from "../../src/events/service";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const THU_10H = at("2026-10-15T10:00:00-03:00");

let seq = 0;
function user(): string {
  const n = `55110008700${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

// Agenda de hoje (qui 15/10), numeros: 1 Remédio (✔️ ja tocou), 2 Reunião (evento, em andamento), 3 Pagar boleto (lembrete), 4 Dentista (evento)
async function setupDay(app: BotApp, n: string) {
  const remedio = createReminder(n, "Remédio", "2026-10-15T07:00:00-03:00");
  markReminderSent(n, remedio);
  const reuniao = createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00", location: "Sala 2" });
  const boleto = createReminder(n, "Pagar boleto", "2026-10-15T14:00:00-03:00");
  const dentista = createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-15T16:30:00-03:00", end: "2026-10-15T17:30:00-03:00" });
  const list = await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.match(list, /1\. ✔️ 07:00 Remédio\n2\. agora 09:00–11:00 Reunião · Sala 2\n3\. ⏰ 14:00 Pagar boleto\n4\. 16:30–17:30 Dentista/);
  return { remedio, reuniao, boleto, dentista };
}

test("Card 20 (reproducao do gap): depois da lista, 'cancela o 4' tem de abrir a confirmacao do Dentista -- e nao uma lista de escolha", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { dentista } = await setupDay(app, n);
  const text = await say(app, n, "cancela o 4", { type: "delete_event", query: "", list_ref: 4 });
  assert.match(text, /Cancelar este evento\?/);
  assert.match(text, /Dentista/);
  assert.ok(!text.includes("Qual deles"), text);
  assert.ok(getEventById(n, dentista.id), "nada cancelado antes do 1");
});

test("Card 20: 'cancela o 4' -> confirmacao -> '1' cancela o evento certo e o desfazer traz de volta", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { dentista, reuniao } = await setupDay(app, n);
  await say(app, n, "cancela o 4", { type: "delete_event", query: "", list_ref: 4 });
  await say(app, n, "1");
  assert.equal(getEventById(n, dentista.id), undefined);
  assert.ok(getEventById(n, reuniao.id), "so o escolhido");
  assert.match(app.last(), /cancelado|removido|Errou\? Responde \*desfazer\*/i);
  await say(app, n, "desfaz isso", { type: "undo" });
  const back = db.prepare(`SELECT title FROM events WHERE from_number = ? AND title = 'Dentista'`).all(n);
  assert.equal(back.length, 1, "o desfazer recriou o evento");
});

test("Card 20: 'muda o 3 pra 15h' (lembrete) abre a previa 1/2/3 com o horario novo e so grava no 1", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { boleto } = await setupDay(app, n);
  const preview = await say(app, n, "muda o 3 pra 15h", { type: "edit_reminder", query: "", list_ref: 3, new_time: "15:00" });
  assert.match(preview, /^✏️ Pagar boleto\nQuando: .*14:00.* → .*15:00/s);
  assert.match(preview, /1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar/);
  assert.match(getReminderById(n, boleto)!.due_at, /14:00|17:00/, "ainda no horario antigo");
  await say(app, n, "1");
  assert.equal(new Date(getReminderById(n, boleto)!.due_at).getTime(), at("2026-10-15T15:00:00-03:00"));
});

test("Card 20: 'muda o 4 pra 18h' (evento) remarca pelo fluxo existente; 'edita o 2' sem mudanca abre o menu de campos", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { dentista } = await setupDay(app, n);
  const preview = await say(app, n, "muda o 4 pra 18h", { type: "edit_event", query: "", list_ref: 4, new_time: "18:00" });
  assert.match(preview, /^✏️ Dentista/);
  assert.match(preview, /18:00/);
  await say(app, n, "1");
  assert.equal(new Date(getEventById(n, dentista.id)!.start).getTime(), at("2026-10-15T18:00:00-03:00"));
  const menu = await say(app, n, "edita o 2", { type: "edit_reminder", query: "", list_ref: 3 });
  assert.match(menu, /^✏️ Pagar boleto/);
  assert.match(menu, /O que você quer mudar\?/);
});

test("Card 20: 'adia o 1 pra amanha as 9h' (lembrete que ja tocou) adia pelo fluxo existente; lembrete pendente vira remarcacao com previa", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { remedio, boleto } = await setupDay(app, n);
  const done = await say(app, n, "adia o 1 pra amanha as 9h", { type: "snooze_reminder", query: "", list_ref: 1, new_date: "2026-10-16", new_time: "09:00" });
  assert.match(done, /Remédio/);
  assert.equal(new Date(getReminderById(n, remedio)!.due_at).getTime(), at("2026-10-16T09:00:00-03:00"));
  assert.equal(getReminderById(n, remedio)!.sent, 0, "volta a ficar pendente");

  const pending = await say(app, n, "adia o 3 pra amanha as 9h", { type: "snooze_reminder", query: "", list_ref: 3, new_date: "2026-10-16", new_time: "09:00" });
  assert.match(pending, /^✏️ Pagar boleto/);
  assert.match(pending, /1 ✅ Confirmar/);
  await say(app, n, "1");
  assert.equal(new Date(getReminderById(n, boleto)!.due_at).getTime(), at("2026-10-16T09:00:00-03:00"));
});

test("Card 20: 'adia o 3 30 min' num lembrete pendente soma os minutos ao horario dele; sem horario nenhum pede o horario", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  await setupDay(app, n);
  const preview = await say(app, n, "adia o 3 30 min", { type: "snooze_reminder", query: "", list_ref: 3, minutes: 30 });
  assert.match(preview, /14:00.* → .*14:30/s);
  await say(app, n, "3");
  const ask = await say(app, n, "adia o 3", { type: "snooze_reminder", query: "", list_ref: 3 });
  assert.match(ask, /^Pra quando você quer adiar\?/);
});

test("Card 20 (RN03): o tipo REAL do item manda -- cancela/edita/adia apontando pro tipo errado", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { boleto, reuniao } = await setupDay(app, n);
  // "cancela o 3" mas a IA escolheu delete_event e o 3 e um lembrete -> apagar lembrete
  const delReminder = await say(app, n, "cancela o 3", { type: "delete_event", query: "", list_ref: 3 });
  assert.match(delReminder, /Apagar este lembrete\?/);
  assert.match(delReminder, /Pagar boleto/);
  await say(app, n, "3");
  assert.ok(getReminderById(n, boleto), "nada apagado ainda");
  // "edita o 2" mas a IA escolheu edit_reminder e o 2 e um evento -> editar evento
  const editEvent = await say(app, n, "muda o 2 pra 10h", { type: "edit_reminder", query: "", list_ref: 2, new_time: "10:00" });
  assert.match(editEvent, /^✏️ Reunião/);
  await say(app, n, "3");
  assert.ok(getEventById(n, reuniao.id));
  // adiar um evento: nao da
  const snoozeEvent = await say(app, n, "adia o 2", { type: "snooze_reminder", query: "", list_ref: 2, minutes: 30 });
  assert.equal(snoozeEvent, 'Esse item é um evento, não dá pra adiar. Quer remarcar? Diga "muda o 2 pra ...".');
  // aviso extra num lembrete: nao existe
  const extra = await say(app, n, "me avisa 1 dia antes do 3", { type: "add_event_reminder", query: "", list_ref: 3, minutes_before: 1440 });
  assert.match(extra, /lembrete/i);
});

test("Card 20: aviso extra e remocao de aviso pelo numero do evento", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { dentista } = await setupDay(app, n);
  const added = await say(app, n, "me avisa tambem 1 dia antes do 4", { type: "add_event_reminder", query: "", list_ref: 4, minutes_before: 1440 });
  assert.match(added, /Dentista/);
  assert.deepEqual(listEventReminderMinutes(n, dentista.id).sort((a, b) => a - b), [60, 1440]);
  const removed = await say(app, n, "tira o aviso de 1 dia do 4", { type: "remove_event_reminder", query: "", list_ref: 4, minutes_before: 1440 });
  assert.match(removed, /Dentista/);
  assert.deepEqual(listEventReminderMinutes(n, dentista.id), [60]);
});

test("Card 20 (RN04): lembrete ja tocado -- apagar funciona; editar o horario orienta a adiar", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { remedio } = await setupDay(app, n);
  const guide = await say(app, n, "muda o 1 pra 20h", { type: "edit_reminder", query: "", list_ref: 1, new_time: "20:00" });
  assert.match(guide, /^O lembrete "Remédio" já tocou/);
  assert.match(guide, /adia/);
  assert.ok(getReminderById(n, remedio));
  const del = await say(app, n, "apaga o 1", { type: "delete_reminder", query: "", list_ref: 1 });
  assert.match(del, /Apagar este lembrete\?/);
  await say(app, n, "1");
  assert.equal(getReminderById(n, remedio), undefined);
});

test("Card 20: numero fora da lista, lista expirada e item que sumiu desde que a lista foi mostrada", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { dentista } = await setupDay(app, n);
  const NOT_SURE = 'Não sei a que item o número "9" se refere. Me pede a agenda de novo, ex: "o que tenho hoje".';
  assert.equal(await say(app, n, "apaga o 9", { type: "delete_reminder", query: "", list_ref: 9 }), NOT_SURE);

  deleteEvent(n, dentista.id);
  assert.equal(await say(app, n, "cancela o 4", { type: "delete_event", query: "", list_ref: 4 }), "Não achei mais esse item.");

  app.advance(11 * 60 * 1000);
  assert.equal(await say(app, n, "cancela o 2", { type: "delete_event", query: "", list_ref: 2 }), 'Não sei a que item o número "2" se refere. Me pede a agenda de novo, ex: "o que tenho hoje".');
});

test("Card 20: lembrete apagado e recriado com o mesmo texto -- o numero antigo aponta pro id apagado", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const { boleto } = await setupDay(app, n);
  deleteReminder(n, boleto);
  createReminder(n, "Pagar boleto", "2026-10-15T14:00:00-03:00");
  assert.equal(await say(app, n, "apaga o 3", { type: "delete_reminder", query: "", list_ref: 3 }), "Não achei mais esse item.");
});

test("Card 20 (RN02): uma lista de gastos mostrada depois da agenda -- 'edita o 2' vale pro gasto, e o numero da agenda deixa de valer", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  await setupDay(app, n);
  const cat = getOrCreateCategory(n, "Mercado");
  insertExpense({ fromNumber: n, amount: 10, description: "Padaria", categoryId: cat.id, paymentMethodId: null, date: "2026-10-15" });
  const second = insertExpense({ fromNumber: n, amount: 20, description: "Feira", categoryId: cat.id, paymentMethodId: null, date: "2026-10-14" });
  await say(app, n, "ultimas compras", { type: "list_expenses", last_n: 10 });
  const preview = await say(app, n, "muda o valor do 2 pra 25", { type: "edit_expense", list_ref: 2, changes: [{ field: "amount", value: "25" }] });
  assert.match(preview, /^✏️ Feira/);
  assert.ok(second.id);
  await say(app, n, "3");
  const gone = await say(app, n, "cancela o 4", { type: "delete_event", query: "", list_ref: 4 });
  assert.match(gone, /^Não sei a que item o número "4" se refere/);
});

test("Card 20: cada numero de WhatsApp tem a sua lista -- nunca resolve item de outro", async (t) => {
  const app = bootApp(t, THU_10H);
  const a = user();
  const b = user();
  const { dentista } = await setupDay(app, a);
  const other = createEvent({ fromNumber: b, title: "Do B", start: "2026-10-15T16:30:00-03:00", end: "2026-10-15T17:30:00-03:00" });
  const text = await say(app, b, "cancela o 4", { type: "delete_event", query: "", list_ref: 4 });
  assert.match(text, /^Não sei a que item o número "4" se refere/);
  assert.ok(getEventById(a, dentista.id));
  assert.ok(getEventById(b, other.id));
});

test("Card 20: frases soltas 'editar evento' e 'cancelar lembrete' continuam abrindo as listas de escolha (sem IA)", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  await setupDay(app, n);
  assert.match(await say(app, n, "editar evento"), /^Seus próximos eventos:\n1\. /);
  await say(app, n, "cancelar");
  assert.match(await say(app, n, "apagar lembrete"), /^Seus lembretes:\n1\. /);
  assert.equal(app.calls.length, 1, "so a consulta da agenda usou a IA");
});
