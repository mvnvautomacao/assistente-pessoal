// Card 23: o aviso "voce nao registrou nenhum gasto" para depois de 2 envios sem nenhum registro do cliente e volta quando ele volta a registrar.
// Relogio simulado: a rodada do agendador recebe o "agora". As linhas de gasto e entrada entram direto no banco com created_at explicito
// (o created_at de verdade usa o relogio real, que nao e o simulado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { allowNumber } from "../../src/access/allowlist";
import {
  ensureUserSeeded,
  getNoExpenseReminderDays,
  getNoExpenseReminderSettings,
  setNoExpenseReminderDays,
  setNoExpenseReminderEnabled,
  setNoExpenseReminderTime,
} from "../../src/expenses/service";
import { buildReminderMessage, NO_EXPENSE_MAX_UNANSWERED, runNoExpenseReminderRound } from "../../src/expenses/noExpenseReminderScheduler";
import { onlyFor } from "../helpers/noExpenseIsolation";

const at = (iso: string) => new Date(iso);

let seq = 0;
function user(): string {
  const n = `55110009${String(300 + seq++)}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

interface Sent {
  to: string;
  text: string;
}

// uma rodada as 18:30 de um dia; devolve o que foi enviado a este numero
async function round(n: string, day: string, hhmm = "18:30", options: { fail?: boolean } = {}): Promise<string[]> {
  const sent: Sent[] = [];
  // so este cliente: os outros testes deixam assinantes no mesmo banco
  await onlyFor([n], () =>
    runNoExpenseReminderRound(at(`${day}T${hhmm}:00-03:00`), async (to, text) => {
      if (options.fail) throw new Error("Evolution fora do ar");
      sent.push({ to, text });
    })
  );
  return sent.filter((s) => s.to === n).map((s) => s.text);
}

function addExpense(n: string, createdAtIso: string, extra: { date?: string; fixedSource?: string | null } = {}) {
  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at, fixed_source) VALUES (?, 10, 'x', NULL, NULL, ?, ?, ?)`).run(
    n,
    extra.date ?? createdAtIso.slice(0, 10),
    createdAtIso,
    extra.fixedSource ?? null
  );
}

function addIncome(n: string, createdAt: string) {
  db.prepare(`INSERT INTO incomes (from_number, amount, description, date, created_at) VALUES (?, 100, 'x', ?, ?)`).run(n, createdAt.slice(0, 10), createdAt);
}

const state = (n: string) =>
  db.prepare(
    `SELECT no_expense_unanswered AS unanswered, no_expense_last_alert_at AS last, no_expense_reminder_sent_date AS sentDate, no_expense_pause_logged AS pauseLogged FROM user_settings WHERE from_number = ?`
  ).get(n) as {
    unanswered: number;
    last: string | null;
    sentDate: string | null;
    pauseLogged: number;
  };

// segunda, quarta e sexta (padrao do aviso) de tres semanas seguidas de outubro/2026
const THREE_WEEKS = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-23"];

test("REPRODUCAO: cliente que parou de usar recebia o aviso 3 vezes por semana para sempre (9 avisos em 3 semanas); agora para no 2o", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  let total = 0;
  for (const day of THREE_WEEKS) total += (await round(n, day)).length;
  assert.equal(total, NO_EXPENSE_MAX_UNANSWERED, "so 2 avisos em 3 semanas sem nenhum registro");
});

test("o 2o aviso traz a linha de 'ultimo aviso desse tipo' no lugar da frase dos dias da semana; o 1o continua igual", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  const [first] = await round(n, "2026-10-05");
  const [second] = await round(n, "2026-10-07");
  assert.equal(first, buildReminderMessage("18:30", false));
  assert.match(first, /Esse aviso pode vir em alguns dias da semana às 18:30/);
  assert.doesNotMatch(first, /último aviso/);
  assert.equal(second, buildReminderMessage("18:30", true));
  assert.match(second, /Esse é o último aviso desse tipo: se você não registrar nada, eu paro de mandar\. Quando quiser voltar, é só me contar um gasto\. 🙂$/);
  assert.doesNotMatch(second, /Esse aviso pode vir em alguns dias/);
  assert.equal(buildReminderMessage("20:00", false).includes("às 20:00"), true);
});

