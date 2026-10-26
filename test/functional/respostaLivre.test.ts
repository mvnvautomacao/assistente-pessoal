// Card 24, parte 1: resposta livre ("ja paguei a conta hoje") a uma pergunta aberta com opcoes -> regra tolerante (Nivel A), "Entendi que foi *N*.
// Confirma?" e aplicacao so depois do "1", chamando o resolvedor original com o numero. Sem IA e sem audio nesta parte.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, getOrCreatePaymentMethod, insertExpense, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { getPendingBillCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";
import { createEvent, getEventById } from "../../src/events/service";
import { getPendingReplyConfirm } from "../../src/confirmation/replyConfirm";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00");
const LIST_DAY = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";
const CONFIRM_TAIL = "1 Sim, é isso\n2 Não, ver as opções";

let seq = 0;
function user(): string {
  const n = `55110009${String(900 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

function openCheckin(n: string, over: { name?: string; intervalDays?: number; queued?: string[] } = {}) {
  const make = (name: string) =>
    over.intervalDays ? createBillAlert({ fromNumber: n, name, intervalDays: over.intervalDays }) : createBillAlert({ fromNumber: n, name, dayOfMonth: 14 });
  const bill = make(over.name ?? "Conta de luz");
  const queued = (over.queued ?? []).map((name) => {
    const other = make(name);
    return { billAlertId: other.id, name: other.name, recurrenceType: other.recurrence_type, intervalDays: other.interval_days };
  });
  setPendingBillCheckin(n, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days, queued });
  return bill;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const pendingKinds = (n: string) => (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);
const expensesOf = (n: string) => db.prepare(`SELECT * FROM expenses WHERE from_number = ? ORDER BY id`).all(n) as { id: number; amount: number; description: string }[];
const interpretedLogs = (n: string) => (db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = 'reply_interpreted' ORDER BY id`).all(n) as { summary: string }[]).map((r) => r.summary);

test("REPRODUCAO: 'Já paguei a conta hoje.' ao aviso de conta fixa virava 'Não entendi'; agora vira 'Entendi que foi *1 ✅ Já paguei*. Confirma?' (e nada e aplicado)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  const reply = await say(app, n, "Já paguei a conta hoje.");
  assert.equal(reply, `Entendi que foi *1 ✅ Já paguei*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(getPendingBillCheckin(n)?.step, "ask_paid", "o aviso continua na primeira etapa: nada foi aplicado ainda");
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.equal(app.calls.length, 0, "nivel A: sem IA");
  assert.deepEqual(pendingKinds(n), ["bill_checkin", "reply_confirm"]);
});

test("aviso de conta: 'eu ja paguei', 'paguei ja' e 'quitei a conta' viram a sugestao 1 pelo Nivel A, sem IA; '1' ou 'sim' faz o que o '1' faria (pergunta o valor)", async (t) => {
  const app = bootApp(t, NOW);
  for (const phrase of ["Eu já paguei", "paguei já", "quitei a conta", "ja resolvi tudo"]) {
    const n = user();
    openCheckin(n);
    assert.equal(await say(app, n, phrase), `Entendi que foi *1 ✅ Já paguei*. Confirma?\n${CONFIRM_TAIL}`, phrase);
    assert.equal(app.calls.length, 0);
  }
  const n = user();
  openCheckin(n);
  await say(app, n, "já paguei a conta hoje");
  const ask = await say(app, n, "1");
  assert.match(ask, /Quanto foi/, "aplicou como se tivesse respondido 1: agora pergunta o valor");
  assert.equal(getPendingBillCheckin(n)?.step, "ask_value");
  assert.deepEqual(pendingKinds(n), ["bill_checkin"], "a sugestao foi consumida");
  assert.equal(expensesOf(n).length, 0, "ainda nao lancou nada: o gasto so vem com o valor");

  const m = user();
  openCheckin(m);
  await say(app, m, "já paguei a conta hoje");
  assert.match(await say(app, m, "sim"), /Quanto foi/);
});

test("'2' ou 'nao' na sugestao mostra a pergunta original de novo; 3, cancelar e outra frase descartam a sugestao e seguem o fluxo da pergunta original", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  await say(app, n, "já paguei a conta hoje");
  assert.equal(await say(app, n, "2"), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);
  assert.deepEqual(pendingKinds(n), ["bill_checkin"]);
  await say(app, n, "já paguei a conta hoje");
  assert.equal(await say(app, n, "não"), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`);

  // "3": descarta a sugestao e vale para a pergunta original (pular)
  await say(app, n, "já paguei a conta hoje");
  assert.match(await say(app, n, "3"), /pulei Conta de luz neste ciclo/);
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, "2026-10");

  // outra frase: some em silencio e a mensagem segue o fluxo normal da pergunta (aqui, um pedido novo seguro)
  const m = user();
  openCheckin(m);
  await say(app, m, "já paguei a conta hoje");
  const reply = await say(app, m, "gastei 50 no mercado", { type: "expense", amount: 50, description: "mercado", category: "Mercado", date: "2026-10-14" });
  assert.match(reply, /Gasto registrado: R\$ 50,00 — mercado/);
  assert.ok(!pendingKinds(m).includes("reply_confirm"));
  assert.equal(getPendingBillCheckin(m)?.step, "ask_paid", "o aviso continua aberto");

  // "cancelar" geral limpa a sugestao junto com o resto
  const k = user();
  openCheckin(k);
  await say(app, k, "já paguei a conta hoje");
  await say(app, k, "cancelar");
  assert.ok(!pendingKinds(k).includes("reply_confirm"));
});

