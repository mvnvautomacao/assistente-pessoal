// Card 15: aviso de conta fixa com lista 1/2/3, leitura segura da resposta e check-in que nao engole pedidos novos.
import { test } from "node:test";
import assert from "node:assert/strict";
import cron from "node-cron";
import * as whatsappClient from "../../src/whatsapp/client";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { startBillAlertScheduler } from "../../src/bills/scheduler";
import { addDaysToDateString, spDateString } from "../../src/timeSP";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00");
const TODAY = "2026-10-14";

let seq = 0;
function user(): string {
  const n = `55110009800${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

const expensesOf = (n: string) => db.prepare(`SELECT * FROM expenses WHERE from_number = ? ORDER BY id`).all(n) as { id: number; amount: number; description: string }[];
const checkinRows = (n: string) => (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? AND kind = 'bill_checkin'`).all(n) as { kind: string }[]).length;

// cria o alerta e arma o aviso aberto (como o scheduler faz depois de enviar a lista)
function openCheckin(n: string, over: { name?: string; dayOfMonth?: number; intervalDays?: number } = {}) {
  const bill = over.intervalDays
    ? createBillAlert({ fromNumber: n, name: over.name ?? "Ração", intervalDays: over.intervalDays })
    : createBillAlert({ fromNumber: n, name: over.name ?? "Conta de água", dayOfMonth: over.dayOfMonth ?? 14 });
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });
  return bill;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const LIST_DAY = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";

test("Card 15: o scheduler das 8h manda o aviso com a lista 1/2/3 (texto proprio no alerta por intervalo) e arma o check-in", async (t) => {
  const N = user();
  const sent: { to: string; text: string }[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (_expr: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop() {} };
  });
  const today = spDateString();
  const day = createBillAlert({ fromNumber: N, name: "Conta de água", dayOfMonth: Number(today.slice(8, 10)) });
  const interval = createBillAlert({ fromNumber: N, name: "Ração", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = ? WHERE id = ?`).run(today, interval.id);
  startBillAlertScheduler();
  await tick!();

  const mine = sent.filter((m) => m.to === N).map((m) => m.text);
  assert.ok(mine.includes(`📌 Hoje é dia de pagar: Conta de água.\n${LIST_DAY}`));
  assert.ok(mine.includes("📌 Hora de: Ração.\n1 ✅ Já resolvi\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou fazer agora (pular)"));
  // o primeiro aviso e o da vez; o segundo espera na fila (e volta a perguntar amanha se a fila se perder)
  const pending = getPendingBillCheckin(N);
  assert.ok(pending);
  assert.equal(pending.queued.length, 1);
  assert.deepEqual([pending.name, pending.queued[0].name].sort(), ["Conta de água", "Ração"]);
  const queuedId = pending.queued[0].billAlertId;
  assert.equal(getBillAlertById(N, queuedId)?.snoozed_until, addDaysToDateString(today, 1));
  assert.ok(day.id && interval.id);
});

test("Card 15: '2', 'dois', 'amanhã', 'ainda não' e 'não' adiam pro dia seguinte, sem gasto", async (t) => {
  const app = bootApp(t, NOW);
  for (const reply of ["2", "dois", "opção 2", "amanhã", "ainda não", "não", "Ainda não, lembra amanhã"]) {
    const n = user();
    const bill = openCheckin(n);
    await say(app, n, reply);
    assert.equal(app.last(), 'Combinado, te lembro de "Conta de água" amanhã de novo.', reply);
    assert.equal(getBillAlertById(n, bill.id)?.snoozed_until, addDaysToDateString(TODAY, 1), reply);
    assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null, reply);
    assert.equal(expensesOf(n).length, 0);
    assert.equal(checkinRows(n), 0, "a pergunta foi resolvida");
  }
});

test("Card 15: '3', 'pular', 'não vou pagar' e 'esse mês não' fecham o ciclo sem gasto e dizem quando avisa de novo", async (t) => {
  const app = bootApp(t, NOW);
  for (const reply of ["3", "três", "pular", "Pular!", "não vou pagar", "esse mês não"]) {
    const n = user();
    const bill = openCheckin(n);
    await say(app, n, reply);
    assert.equal(app.last(), "Beleza, pulei Conta de água neste ciclo. Te aviso de novo mês que vem, no dia certo.", reply);
    assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, "2026-10", reply);
    assert.equal(expensesOf(n).length, 0, "pular nao cria gasto");
  }
  // por intervalo recomeca a contar de hoje
  const n = user();
  const rac = openCheckin(n, { name: "Ração", intervalDays: 45 });
  await say(app, n, "3");
  assert.equal(app.last(), "Beleza, pulei Ração neste ciclo. Te aviso de novo daqui a 45 dias.");
  assert.equal(getBillAlertById(n, rac.id)?.next_due_date, addDaysToDateString(TODAY, 45));
  assert.equal(expensesOf(n).length, 0);
});

test("Card 15: resposta ambigua ou mista NUNCA fecha nem adia -- repete a lista e o aviso continua aberto", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  for (const reply of ["não, já paguei", "sim, mas ainda não paguei", "paguei metade", "talvez", "sei lá", "4", "1 e 2", "quero uma pizza grande agora"]) {
    await say(app, n, reply);
    assert.equal(app.last(), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`, reply);
    assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null, reply);
    assert.equal(getBillAlertById(n, bill.id)?.snoozed_until, null, reply);
    assert.equal(checkinRows(n), 1, `${reply}: o aviso continua aberto`);
  }
  assert.equal(expensesOf(n).length, 0);
});

