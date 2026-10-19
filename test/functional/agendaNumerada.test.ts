// Card 20: a agenda sai numerada e a lista (tipo e id de cada numero) fica guardada para "edita o 2" / "cancela o 3".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, insertExpense } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createReminder } from "../../src/reminders/service";
import { createEvent } from "../../src/events/service";

const at = (iso: string) => new Date(iso).getTime();
const THU_10H = at("2026-10-15T10:00:00-03:00");

// o bootApp recarrega os modulos de src: os caches precisam ser lidos DEPOIS dele, da mesma instancia do roteador
const getLastShownAgenda = (n: string): { kind: string; id: number }[] | null => require("../../src/lists/lastShown").getLastShownAgenda(n);
const getLastShownExpenses = (n: string): number[] | null => require("../../src/expenses/listCache").getLastShownExpenses(n);

let seq = 0;
function user(): string {
  const n = `55110008800${String(seq++).padStart(2, "0")}`;
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

test("Card 20: 'o que tenho hoje' numera os itens, mostra a dica e guarda a lista (tipo e id) pro 'cancela o 3'", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const reuniao = createEvent({ fromNumber: n, title: "Reunião", start: "2026-10-15T09:00:00-03:00", end: "2026-10-15T11:00:00-03:00", location: "Sala 2" });
  const boleto = createReminder(n, "Pagar boleto", "2026-10-15T14:00:00-03:00");
  const dentista = createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-15T16:30:00-03:00", end: "2026-10-15T17:30:00-03:00" });
  const text = await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.equal(
    text,
    '📅 Agenda — hoje (qui 15/10)\n\n1. agora 09:00–11:00 Reunião · Sala 2\n2. ⏰ 14:00 Pagar boleto\n3. 16:30–17:30 Dentista\n\nPra mexer em um item: "edita o 2" ou "cancela o 3".'
  );
  assert.deepEqual(getLastShownAgenda(n), [
    { kind: "event", id: reuniao.id },
    { kind: "reminder", id: boleto },
    { kind: "event", id: dentista.id },
  ]);
});

test("Card 20: semana e 'meus lembretes' tambem numeram em sequencia continua; consulta vazia nao grava lista", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-17T10:00:00-03:00", end: "2026-10-17T11:00:00-03:00" });
  createReminder(n, "Ligar", "2026-10-15T18:00:00-03:00");
  createReminder(n, "Remédio", "2026-10-16T08:00:00-03:00");
  const week = await say(app, n, "agenda da semana", { type: "report", week: "current" });
  assert.match(week, /Hoje · qui 15\/10\n1\. ⏰ 18:00 Ligar\nAmanhã · sex 16\/10\n2\. ⏰ 08:00 Remédio\nSáb 17\/10\n3\. 10:00–11:00 Dentista\n\nPra mexer em um item/);
  assert.equal(getLastShownAgenda(n)?.length, 3);
  const mine = await say(app, n, "meus lembretes", { type: "list_reminders" });
  assert.match(mine, /^⏰ Lembretes — próximos 10\n\nHoje · qui 15\/10\n1\. ⏰ 18:00 Ligar\nAmanhã · sex 16\/10\n2\. ⏰ 08:00 Remédio\n\nPra mexer em um item/);
  assert.deepEqual(getLastShownAgenda(n)?.map((i) => i.kind), ["reminder", "reminder"], "a ultima lista substitui a anterior");

  const other = user();
  assert.equal(await say(app, other, "agenda de domingo", { type: "report", date: "2026-10-18" }), "📅 Agenda — dia 18/10 (dom)\n\nNada agendado.");
  assert.equal(getLastShownAgenda(other), null, "sem itens: nada guardado");
});

test("Card 20 (RN02): uma lista de gastos mostrada depois da agenda substitui a lista guardada, e a agenda depois dos gastos tambem; isolamento por numero", async (t) => {
  const app = bootApp(t, THU_10H);
  const n = user();
  const other = user();
  createReminder(n, "Ligar", "2026-10-15T18:00:00-03:00");
  createReminder(other, "Do outro", "2026-10-15T18:00:00-03:00");
  const exp = insertExpense({ fromNumber: n, amount: 10, description: "Padaria", categoryId: null, paymentMethodId: null, date: "2026-10-15" });
  await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.ok(getLastShownAgenda(n));
  await say(app, n, "ultimas compras", { type: "list_expenses", last_n: 10 });
  assert.equal(getLastShownAgenda(n), null, "os gastos invalidaram a agenda");
  assert.deepEqual(getLastShownExpenses(n), [exp.id]);
  await say(app, n, "o que tenho hoje", { type: "report", date: "2026-10-15" });
  assert.equal(getLastShownExpenses(n), null, "a agenda invalidou os gastos");
  assert.equal(getLastShownAgenda(other), null, "o outro numero nao ganha lista nenhuma");
  await say(app, n, "quais categorias eu tenho", { type: "list_categories" });
  assert.equal(getLastShownAgenda(n), null, "qualquer outro pedido invalida");
});
