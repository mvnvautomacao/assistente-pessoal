// Revisao do Card 23: salvar o aviso de gasto pendente no painel so mexe no que mudou -- salvar igual ou desativar nao zera a pausa por
// inatividade; ligar de novo ou mudar o horario zera. E a pausa e registrada no log uma unica vez (marca propria, sem mexer no contador).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { onlyFor } from "../helpers/noExpenseIsolation";
import { db } from "../../src/db";
import { allowNumber } from "../../src/access/allowlist";
import {
  ensureUserSeeded,
  getNoExpenseReminderSettings,
  getNoExpenseReminderState,
  setNoExpenseReminderDays,
  setNoExpenseReminderEnabled,
  setNoExpenseReminderTime,
} from "../../src/expenses/service";
import { runNoExpenseReminderRound } from "../../src/expenses/noExpenseReminderScheduler";

let seq = 0;
function user(): string {
  const n = `55110009${String(500 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function pause(n: string) {
  setNoExpenseReminderDays([1, 3, 5]);
  const noop = async () => undefined;
  for (const day of ["2026-10-05", "2026-10-07", "2026-10-09"]) await onlyFor([n], () => runNoExpenseReminderRound(new Date(`${day}T18:30:00-03:00`), noop));
}

async function save(baseUrl: string, headers: Record<string, string>, n: string, form: Record<string, string>) {
  const res = await fetch(`${baseUrl}/dashboard/no-expense-reminder?phone=${n}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    redirect: "manual",
  });
  assert.equal(res.status, 302);
}

test("painel: salvar sem mudar nada ou desativar NAO zera a pausa; ligar de novo ou mudar o horario zera", async () => {
  const n = user();
  await pause(n);
  assert.equal(getNoExpenseReminderState(n).unanswered, 2);
  const server = await startDashboardTestServer();
  try {
    const headers = server.authHeaders(n);
    const settings = getNoExpenseReminderSettings(n);
    // salvar igual (ligado, mesmo horario)
    await save(server.baseUrl, headers, n, { enabled: "1", time: settings.time });
    assert.equal(getNoExpenseReminderState(n).unanswered, 2, "salvar sem mudar nada nao religa");
    // desativar
    await save(server.baseUrl, headers, n, { enabled: "0", time: settings.time });
    assert.equal(getNoExpenseReminderSettings(n).enabled, false);
    assert.equal(getNoExpenseReminderState(n).unanswered, 2, "desativar nao zera");
    // desativado e salvando de novo com o mesmo horario: continua igual
    await save(server.baseUrl, headers, n, { enabled: "0", time: settings.time });
    assert.equal(getNoExpenseReminderState(n).unanswered, 2);
    // ligar de novo: zera
    await save(server.baseUrl, headers, n, { enabled: "1", time: settings.time });
    assert.deepEqual(getNoExpenseReminderState(n), { unanswered: 0, lastAlertAt: null, pauseLogged: false });
    // mudar so o horario: zera
    await pause(n);
    assert.equal(getNoExpenseReminderState(n).unanswered, 2);
    await save(server.baseUrl, headers, n, { enabled: "1", time: "20:15" });
    assert.equal(getNoExpenseReminderSettings(n).time, "20:15");
    assert.equal(getNoExpenseReminderState(n).unanswered, 0);
    // horario invalido: nao muda nada
    await save(server.baseUrl, headers, n, { enabled: "1", time: "25:99" });
    assert.equal(getNoExpenseReminderSettings(n).time, "20:15");
  } finally {
    await server.close();
  }
});

test("setNoExpenseReminderTime so zera quando o horario mudou de verdade", async () => {
  const n = user();
  await pause(n);
  setNoExpenseReminderTime(n, getNoExpenseReminderSettings(n).time);
  assert.equal(getNoExpenseReminderState(n).unanswered, 2, "mesmo horario: nada muda");
  setNoExpenseReminderTime(n, "19:45");
  assert.equal(getNoExpenseReminderState(n).unanswered, 0);
});

test("a pausa e logada uma vez com a marca propria; o contador fica exato (2) e religar limpa a marca", async () => {
  const n = user();
  await pause(n);
  const state = getNoExpenseReminderState(n);
  assert.deepEqual([state.unanswered, state.pauseLogged], [2, true], "contador exato, sem valor especial");
  const noop = async () => undefined;
  await onlyFor([n], () => runNoExpenseReminderRound(new Date("2026-10-12T18:30:00-03:00"), noop));
  await onlyFor([n], () => runNoExpenseReminderRound(new Date("2026-10-14T18:30:00-03:00"), noop));
  const logs = db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE from_number = ? AND type = 'no_expense_reminder'`).get(n) as { n: number };
  assert.equal(logs.n, 1);
  setNoExpenseReminderEnabled(n, true);
  assert.deepEqual(getNoExpenseReminderState(n), { unanswered: 0, lastAlertAt: null, pauseLogged: false });
});