test("conflitos nunca viram 'pago': 'nao, ja paguei', 'sim, mas so amanha' e 'paguei metade' ficam no 'Nao entendi'; 'ainda nao deu pra pagar' vira a sugestao 2 (adiar)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  for (const phrase of ["não, já paguei", "sim, mas só amanhã", "paguei metade", "acho que paguei"]) {
    assert.equal(await say(app, n, phrase), `Não entendi 🤔 Responde *1*, *2* ou *3*:\n${LIST_DAY}`, phrase);
  }
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.equal(getBillAlertById(n, bill.id)?.snoozed_until, null);
  assert.deepEqual(pendingKinds(n), ["bill_checkin"]);

  assert.equal(await say(app, n, "ainda não deu pra pagar"), `Entendi que foi *2 ⏰ Ainda não, me lembra amanhã*. Confirma?\n${CONFIRM_TAIL}`);
  assert.match(await say(app, n, "1"), /Combinado, te lembro/);
  assert.equal(getBillAlertById(n, bill.id)?.snoozed_until, "2026-10-15");
});

test("resposta exata continua igual a hoje (sem confirmacao extra): '1', 'sim', 'ja paguei', 'um'", async (t) => {
  const app = bootApp(t, NOW);
  for (const exact of ["1", "sim", "já paguei", "um"]) {
    const n = user();
    openCheckin(n);
    assert.match(await say(app, n, exact), /Quanto foi/, exact);
    assert.deepEqual(pendingKinds(n), ["bill_checkin"], exact);
    assert.deepEqual(interpretedLogs(n), [], `${exact}: nenhum registro novo`);
  }
});

test("fila de avisos: a sugestao e sobre o aviso da vez e cita o nome da conta; confirmar fecha so esse", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n, { name: "Conta de luz", queued: ["Água"] });
  assert.equal(await say(app, n, "eu já paguei"), `Sobre *Conta de luz*: Entendi que foi *1 ✅ Já paguei*. Confirma?\n${CONFIRM_TAIL}`);
  assert.match(await say(app, n, "1"), /Quanto foi\? .*|Conta de luz/s);
  assert.equal(getPendingBillCheckin(n)?.name, "Conta de luz");
  assert.equal(getPendingBillCheckin(n)?.queued.length, 1);
});

test("a pergunta original deixa de existir antes do '1': 'Essa pergunta ja nao esta mais aberta.' e nada e aplicado em dobro", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = openCheckin(n);
  await say(app, n, "já paguei a conta hoje");
  // o aviso foi resolvido por outro caminho antes de o cliente confirmar
  db.prepare(`DELETE FROM pending_state WHERE from_number = ? AND kind = 'bill_checkin'`).run(n);
  assert.equal(await say(app, n, "1"), "Essa pergunta já não está mais aberta.");
  assert.equal(getBillAlertById(n, bill.id)?.confirmed_month, null);
  assert.deepEqual(pendingKinds(n), []);
  assert.ok(interpretedLogs(n).some((s) => s.includes("ja nao estava aberta")));
});