test("a pausa e registrada no log uma unica vez e o dia fica resolvido; nada e enviado no 3o dia nem nos seguintes", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  await round(n, "2026-10-05");
  await round(n, "2026-10-07");
  assert.deepEqual(await round(n, "2026-10-09"), []);
  assert.equal(state(n).sentDate, "2026-10-09", "RN07: o dia fica resolvido");
  assert.deepEqual(await round(n, "2026-10-12"), []);
  assert.deepEqual(await round(n, "2026-10-14"), []);
  const logs = db.prepare(`SELECT summary FROM activity_log WHERE from_number = ? AND type = 'no_expense_reminder'`).all(n) as { summary: string }[];
  assert.deepEqual(logs.map((l) => l.summary), ["cliente pausado por inatividade (2 avisos sem registro)"]);
});

test("registro entre os dois avisos zera o contador: o cliente continua recebendo normalmente", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  assert.equal((await round(n, "2026-10-05")).length, 1);
  addExpense(n, "2026-10-06T12:00:00.000Z"); // depois do aviso de 05/10 18:30 (21:30Z)
  const second = await round(n, "2026-10-07");
  assert.equal(second.length, 1);
  assert.doesNotMatch(second[0], /último aviso/, "o contador voltou a 0: este e de novo o 1o aviso");
  assert.equal(state(n).unanswered, 1);
  const third = await round(n, "2026-10-09");
  assert.match(third[0], /último aviso desse tipo/, "recomecou a contar: o 2o desde o registro e o ultimo");
  assert.deepEqual(await round(n, "2026-10-12"), [], "e so depois dele pausa");
});

test("cliente pausado que registra um gasto (mesmo com data antiga) ou uma entrada volta ao ritmo normal", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const comGasto = user();
  const comEntrada = user();
  for (const n of [comGasto, comEntrada]) {
    await round(n, "2026-10-05");
    await round(n, "2026-10-07");
    assert.deepEqual(await round(n, "2026-10-09"), [], "pausado");
  }
  addExpense(comGasto, "2026-10-10T15:00:00.000Z", { date: "2026-09-01" }); // lancou hoje um gasto de setembro: conta
  addIncome(comEntrada, "2026-10-10 15:00:00"); // formato do SQLite (RN03)
  assert.equal((await round(comGasto, "2026-10-12")).length, 1);
  assert.equal((await round(comEntrada, "2026-10-12")).length, 1);
  assert.equal(state(comGasto).unanswered, 1);
  assert.equal(state(comEntrada).unanswered, 1);
});

test("gasto lancado sozinho pelo gasto fixo NAO conta como atividade; o confirmado pelo cliente numa conta fixa conta", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  await round(n, "2026-10-05");
  await round(n, "2026-10-07");
  addExpense(n, "2026-10-08T10:00:00.000Z", { fixedSource: "recurring" });
  assert.deepEqual(await round(n, "2026-10-09"), [], "o gasto fixo automatico nao tira o cliente da pausa");
  addExpense(n, "2026-10-10T10:00:00.000Z", { fixedSource: "bill_alert" }); // o cliente respondeu 1 e informou o valor
  assert.equal((await round(n, "2026-10-12")).length, 1);
});

test("os formatos de created_at (ISO e SQLite) sao comparados do mesmo jeito: registro ANTES do aviso nao conta", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  addExpense(n, "2026-10-04T10:00:00.000Z"); // antes do 1o aviso
  addIncome(n, "2026-10-04 10:00:00");
  await round(n, "2026-10-05");
  await round(n, "2026-10-07");
  assert.deepEqual(await round(n, "2026-10-09"), [], "registros antigos nao contam como atividade depois do aviso");
});