test("Card 15: o check-in nao engole pedido novo -- 'gastei 50 no mercado' e atendido e o aviso continua aberto; 'ajuda' tambem passa", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  app.calls.length = 0;
  await say(app, n, "gastei 50 no mercado", { type: "expense", amount: 50, description: "mercado", category: "Mercado", date: TODAY });
  assert.deepEqual(app.calls, ["gastei 50 no mercado"]);
  assert.match(app.last(), /Gasto registrado: R\$50\.00 — mercado/);
  assert.equal(expensesOf(n).length, 1);
  assert.equal(checkinRows(n), 1, "o aviso continua aberto");
  assert.ok(!app.sent.some((m) => m.text.startsWith("Deixei")), "sem linha de troca: o aviso nao foi descartado");

  await say(app, n, "ajuda", { type: "help" });
  assert.match(app.last(), /O que eu faço|Como/);
  assert.equal(checkinRows(n), 1);

  // resposta curta que a IA nao entende: repete a lista
  await say(app, n, "sei lá, talvez");
  assert.equal(app.last(), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);

  // pedido que abre outra confirmacao (editar/apagar) nao e "pedido novo seguro": repete a lista
  await say(app, n, "apaga o gasto mercado", { type: "delete_expense", query: "mercado" });
  assert.equal(app.last(), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);
  assert.equal(expensesOf(n).length, 1, "nada apagado");

  // depois de tudo isso, a resposta certa ainda vale
  await say(app, n, "2");
  assert.equal(app.last(), 'Combinado, te lembro de "Conta de água" amanhã de novo.');
});

test("Card 15: 'desfaz isso' com o aviso aberto fala da ultima acao, nao do aviso", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  const text = await say(app, n, "desfaz isso", { type: "undo" });
  assert.equal(text, "Não tem nada recente pra eu desfazer.");
  assert.equal(checkinRows(n), 1);
});

test("Card 15: reinicio do servidor entre o aviso e a resposta -- a resposta continua valendo (pending_state)", async (t) => {
  let app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  app = bootApp(t); // reinicio: memoria zerada, banco igual
  await say(app, n, "2");
  assert.equal(app.last(), 'Combinado, te lembro de "Conta de água" amanhã de novo.');
  assert.equal(getBillAlertById(n, bill.id)?.snoozed_until, addDaysToDateString(TODAY, 1));
});

test("Card 15: dois avisos no mesmo dia -- responde um por vez, na ordem; a lista do proximo sai depois; repeticao cita a conta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const first = openCheckin(n, { name: "Conta de água", dayOfMonth: 14 });
  const second = createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 14 });
  const { enqueueBillCheckin } = require("../../src/bills/pendingCheckin");
  assert.equal(enqueueBillCheckin(n, { billAlertId: second.id, name: second.name, recurrenceType: second.recurrence_type, intervalDays: null }), "queued");

  assert.match(await say(app, n, "talvez"), /^Não entendi 🤔 Sobre \*Conta de água\*, responde \*1\*, \*2\* ou \*3\*:/);
  await say(app, n, "2"); // adia a conta de agua
  assert.equal(getBillAlertById(n, first.id)?.snoozed_until, addDaysToDateString(TODAY, 1));
  assert.equal(app.last(), "📌 Hoje é dia de pagar: Luz.\n" + LIST_DAY, "a lista do proximo aviso sai em seguida");
  assert.equal(getPendingBillCheckin(n)?.name, "Luz");
  await say(app, n, "pular");
  assert.equal(getBillAlertById(n, second.id)?.confirmed_month, "2026-10");
  assert.equal(checkinRows(n), 0);
});

test("Card 15: aviso sem resposta por mais de 20 h expira com aviso proprio e nao grava nada", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  app.advance(20 * 60 * 60 * 1000 + 5 * 60 * 1000);
  await say(app, n, "1");
  assert.equal(app.last(), '⌛ A pergunta sobre "Conta de água" expirou e eu não registrei nada. Volto a te avisar amanhã.');
  assert.equal(expensesOf(n).length, 0);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
});
