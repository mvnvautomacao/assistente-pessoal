// Card 15: aviso de conta fixa com lista 1/2/3, leitura segura da resposta e check-in que nao engole pedidos novos.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { startBillAlertScheduler } from "../../src/bills/scheduler";
import { resetDailyJobsForTests, runDueDailyJobs } from "../../src/scheduler/dailyJobs";
import { resetJobRunsForTests } from "../../src/scheduler/jobRuns";
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
  resetJobRunsForTests();
  resetDailyJobsForTests();
  const today = spDateString();
  const day = createBillAlert({ fromNumber: N, name: "Conta de água", dayOfMonth: Number(today.slice(8, 10)) });
  const interval = createBillAlert({ fromNumber: N, name: "Ração", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = ? WHERE id = ?`).run(today, interval.id);
  startBillAlertScheduler();
  await runDueDailyJobs(new Date(`${today}T12:00:00-03:00`));

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
  assert.match(app.last(), /Gasto registrado: R[$] 50,00 — mercado/);
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

// ---- valor ao confirmar, com lancamento como gasto do mes (RN01 a RN05) ---------------------------------

import { learnKeyword, getOrCreateCategory } from "../../src/expenses/service";

const fixedRows = (n: string) =>
  db.prepare(`SELECT id, amount, description, date, fixed_source, fixed_ref_id, category_id FROM expenses WHERE from_number = ? ORDER BY id`).all(n) as {
    id: number;
    amount: number;
    description: string;
    date: string;
    fixed_source: string | null;
    fixed_ref_id: number | null;
    category_id: number | null;
  }[];

// ensina a categoria do alerta (como num gasto avulso ja conhecido) pra o lancamento nao precisar perguntar
function knowCategory(n: string, billName: string, category = "Moradia") {
  learnKeyword(n, billName, getOrCreateCategory(n, category).id);
}

const VALUE_QUESTION = (name: string) => `Boa! Quanto foi *${name}*? (ex: 120 ou 120,50)\nOu responde *pular* pra só marcar como feito.`;

test("Card 15: '1', 'um', 'tá pago', 'ta pago', 'Já foi', 'resolvido' e 'paguei' pedem o valor, sem fechar o ciclo", async (t) => {
  const app = bootApp(t, NOW);
  for (const reply of ["1", "um", "opção 1", "tá pago", "ta pago", "Já foi", "resolvido", "paguei"]) {
    const n = user();
    const bill = openCheckin(n);
    await say(app, n, reply);
    assert.equal(app.last(), VALUE_QUESTION("Conta de água"), reply);
    assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null, `${reply}: ainda nao fechou`);
    assert.equal(expensesOf(n).length, 0);
    assert.equal(getPendingBillCheckin(n)?.step, "ask_value");
  }
});

test("Card 15: o valor lanca o gasto de hoje (SP) com a marca de conta fixa, fecha o ciclo e avisa o proximo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  const bill = openCheckin(n);
  await say(app, n, "tá pago");
  await say(app, n, "120");
  const rows = fixedRows(n);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 120);
  assert.equal(rows[0].description, "Conta de água");
  assert.equal(rows[0].date, TODAY);
  assert.equal(rows[0].fixed_source, "bill_alert");
  assert.equal(rows[0].fixed_ref_id, bill.id);
  assert.ok(app.sent.some((m) => m.text.startsWith("✅ Gasto registrado: R$ 120,00 — Conta de água (conta fixa)\nCategoria: Moradia")));
  assert.equal(app.last(), '📌 Fechei "Conta de água" deste ciclo. Te aviso de novo mês que vem, no dia certo.');
  const closed = getBillAlertById(n, bill.id)!;
  assert.equal(closed.confirmed_month, "2026-10");
  assert.equal(closed.snoozed_until, null);
  assert.equal(checkinRows(n), 0);
  // e o gasto pode ser desfeito como qualquer outro
  await say(app, n, "desfaz isso", { type: "undo" });
  assert.equal(fixedRows(n).length, 0);
});

test("Card 15: sem categoria conhecida o lancamento pergunta a categoria como num gasto avulso e a marca sobrevive", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n, { name: "Internet casa" });
  await say(app, n, "1");
  await say(app, n, "R$ 99,90");
  assert.match(app.sent[app.sent.length - 2].text, /Qual categoria/i);
  await say(app, n, "Moradia");
  const rows = fixedRows(n);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 99.9);
  assert.equal(rows[0].fixed_source, "bill_alert");
  assert.equal(rows[0].fixed_ref_id, bill.id);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, "2026-10");
});

test("Card 15: 'igual' repete o ultimo valor deste alerta; sem valor anterior repete a pergunta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  const bill = openCheckin(n);
  await say(app, n, "1");
  assert.match(await say(app, n, "igual"), /^Ainda não tenho um valor anterior dessa conta/);
  assert.equal(expensesOf(n).length, 0);
  await say(app, n, "118");
  assert.equal(fixedRows(n)[0].amount, 118);

  // proximo ciclo: a pergunta mostra o ultimo valor e "igual" repete
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });
  await say(app, n, "1");
  assert.equal(
    app.last(),
    "Boa! Quanto foi *Conta de água*? (ex: 120 ou 120,50)\nDa última vez: R$ 118,00 — responde *igual* pra repetir. Ou *pular* pra só marcar como feito."
  );
  await say(app, n, "igual");
  const rows = fixedRows(n);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].amount, 118);
});

test("Card 15: 'pular' na pergunta do valor fecha o ciclo sem criar gasto", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  await say(app, n, "1");
  await say(app, n, "pular");
  assert.equal(app.last(), "Beleza, só marquei Conta de água como feito, sem lançar gasto. Te aviso de novo mês que vem, no dia certo.");
  assert.equal(expensesOf(n).length, 0);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, "2026-10");
  assert.equal(checkinRows(n), 0);
});

test("Card 15: valor invalido (0, negativo, texto) explica e repete a pergunta, sem fechar o ciclo; 1, 2 e 3 sao valores", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  const bill = openCheckin(n);
  await say(app, n, "1");
  for (const bad of ["0", "-50"]) {
    assert.equal(await say(app, n, bad), `O valor precisa ser maior que R$ 0,00.\n${VALUE_QUESTION("Conta de água")}`, bad);
  }
  assert.equal(await say(app, n, "sei lá quanto foi"), `Não entendi o valor.\n${VALUE_QUESTION("Conta de água")}`);
  assert.equal(expensesOf(n).length, 0);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.equal(getPendingBillCheckin(n)?.step, "ask_value");
  await say(app, n, "2"); // "2" aqui e o valor R$ 2,00, nao a opcao de adiar
  assert.equal(fixedRows(n)[0].amount, 2);
});

test("Card 15: valor por extenso, com R$ e com milhar", async (t) => {
  const app = bootApp(t, NOW);
  for (const [text, value] of [["cento e vinte", 120], ["R$ 1.250,90", 1250.9], ["120 reais", 120], ["89,90", 89.9]] as [string, number][]) {
    const n = user();
    knowCategory(n, "Conta de água");
    openCheckin(n);
    await say(app, n, "1");
    await say(app, n, text);
    assert.equal(fixedRows(n)[0].amount, value, text);
  }
});

test("Card 15: alerta por intervalo -- mesmo fluxo, o intervalo recomeca a contar de hoje", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Ração", "Pets");
  const bill = openCheckin(n, { name: "Ração", intervalDays: 45 });
  await say(app, n, "já comprei");
  assert.equal(app.last(), VALUE_QUESTION("Ração"));
  await say(app, n, "80");
  const rows = fixedRows(n);
  assert.equal(rows[0].amount, 80);
  assert.equal(rows[0].fixed_source, "bill_alert");
  assert.equal(app.last(), '📌 Fechei "Ração" deste ciclo. Te aviso de novo daqui a 45 dias.');
  assert.equal(getBillAlertById(n, bill.id)?.next_due_date, addDaysToDateString(TODAY, 45));
});

test("Card 15: 10 minutos sem o valor -- nada e criado, o aviso de expiracao vem e o alerta volta a perguntar amanha", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  await say(app, n, "1");
  app.advance(11 * 60 * 1000);
  await say(app, n, "1");
  assert.equal(app.last(), '⌛ A pergunta sobre "Conta de água" expirou e eu não registrei nada. Volto a te avisar amanhã.');
  assert.equal(expensesOf(n).length, 0);
  const row = getBillAlertById(n, bill.id)!;
  assert.equal(row.confirmed_month, null, "nao fechou");
  assert.equal(row.snoozed_until, addDaysToDateString(TODAY, 1), "volta a perguntar amanha");
});

test("Card 15: reinicio do servidor entre o 'ja paguei' e o valor -- o valor continua valendo", async (t) => {
  let app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  openCheckin(n);
  await say(app, n, "1");
  app = bootApp(t); // reinicio
  await say(app, n, "120");
  assert.equal(fixedRows(n)[0].amount, 120);
});

test("Card 15: pedido novo enquanto espera o valor e atendido e a pergunta do valor continua aberta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  openCheckin(n);
  await say(app, n, "1");
  await say(app, n, "gastei 50 no mercado", { type: "expense", amount: 50, description: "mercado", category: "Mercado", date: TODAY });
  assert.equal(expensesOf(n).length, 1);
  assert.equal(getPendingBillCheckin(n)?.step, "ask_value");
  const avulso = fixedRows(n)[0];
  assert.equal(avulso.fixed_source, null, "gasto comum nasce avulso");
  await say(app, n, "120");
  assert.equal(fixedRows(n).length, 2);
});

test("Card 15: alerta apagado entre o aviso e a resposta -- avisa e nao quebra", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  const { deactivateBillAlert } = require("../../src/bills/service");
  deactivateBillAlert(n, bill.id);
  await say(app, n, "1");
  assert.equal(app.last(), 'O alerta de "Conta de água" não existe mais, então deixei de lado.');
  assert.equal(checkinRows(n), 0);
  assert.equal(expensesOf(n).length, 0);
});

test("Card 15: dois avisos -- apos o valor do primeiro, a lista do segundo sai; o fechamento automatico NAO cria gasto (RN10)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  knowCategory(n, "Conta de água");
  openCheckin(n, { name: "Conta de água" });
  const second = createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 14 });
  const { enqueueBillCheckin } = require("../../src/bills/pendingCheckin");
  enqueueBillCheckin(n, { billAlertId: second.id, name: second.name, recurrenceType: second.recurrence_type, intervalDays: null });
  await say(app, n, "1");
  await say(app, n, "120");
  assert.equal(app.last(), "📌 Hoje é dia de pagar: Luz.\n" + LIST_DAY);
  assert.equal(getPendingBillCheckin(n)?.name, "Luz");
  // fechar o ciclo direto no servico (como o fechamento automatico futuro) nao lanca gasto
  const { confirmBillAlertPaid } = require("../../src/bills/service");
  confirmBillAlertPaid(n, second.id, TODAY);
  assert.equal(fixedRows(n).length, 1);
});