test("previa de edicao: 'isso mesmo, pode salvar' vira a sugestao 1 (so aplica depois do '1'); correcao embutida e o 'nao entendi' continuam como hoje", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = insertExpense({ fromNumber: n, amount: 20, description: "Almoço prévia", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  const preview = await say(app, n, "muda o almoço prévia pra 25", { type: "edit_expense", query: "almoço prévia", changes: [{ field: "amount", value: "25" }] });
  assert.match(preview, /R\$ 20,00 → R\$ 25,00/);
  assert.equal(await say(app, n, "isso mesmo, pode salvar"), `Entendi que foi *1 ✅ Confirmar*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(getExpenseById(n, exp.id)?.amount, 20, "ainda nao aplicou");
  assert.match(await say(app, n, "1"), /atualizado/);
  assert.equal(getExpenseById(n, exp.id)?.amount, 25);

  // valor embutido ("pode salvar com 30"): tem digito, entao esta camada nem entra e vale o "Nao entendi" de sempre
  const m = user();
  const other = insertExpense({ fromNumber: m, amount: 20, description: "Janta prévia", categoryId: getOrCreateCategory(m, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  await say(app, m, "muda a janta prévia pra 25", { type: "edit_expense", query: "janta prévia", changes: [{ field: "amount", value: "25" }] });
  assert.match(await say(app, m, "pode salvar com 30"), /^Não entendi 🤔 Responde \*1\* pra confirmar/);
  assert.equal(getExpenseById(m, other.id)?.amount, 20);
  assert.ok(!pendingKinds(m).includes("reply_confirm"));
  // sem vocabulario: segue o 'Nao entendi' atual
  assert.match(await say(app, m, "hmm vou pensar"), /^Não entendi 🤔 Responde \*1\* pra confirmar, \*2\* pra corrigir ou \*3\* pra cancelar\./);
});

test("apagar: 'pode apagar' vira a sugestao 1 (so apaga depois do '1'); 'acho que sim' nunca sugere apagar; no evento, 'cancelar o evento' e a confirmacao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = insertExpense({ fromNumber: n, amount: 15, description: "Café apagar", categoryId: getOrCreateCategory(n, "Mercado").id, paymentMethodId: null, date: "2026-10-14" });
  assert.match(await say(app, n, "apaga o café apagar", { type: "delete_expense", query: "café apagar" }), /Apagar este gasto\?/);
  assert.match(await say(app, n, "acho que sim"), /^Não entendi 🤔 Responde \*1\* pra apagar/);
  assert.ok(getExpenseById(n, exp.id), "nao apagou");
  assert.equal(await say(app, n, "pode apagar"), `Entendi que foi *1 🗑️ Apagar*. Confirma?\n${CONFIRM_TAIL}`);
  assert.ok(getExpenseById(n, exp.id), "ainda nao apagou");
  assert.match(await say(app, n, "sim"), /apagado|Apaguei|🗑️/i);
  assert.equal(getExpenseById(n, exp.id), null);

  const m = user();
  const ev = createEvent({ fromNumber: m, title: "Reunião apagar", start: "2026-10-20T10:00:00-03:00", end: "2026-10-20T11:00:00-03:00" });
  assert.match(await say(app, m, "cancela a reunião apagar", { type: "delete_event", query: "reunião apagar" }), /Cancelar este evento\?/);
  assert.equal(await say(app, m, "pode cancelar o evento"), `Entendi que foi *1 🗑️ Cancelar o evento*. Confirma?\n${CONFIRM_TAIL}`);
  assert.equal(await say(app, m, "não"), "Não entendi 🤔 Responde *1* pra cancelar o evento ou *3* pra manter.\nSe quer fazer outra coisa, responde *3* e me manda o pedido de novo.");
  assert.ok(getEventById(m, ev.id));
  assert.equal(await say(app, m, "melhor deixar"), `Entendi que foi *3 ↩️ Manter na agenda*. Confirma?\n${CONFIRM_TAIL}`);
  assert.match(await say(app, m, "1"), /Beleza|não mexi|manti/i);
  assert.ok(getEventById(m, ev.id), "o evento ficou");
});

test("cadastro de gasto fixo: 'pode gravar' na previa vira a sugestao 1 e confirmar segue o fluxo (pergunta do mes corrente)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const preview = await say(app, n, "todo dia 10 pago 50 de internet", { type: "set_recurring_expense", description: "Internet", amount: 50, category: "Moradia", day_of_month: 10 });
  assert.match(preview, /1 ✅ Confirmar/);
  assert.equal(await say(app, n, "pode gravar"), `Entendi que foi *1 ✅ Confirmar*. Confirma?\n${CONFIRM_TAIL}`);
  // dia 10 ja passou em 14/10: o fluxo original pergunta o mes corrente (prova de que "1" chegou ao resolvedor da previa)
  assert.match(await say(app, n, "1"), /deste mês|mês que vem/);
});

test("isolamento: a sugestao de um numero nunca aparece nem e aplicada em outro", async (t) => {
  const app = bootApp(t, NOW);
  const a = user();
  const b = user();
  openCheckin(a);
  openCheckin(b);
  await say(app, a, "já paguei a conta hoje");
  assert.deepEqual(pendingKinds(b), ["bill_checkin"]);
  assert.match(await say(app, b, "1"), /Quanto foi/);
  assert.equal(getPendingBillCheckin(a)?.step, "ask_paid");
  assert.ok(pendingKinds(a).includes("reply_confirm"));
});

test("a sugestao nao respondida expira em 10 minutos em silencio e a pergunta original segue valendo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  openCheckin(n);
  await say(app, n, "já paguei a conta hoje");
  assert.ok(pendingKinds(n).includes("reply_confirm"));
  app.advance(11 * 60 * 1000);
  assert.equal(getPendingReplyConfirm(n), null, "vencida: a leitura ja nao a enxerga");
  const reply = await say(app, n, "1");
  assert.match(reply, /Quanto foi/, "o '1' vale para a pergunta original");
  assert.ok(!/Entendi que foi/.test(reply));
});
