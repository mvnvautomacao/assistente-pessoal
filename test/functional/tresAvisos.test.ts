// Card 21, parte 2: no maximo 3 avisos sem resposta nas contas fixas; depois o ciclo fecha em silencio (sem lancar gasto) e soma a recorrencia.
// Relogio simulado: a rotina "alertas_conta" roda no executor diario com o "agora" injetado.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso).getTime();

let seq = 0;
function user(): string {
  const n = `55110008500${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

// o bootApp recarrega src: tudo que o roteador compartilha com as rotinas precisa vir da MESMA instancia (require depois dele)
function mods() {
  return {
    daily: require("../../src/scheduler/dailyJobs") as typeof import("../../src/scheduler/dailyJobs"),
    runs: require("../../src/scheduler/jobRuns") as typeof import("../../src/scheduler/jobRuns"),
    billScheduler: require("../../src/bills/scheduler") as typeof import("../../src/bills/scheduler"),
    billService: require("../../src/bills/service") as typeof import("../../src/bills/service"),
    checkin: require("../../src/bills/pendingCheckin") as typeof import("../../src/bills/pendingCheckin"),
  };
}

function setup(t: TestContext) {
  const app = bootApp(t, at("2026-12-01T07:00:00-03:00"));
  const m = mods();
  db.exec(`UPDATE bill_alerts SET active = 0`);
  m.runs.resetJobRunsForTests();
  m.daily.resetDailyJobsForTests();
  m.billScheduler.startBillAlertScheduler();
  return { app, m };
}

// roda a rotina das 8h do dia (e posiciona o relogio do bot no mesmo instante, pro TTL das pendencias)
async function morning(app: BotApp, m: ReturnType<typeof mods>, day: string) {
  const now = at(`${day}T08:00:00-03:00`);
  app.setNow(now);
  return m.daily.runDueDailyJobs(new Date(now));
}

function alert(m: ReturnType<typeof mods>, n: string, name: string, over: { dayOfMonth?: number; intervalDays?: number; nextDue?: string } = {}) {
  const bill = over.intervalDays ? m.billService.createBillAlert({ fromNumber: n, name, intervalDays: over.intervalDays }) : m.billService.createBillAlert({ fromNumber: n, name, dayOfMonth: over.dayOfMonth ?? 10 });
  db.prepare(`UPDATE bill_alerts SET created_at = '2026-01-01 12:00:00' WHERE id = ?`).run(bill.id);
  if (over.nextDue) db.prepare(`UPDATE bill_alerts SET next_due_date = ? WHERE id = ?`).run(over.nextDue, bill.id);
  return bill;
}

const row = (id: number) => db.prepare(`SELECT unanswered_asks, asks_cycle, next_due_date, confirmed_month, snoozed_until FROM bill_alerts WHERE id = ?`).get(id) as {
  unanswered_asks: number;
  asks_cycle: string | null;
  next_due_date: string | null;
  confirmed_month: string | null;
  snoozed_until: string | null;
};
const textsTo = (app: BotApp, n: string) => app.sent.filter((s) => s.to === n).map((s) => s.text);
const expensesOf = (n: string) => (db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE from_number = ?`).get(n) as { c: number }).c;
const LAST_LINE = (next: string) => `⚠️ Último aviso: se eu não tiver resposta, considero resolvido (sem lançar gasto) e te aviso de novo ${next}.`;

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("Card 21 (reproducao + regra): alerta por intervalo sem resposta -- avisos em 3 dias seguidos, o 3o com 'Ultimo aviso'; no 4o dia fecha em silencio e soma 45 dias", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Ração", { intervalDays: 45, nextDue: "2026-12-01" });
  const base = "📌 Hora de: Ração.\n1 ✅ Já resolvi\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou fazer agora (pular)";

  await morning(app, m, "2026-12-01");
  await morning(app, m, "2026-12-02");
  await morning(app, m, "2026-12-03");
  assert.deepEqual(textsTo(app, n), [base, base, `${base}\n${LAST_LINE("daqui a 45 dias")}`]);

  const sentBefore = app.sent.length;
  const out = await morning(app, m, "2026-12-04");
  assert.equal(app.sent.length, sentBefore, "no 4o dia nenhuma mensagem");
  assert.deepEqual(out.map((s) => [s.job, s.status, s.items]), [["alertas_conta", "done", 1]], "o fechamento conta como item da rotina");
  const closed = row(bill.id);
  assert.equal(closed.next_due_date, "2027-01-18", "04/12 + 45 dias");
  assert.equal(closed.unanswered_asks, 0);
  assert.equal(closed.snoozed_until, null);
  assert.equal(expensesOf(n), 0, "o fechamento nao lanca gasto");
  const log = db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = 'bill_alert' AND summary LIKE 'fechado sem resposta%'`).all(n) as { summary: string }[];
  assert.deepEqual(log.map((l) => l.summary), ["fechado sem resposta apos 3 avisos: Ração"]);

  await morning(app, m, "2026-12-05");
  await morning(app, m, "2027-01-17");
  assert.equal(app.sent.length, sentBefore, "ate o proximo vencimento nada");
  await morning(app, m, "2027-01-18");
  assert.equal(textsTo(app, n).length, 4, "no novo ciclo volta a avisar");
  assert.ok(!textsTo(app, n)[3].includes("Último aviso"), "e recomeca no aviso 1");
});

test("Card 21: alerta por dia do mes (dia 10) -- avisos em 10, 11 e 12; em 13 fecha o ciclo de novembro; proximo aviso em 10/12", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  const list = "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)";
  for (const day of ["2026-11-10", "2026-11-11", "2026-11-12"]) await morning(app, m, day);
  assert.deepEqual(textsTo(app, n), [
    `📌 Hoje é dia de pagar: Luz.\n${list}`,
    `📌 Hoje é dia de pagar: Luz.\n${list}`,
    `📌 Hoje é dia de pagar: Luz.\n${list}\n${LAST_LINE("mês que vem, no dia certo")}`,
  ]);
  const before = app.sent.length;
  await morning(app, m, "2026-11-13");
  assert.equal(app.sent.length, before);
  assert.equal(row(bill.id).confirmed_month, "2026-11");
  assert.equal(expensesOf(n), 0);
  await morning(app, m, "2026-11-14");
  await morning(app, m, "2026-12-09");
  assert.equal(app.sent.length, before);
  await morning(app, m, "2026-12-10");
  assert.equal(textsTo(app, n).length, 4);
  assert.match(textsTo(app, n)[3], /^📌 Hoje é dia de pagar: Luz\.\n1 ✅/);
});

test("Card 21: aviso 1 atrasado pela recuperacao ('vencia dia 10') conta como o aviso 1; os dois seguintes vem em dias consecutivos", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  await morning(app, m, "2026-11-12");
  assert.match(textsTo(app, n)[0], /^📌 Hoje é dia de pagar: Luz \(atrasado: vencia dia 10\)\./);
  assert.equal(row(bill.id).unanswered_asks, 1);
  await morning(app, m, "2026-11-13");
  await morning(app, m, "2026-11-14");
  assert.equal(textsTo(app, n).length, 3);
  assert.ok(textsTo(app, n)[2].includes("Último aviso"));
  assert.ok(!textsTo(app, n)[1].includes("atrasado"), "os seguintes nao sao 'atrasados': foram pedidos pela soneca");
  await morning(app, m, "2026-11-15");
  assert.equal(textsTo(app, n).length, 3);
  assert.equal(row(bill.id).confirmed_month, "2026-11");
});

test("Card 21: resposta '2' (ainda nao) zera o contador -- a contagem recomeca no proximo aviso", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  await morning(app, m, "2026-11-10");
  await morning(app, m, "2026-11-11");
  assert.equal(row(bill.id).unanswered_asks, 2);
  assert.match(await say(app, n, "2"), /Combinado, te lembro de "Luz" amanhã de novo\./);
  assert.equal(row(bill.id).unanswered_asks, 0);
  await morning(app, m, "2026-11-12");
  await morning(app, m, "2026-11-13");
  await morning(app, m, "2026-11-14");
  assert.equal(row(bill.id).unanswered_asks, 3);
  assert.ok(textsTo(app, n).at(-1)!.includes("Último aviso"), "o ultimo aviso so chega no 3o contado depois da resposta");
  const before = app.sent.length;
  await morning(app, m, "2026-11-15");
  assert.equal(app.sent.length, before);
  assert.equal(row(bill.id).confirmed_month, "2026-11");
});

test("Card 21: resposta '1' (paguei, sem valor ainda) zera o contador e o alerta volta a perguntar no dia seguinte", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  await morning(app, m, "2026-11-10");
  await morning(app, m, "2026-11-11");
  assert.match(await say(app, n, "1"), /Quanto foi/i);
  assert.equal(row(bill.id).unanswered_asks, 0);
  await morning(app, m, "2026-11-12");
  assert.equal(row(bill.id).unanswered_asks, 1, "o valor nunca veio: pergunta de novo e conta a partir de 1");
});

test("Card 21: resposta nao entendida NAO zera o contador", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  await morning(app, m, "2026-11-10");
  await morning(app, m, "2026-11-11");
  await say(app, n, "talvez depois");
  assert.equal(row(bill.id).unanswered_asks, 2);
});

test("Card 21: editar o alerta no meio dos avisos zera o contador; o fechamento nao acontece", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  for (const day of ["2026-11-10", "2026-11-11", "2026-11-12"]) await morning(app, m, day);
  assert.equal(row(bill.id).unanswered_asks, 3);
  m.billService.updateBillAlert(n, bill.id, { name: "Energia" });
  assert.equal(row(bill.id).unanswered_asks, 0);
  assert.equal(row(bill.id).asks_cycle, null);
});

test("Card 21: a chave do ciclo muda (novo mes) -- o contador recomeca em 0 antes de contar o aviso", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 3, asks_cycle = '2026-10-10', last_asked_date = '2026-10-12' WHERE id = ?`).run(bill.id);
  await morning(app, m, "2026-11-10");
  assert.equal(textsTo(app, n).length, 1, "ciclo novo: avisa normalmente, nao fecha");
  const r = row(bill.id);
  assert.deepEqual([r.unanswered_asks, r.asks_cycle], [1, "2026-11-10"]);
});

