// Coluna "Média de mensagens/mês" nos numeros autorizados do /admin + contagem de mensagens recebidas pelo router.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminTestServer } from "../helpers/app";
import { bootApp, msg } from "../helpers/botApp";
import { allowNumber } from "../../src/access/allowlist";
import { ensureUserSeeded } from "../../src/expenses/service";
import { db } from "../../src/db";
import { currentMonthKey, MESSAGE_COUNTS_SINCE_KEY } from "../../src/activity/messageCounts";
import { addDaysToDateString, spDateString } from "../../src/timeSP";

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

test("/admin: coluna de media mensal -- data de inicio da contagem, '0' com tooltip (nunca '—'), contagem recente em dias e media com 30 dias", async () => {
  const withData = "551100090201";
  const without = "551100090202";
  allowNumber(withData);
  allowNumber(without);
  const month = currentMonthKey();
  db.prepare(`DELETE FROM message_counts`).run();
  db.prepare(`DELETE FROM app_meta WHERE key = ?`).run(MESSAGE_COUNTS_SINCE_KEY);
  const today = spDateString(new Date(Date.now()));
  const server = await startAdminTestServer();
  try {
    const rowOf = (html: string, n: string) => html.slice(html.lastIndexOf(`<td>${n}</td>`), html.indexOf("</tr>", html.lastIndexOf(`<td>${n}</td>`))); // a tabela de autorizados vem depois da de clientes
    const get = async () => (await fetch(`${server.baseUrl}/admin`, { headers: server.authHeaders!() })).text();

    // contagem ainda nao comecou: aviso e '0' sem data
    let html = await get();
    assert.match(html, /A contagem de mensagens começa na próxima mensagem/);
    assert.match(html, /<th[^>]*>Média de mensagens\/mês<\/th>/);
    assert.match(rowOf(html, without), /title="Nenhuma mensagem desde o início da contagem">0<\/span>/);

    // contagem de hoje: "42 em 1 dia"
    db.prepare(`INSERT INTO message_counts (from_number, month, inbound, outbound) VALUES (?, ?, 30, 12)`).run(withData, month);
    db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(MESSAGE_COUNTS_SINCE_KEY, today);
    html = await get();
    assert.match(html, /Contagem de mensagens iniciada em \d{2}\/\d{2}\/\d{4} \(não há histórico anterior\)\./);
    assert.match(rowOf(html, withData), />42 em 1 dia</);
    assert.match(rowOf(html, withData), /cliente 30 · bot 12/);
    assert.match(rowOf(html, without), /Nenhuma mensagem desde o início da contagem \(\d{2}\/\d{2}\/\d{4}\)">0</);
    assert.match(rowOf(html, without), /<td><span style="color:var\(--muted\)" title="Nenhuma[^"]*">0<\/span><\/td>/, "a coluna de media nao mostra '—' (so a coluna Nota pode)");

    // contagem com mais de 30 dias: media mensal
    db.prepare(`UPDATE app_meta SET value = ? WHERE key = ?`).run(addDaysToDateString(today, -45), MESSAGE_COUNTS_SINCE_KEY);
    html = await get();
    assert.match(rowOf(html, withData), />42\/mês</);

    // dados antigos sem data: aproximada com ~
    db.prepare(`DELETE FROM app_meta WHERE key = ?`).run(MESSAGE_COUNTS_SINCE_KEY);
    html = await get();
    assert.match(html, /por volta de ~01\/\d{2}\/\d{4} \(data aproximada/);
  } finally {
    await server.close();
  }
});
