// Card 23: o cliente pausado so perde o aviso de "sem gastos" -- relatorios e pedidos dele seguem normais, pedir o aviso de novo religa,
// e o /admin mostra o status por numero.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { startAdminTestServer } from "../helpers/app";
import { db } from "../../src/db";
import { allowNumber } from "../../src/access/allowlist";
import {
  ensureUserSeeded,
  getNoExpenseReminderState,
  getNoExpenseReminderStatuses,
  noExpenseStatusLabel,
  setNoExpenseReminderDays,
  setNoExpenseReminderEnabled,
  setReportDayOfWeek,
} from "../../src/expenses/service";
import { runNoExpenseReminderRound } from "../../src/expenses/noExpenseReminderScheduler";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-23T10:00:00-03:00"); // sexta

let seq = 0;
function user(): string {
  const n = `55110009${String(400 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

// deixa o numero pausado por inatividade (2 avisos enviados, sem nenhum registro depois)
async function pause(n: string) {
  setNoExpenseReminderDays([1, 3, 5]);
  const sent: string[] = [];
  const send = async (to: string, text: string) => void (to === n && sent.push(text));
  await runNoExpenseReminderRound(new Date("2026-10-05T18:30:00-03:00"), send, [n]);
  await runNoExpenseReminderRound(new Date("2026-10-07T18:30:00-03:00"), send, [n]);
  await runNoExpenseReminderRound(new Date("2026-10-09T18:30:00-03:00"), send, [n]);
  assert.equal(sent.length, 2);
  assert.ok(getNoExpenseReminderState(n).unanswered >= 2);
}

async function ask(app: BotApp, n: string, text: string, action: Interpretation) {
  app.queueReply([action]);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("'ativa o aviso de gasto pendente de novo' e 'muda o horario' religam um cliente pausado (contador e horario do ultimo aviso zerados)", async (t) => {
  const app = bootApp(t, NOW);
  const a = user();
  const b = user();
  await pause(a);
  await pause(b);
  const reply = await ask(app, a, "ativa o aviso de gasto pendente de novo", { type: "set_no_expense_reminder", enabled: true });
  assert.match(reply, /Combinado! Se você não registrar nenhum gasto até 18:30, eu te aviso\./);
  assert.deepEqual(getNoExpenseReminderState(a), { unanswered: 0, lastAlertAt: null });
  await ask(app, b, "muda o horário do aviso de gasto pra 20h", { type: "set_no_expense_reminder", time: "20:00" });
  assert.deepEqual(getNoExpenseReminderState(b), { unanswered: 0, lastAlertAt: null });
  // e o aviso volta: no proximo dia de aviso depois das 18:30 o cliente recebe de novo
  const sent: string[] = [];
  await runNoExpenseReminderRound(new Date("2026-10-12T18:30:00-03:00"), async (to, text) => void (to === a && sent.push(text)), [a]);
  assert.equal(sent.length, 1);
});

test("desativar o aviso nao muda o contador; o cliente pausado continua pedindo e recebendo o resto normalmente", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  await pause(n);
  await ask(app, n, "desativa o aviso de gasto pendente", { type: "set_no_expense_reminder", enabled: false });
  assert.ok(getNoExpenseReminderState(n).unanswered >= 2, "desligar nao zera");
  // um pedido qualquer segue funcionando (e registrar um gasto e atividade)
  const reply = await ask(app, n, "gastei 30 no mercado", { type: "expense", amount: 30, description: "mercado", category: "Mercado", payment_method: "Pix" });
  assert.match(reply, /Gasto registrado: R\$ 30,00/);
});

test("relatorios semanal e mensal continuam chegando ao cliente pausado quando ha gasto no periodo, e continuam em silencio sem gasto", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  await pause(n);
  setNoExpenseReminderEnabled(n, false);
  setReportDayOfWeek(n, 5);
  const reports = require("../../src/expenses/reportScheduler") as typeof import("../../src/expenses/reportScheduler");
  const before = app.sent.length;
  const ctx = { runDate: "2026-10-23", today: "2026-10-23", now: new Date(NOW) };
  await reports.weeklyReportJob.run(ctx);
  assert.equal(app.sent.slice(before).filter((m) => m.to === n).length, 0, "sem gasto na semana: silencio, como antes");

  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at) VALUES (?, 80, 'mercado', NULL, NULL, '2026-10-20', '2026-10-20T15:00:00.000Z')`).run(n);
  await reports.weeklyReportJob.run(ctx);
  const weekly = app.sent.slice(before).filter((m) => m.to === n);
  assert.equal(weekly.length, 1);
  assert.match(weekly[0].text, /Total: R\$ 80,00/);

  const lastDay = { runDate: "2026-10-31", today: "2026-10-31", now: new Date(at("2026-10-31T18:00:00-03:00")) };
  const beforeMonthly = app.sent.length;
  await reports.monthlyReportJob.run(lastDay);
  assert.equal(app.sent.slice(beforeMonthly).filter((m) => m.to === n).length, 1);
});