test("Card 21: Evolution fora -- o contador so avanca se o envio deu certo e a retentativa nao conta em dobro", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Luz", { dayOfMonth: 10 });
  const client = require("../../src/whatsapp/client");
  const original = client.sendText;
  let fail = true;
  t.mock.method(client, "sendText", async (to: string, text: string) => {
    if (fail) throw new Error("Evolution fora do ar (simulado)");
    return original(to, text);
  });
  const silence = console.error;
  console.error = () => {};
  try {
    const first = await morning(app, m, "2026-11-10");
    assert.deepEqual(first.map((s) => s.status), ["failed"]);
    assert.equal(row(bill.id).unanswered_asks, 0);
    fail = false;
    app.setNow(at("2026-11-10T08:01:00-03:00"));
    const retry = await m.daily.runDueDailyJobs(new Date(at("2026-11-10T08:01:00-03:00")));
    assert.deepEqual(retry.map((s) => s.status), ["done"]);
  } finally {
    console.error = silence;
  }
  assert.equal(row(bill.id).unanswered_asks, 1);
  assert.equal(textsTo(app, n).length, 1);
  await m.daily.runDueDailyJobs(new Date(at("2026-11-10T08:02:00-03:00")));
  assert.equal(row(bill.id).unanswered_asks, 1, "rodar de novo no mesmo dia nao soma");
});

