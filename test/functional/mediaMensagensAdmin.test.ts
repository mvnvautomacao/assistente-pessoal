// Coluna "Média de mensagens/mês" nos numeros autorizados do /admin + contagem de mensagens recebidas pelo router.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminTestServer } from "../helpers/app";
import { bootApp, msg } from "../helpers/botApp";
import { allowNumber } from "../../src/access/allowlist";
import { ensureUserSeeded } from "../../src/expenses/service";
import { db } from "../../src/db";
import { currentMonthKey } from "../../src/activity/messageCounts";

const NOW = new Date("2026-10-20T10:00:00-03:00").getTime();
const counts = (n: string) => db.prepare(`SELECT inbound, outbound FROM message_counts WHERE from_number = ?`).get(n) as { inbound: number; outbound: number } | undefined;

test("o router conta a mensagem de numero autorizado (inclusive a que cai no freio) e ignora a de numero nao autorizado", async (t) => {
  const app = bootApp(t, NOW);
  const ok = "551100090101";
  const stranger = "551100090102";
  ensureUserSeeded(ok);
  allowNumber(ok);
  for (const text of ["oi", "ajuda"]) {
    app.resetLimit();
    await app.handle(msg(ok, text));
  }
  assert.equal(counts(ok)?.inbound, 2);
  await app.handle(msg(stranger, "oi"));
  assert.equal(counts(stranger), undefined, "numero nao autorizado nao entra na conta");
});

test("/admin: a tabela de numeros autorizados tem a coluna de media mensal (— sem registro; total/mes e cliente x bot com registro)", async () => {
  const withData = "551100090201";
  const without = "551100090202";
  allowNumber(withData);
  allowNumber(without);
  const month = currentMonthKey();
  db.prepare(`DELETE FROM message_counts WHERE from_number IN (?, ?)`).run(withData, without);
  db.prepare(`INSERT INTO message_counts (from_number, month, inbound, outbound) VALUES (?, ?, 30, 12)`).run(withData, month);
  const server = await startAdminTestServer();
  try {
    const html = await (await fetch(`${server.baseUrl}/admin`, { headers: server.authHeaders!() })).text();
    assert.match(html, /<th[^>]*>Média de mensagens\/mês<\/th>/);
    const rowOf = (n: string) => html.slice(html.lastIndexOf(`<td>${n}</td>`), html.indexOf("</tr>", html.lastIndexOf(`<td>${n}</td>`))); // a tabela de autorizados vem depois da de clientes
    assert.match(rowOf(withData), /42\/mês/);
    assert.match(rowOf(withData), /cliente 30 · bot 12/);
    assert.match(rowOf(without), /<td>—<\/td>\s*<td>\s*<form/);
  } finally {
    await server.close();
  }
});