test("ligar o aviso de novo ou mudar o horario zera o contador e o horario do ultimo aviso; desligar nao", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  await round(n, "2026-10-05");
  await round(n, "2026-10-07");
  assert.equal(state(n).unanswered, 2);
  setNoExpenseReminderEnabled(n, false);
  assert.equal(state(n).unanswered, 2, "desligar nao zera");
  setNoExpenseReminderEnabled(n, true);
  assert.deepEqual([state(n).unanswered, state(n).last], [0, null]);
  assert.equal((await round(n, "2026-10-12")).length, 1);
  assert.equal(state(n).unanswered, 1);
  setNoExpenseReminderTime(n, "20:00");
  assert.deepEqual([state(n).unanswered, state(n).last], [0, null]);
  assert.equal(getNoExpenseReminderSettings(n).time, "20:00");
});

test("falha de envio: o contador nao avanca e o dia nao fica resolvido (tenta no minuto seguinte)", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    assert.deepEqual(await round(n, "2026-10-05", "18:30", { fail: true }), []);
  } finally {
    console.error = original;
  }
  assert.deepEqual([state(n).unanswered, state(n).last], [0, null]);
  assert.notEqual(state(n).sentDate, "2026-10-05");
  assert.equal((await round(n, "2026-10-05", "18:31")).length, 1, "no minuto seguinte envia");
  assert.equal(state(n).unanswered, 1);
});

test("aviso desligado, dia fora dos dias configurados e antes do horario: nada muda", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const off = user();
  setNoExpenseReminderEnabled(off, false);
  assert.deepEqual(await round(off, "2026-10-05"), []);
  assert.equal(state(off).unanswered, 0);
  const n = user();
  assert.deepEqual(await round(n, "2026-10-06"), [], "terca nao e dia de aviso");
  assert.deepEqual(await round(n, "2026-10-05", "18:29"), [], "antes do horario");
  assert.deepEqual([state(n).unanswered, state(n).last], [0, null]);
  assert.deepEqual(getNoExpenseReminderDays(), [1, 3, 5]);
});

test("horario do ultimo aviso no futuro (relogio ajustado) nao da erro e conta como sem atividade; clientes sao independentes", async () => {
  setNoExpenseReminderDays([1, 3, 5]);
  const a = user();
  const b = user();
  db.prepare(`UPDATE user_settings SET no_expense_unanswered = 2, no_expense_last_alert_at = '2099-01-01T00:00:00.000Z' WHERE from_number = ?`).run(a);
  addExpense(a, "2026-10-04T10:00:00.000Z");
  assert.deepEqual(await round(a, "2026-10-05"), []);
  assert.equal((await round(b, "2026-10-05")).length, 1, "o outro cliente nao e afetado");
  assert.equal(state(b).unanswered, 1);
  assert.equal(state(a).unanswered > 0, true);
});

test("cliente que ja registrou um gasto hoje nao e avisado e o dia fica resolvido; o cron roda a cada minuto no fuso de Sao Paulo", async (t) => {
  setNoExpenseReminderDays([1, 3, 5]);
  const n = user();
  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at) VALUES (?, 10, 'x', NULL, NULL, '2026-10-05', '2026-10-05T12:00:00.000Z')`).run(n);
  assert.deepEqual(await round(n, "2026-10-05"), []);
  assert.equal(state(n).sentDate, "2026-10-05");
  assert.equal(state(n).unanswered, 0);

  // o cron: uma chamada de schedule, "* * * * *", fuso SP
  const cronModule = require("node-cron") as { schedule: (expr: string, fn: () => void, opts: { timezone: string }) => unknown };
  const calls: { expr: string; fn: () => void; opts: { timezone: string } }[] = [];
  t.mock.method(cronModule, "schedule", (expr: string, fn: () => void, opts: { timezone: string }) => void calls.push({ expr, fn, opts }));
  const { startNoExpenseReminderScheduler } = require("../../src/expenses/noExpenseReminderScheduler") as typeof import("../../src/expenses/noExpenseReminderScheduler");
  startNoExpenseReminderScheduler();
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].expr, calls[0].opts.timezone], ["* * * * *", "America/Sao_Paulo"]);
  assert.equal(typeof calls[0].fn, "function"); // o callback nao e chamado aqui: ele mandaria de verdade pela rede
});