test("Card 21: fechar o ciclo e idempotente -- rodar a rotina duas vezes no dia nao soma a recorrencia em dobro", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const bill = alert(m, n, "Racao", { intervalDays: 45, nextDue: "2026-12-01" });
  for (const day of ["2026-12-01", "2026-12-02", "2026-12-03"]) await morning(app, m, day);
  const today = "2026-12-04";
  await m.billScheduler.billAlertJob.run({ runDate: today, today, now: new Date(at(`${today}T08:00:00-03:00`)) });
  const first = row(bill.id).next_due_date;
  await m.billScheduler.billAlertJob.run({ runDate: today, today, now: new Date(at(`${today}T08:00:30-03:00`)) });
  assert.equal(row(bill.id).next_due_date, first);
  assert.equal(first, "2027-01-18");
});

test("Card 21: alerta que fecha sozinho sai da fila de check-in (o da vez passa pro proximo; o da fila e retirado)", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const a = alert(m, n, "Alerta A", { dayOfMonth: 10 });
  const b = alert(m, n, "Alerta B", { dayOfMonth: 10 });
  const c = alert(m, n, "Alerta C", { dayOfMonth: 10 });
  for (const day of ["2026-11-10", "2026-11-11", "2026-11-12"]) await morning(app, m, day);
  // fila armada de manhazinha no dia 13: A e a da vez, B e C esperam
  app.setNow(at("2026-11-13T07:00:00-03:00"));
  m.checkin.clearPendingBillCheckin(n);
  const item = (bill: { id: number; name: string }) => ({ billAlertId: bill.id, name: bill.name, recurrenceType: "day_of_month" as const, intervalDays: null });
  m.checkin.setPendingBillCheckin(n, { ...item(a), queued: [item(b), item(c)] });
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 1, asks_cycle = '2026-11-10' WHERE id = ?`).run(c.id); // C ainda tem aviso pela frente
  await m.daily.runDueDailyJobs(new Date(at("2026-11-13T08:00:00-03:00")));
  const pending = m.checkin.getPendingBillCheckin(n);
  assert.equal(pending?.billAlertId, c.id, "A e B fecharam; C (que nao fechou) e a da vez");
  assert.deepEqual(pending?.queued, []);
  assert.equal(row(a.id).confirmed_month, "2026-11");
  assert.equal(row(b.id).confirmed_month, "2026-11");
});

test("Card 21: dois alertas no mesmo dia tem contadores proprios; outro numero nao e afetado", async (t) => {
  const { app, m } = setup(t);
  const n = user();
  const other = user();
  const x = alert(m, n, "X", { dayOfMonth: 10 });
  const y = alert(m, n, "Y", { dayOfMonth: 11 });
  const z = alert(m, other, "Z", { dayOfMonth: 10 });
  await morning(app, m, "2026-11-10");
  await morning(app, m, "2026-11-11");
  assert.deepEqual([row(x.id).unanswered_asks, row(y.id).unanswered_asks, row(z.id).unanswered_asks], [2, 1, 2]);
  assert.equal((await say(app, other, "2")).startsWith("Combinado"), true);
  assert.deepEqual([row(x.id).unanswered_asks, row(z.id).unanswered_asks], [2, 0]);
});