test("/admin: a coluna do aviso mostra ativo, N de 2 avisos sem registro, pausado por inatividade e desligado", async () => {
  const ativo = user();
  const um = user();
  const pausado = user();
  const desligado = user();
  setNoExpenseReminderDays([1, 3, 5]);
  const noop = async () => undefined;
  await runNoExpenseReminderRound(new Date("2026-10-05T18:30:00-03:00"), noop, [ativo, um, pausado, desligado]); // todos recebem o 1o
  db.prepare(`UPDATE user_settings SET no_expense_unanswered = 0, no_expense_last_alert_at = NULL WHERE from_number = ?`).run(ativo);
  db.prepare(`UPDATE user_settings SET no_expense_unanswered = 2 WHERE from_number = ?`).run(pausado);
  setNoExpenseReminderEnabled(desligado, false);
  assert.equal(noExpenseStatusLabel(getNoExpenseReminderStatuses().get(ativo)), "ativo");
  assert.equal(noExpenseStatusLabel(getNoExpenseReminderStatuses().get(um)), "1 de 2 avisos sem registro");
  const server = await startAdminTestServer();
  try {
    const html = await (await fetch(`${server.baseUrl}/admin`, { headers: server.authHeaders!() })).text();
    const rowOf = (n: string) => html.slice(html.lastIndexOf(`<td>${n}</td>`), html.indexOf("</tr>", html.lastIndexOf(`<td>${n}</td>`)));
    assert.match(html, /<th[^>]*>Aviso de gasto pendente<\/th>/);
    assert.match(rowOf(ativo), /<td>ativo<\/td>/);
    assert.match(rowOf(um), /<td>1 de 2 avisos sem registro<\/td>/);
    assert.match(rowOf(pausado), /<td>pausado por inatividade<\/td>/);
    assert.match(rowOf(desligado), /<td>desligado<\/td>/);
  } finally {
    await server.close();
  }
});

test("noExpenseStatusLabel: sem linha de configuracao vale como ativo; contador acima de 2 (pausa ja registrada) tambem e pausado", () => {
  assert.equal(noExpenseStatusLabel(undefined), "ativo");
  assert.equal(noExpenseStatusLabel({ enabled: true, unanswered: 3 }), "pausado por inatividade");
  assert.equal(noExpenseStatusLabel({ enabled: false, unanswered: 2 }), "desligado");
  assert.equal(noExpenseStatusLabel({ enabled: true, unanswered: 0 }), "ativo");
});

test("ajuda por assunto 'no_expense_reminder' explica a regra dos 2 avisos e como voltar", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const reply = await ask(app, n, "por que parou de me avisar dos gastos", { type: "help", topic: "no_expense_reminder" });
  assert.match(reply, /no máximo 2 avisos seguidos/);
  assert.match(reply, /ativa o aviso de gasto pendente/);
  assert.match(reply, /relatórios da semana e do mês/);
});
