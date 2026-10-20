// Media mensal de mensagens (cliente + bot) por numero: contagem por mes (SP), media desde o primeiro registro e o texto da celula do /admin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { currentMonthKey, formatAverage, getMessageStats, monthsSpan, recordMessage, renderMessageAverageCell } from "../../src/activity/messageCounts";
import { sendText } from "../../src/whatsapp/client";
import { blockNumber, unblockNumber } from "../../src/access/blocklist";

const A = "551100090001";
const B = "551100090002";
const NOW = new Date("2026-10-20T12:00:00-03:00");

const row = (n: string, month: string) => db.prepare(`SELECT inbound, outbound FROM message_counts WHERE from_number = ? AND month = ?`).get(n, month) as { inbound: number; outbound: number } | undefined;

test("recordMessage: soma 1 por mensagem no mes (SP) certo, separando cliente e bot; virada de mes comeca outra linha", () => {
  recordMessage(A, "inbound", NOW);
  recordMessage(A, "inbound", NOW);
  recordMessage(A, "outbound", NOW);
  assert.deepEqual({ ...row(A, "2026-10") }, { inbound: 2, outbound: 1 });
  // 31/10 23:30 em SP ainda e outubro (02:30 UTC de 1/11); 01/11 00:30 em SP ja e novembro
  recordMessage(A, "inbound", new Date("2026-10-31T23:30:00-03:00"));
  recordMessage(A, "inbound", new Date("2026-11-01T00:30:00-03:00"));
  assert.equal(row(A, "2026-10")?.inbound, 3);
  assert.equal(row(A, "2026-11")?.inbound, 1);
  assert.equal(currentMonthKey(new Date("2026-10-31T23:30:00-03:00")), "2026-10");
});

test("monthsSpan: conta os dois extremos, cruza ano e nunca passa de 1 pra baixo", () => {
  assert.equal(monthsSpan("2026-10", "2026-10"), 1);
  assert.equal(monthsSpan("2026-08", "2026-10"), 3);
  assert.equal(monthsSpan("2025-11", "2026-02"), 4);
  assert.equal(monthsSpan("2026-12", "2026-10"), 1);
});

test("getMessageStats: media = total / meses desde o primeiro registro ate o mes atual; numero sem registro nao aparece", () => {
  db.prepare(`DELETE FROM message_counts WHERE from_number = ?`).run(B);
  const insert = db.prepare(`INSERT INTO message_counts (from_number, month, inbound, outbound) VALUES (?, ?, ?, ?)`);
  insert.run(B, "2026-08", 30, 40);
  insert.run(B, "2026-10", 20, 10); // setembro sem mensagem: o mes ainda conta na divisao
  const stats = getMessageStats(NOW).get(B)!;
  assert.deepEqual([stats.inbound, stats.outbound, stats.months], [50, 50, 3]);
  assert.equal(stats.avgTotal, 100 / 3);
  assert.equal(stats.avgInbound, 50 / 3);
  assert.equal(getMessageStats(NOW).get("551100090999"), undefined);
});

test("formatAverage e a celula: uma casa so quando nao e inteiro; '—' sem registro; detalhe cliente x bot", () => {
  assert.equal(formatAverage(42), "42");
  assert.equal(formatAverage(33.333), "33,3");
  assert.equal(formatAverage(0), "0");
  assert.equal(renderMessageAverageCell(undefined), "—");
  const cell = renderMessageAverageCell({ inbound: 50, outbound: 50, months: 3, avgInbound: 50 / 3, avgOutbound: 50 / 3, avgTotal: 100 / 3 });
  assert.match(cell, /33,3\/mês/);
  assert.match(cell, /cliente 16,7 · bot 16,7/);
  assert.match(cell, /Total: 50 do cliente \+ 50 do bot em 3 mês\(es\)/);
});

test("sendText real: conta como mensagem do bot so quando a Evolution API aceita; numero bloqueado e envio com erro nao contam", async (t) => {
  const C = "551100090003";
  db.prepare(`DELETE FROM message_counts WHERE from_number = ?`).run(C);
  const month = currentMonthKey();
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => (fail ? new Response("boom", { status: 500 }) : new Response("{}", { status: 200 })));
  await sendText(C, "oi");
  await sendText(C, "oi de novo");
  assert.equal(row(C, month)?.outbound, 2);
  fail = true;
  await assert.rejects(() => sendText(C, "falha"));
  assert.equal(row(C, month)?.outbound, 2, "erro de envio nao conta");
  fail = false;
  blockNumber(C);
  try {
    await sendText(C, "bloqueado");
  } finally {
    unblockNumber(C);
  }
  assert.equal(row(C, month)?.outbound, 2, "numero bloqueado nao recebe nem conta");
});
