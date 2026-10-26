// Revisao do Card 22: data aproximada de inicio nao antecipa a media mensal; recordMessage nao relê o inicio a cada mensagem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { MESSAGE_COUNTS_SINCE_KEY, recordMessage, renderMessageAverageCell, resetMessageCountsCacheForTests } from "../../src/activity/messageCounts";

const metaRows = () => (db.prepare(`SELECT COUNT(*) AS n FROM app_meta WHERE key = ?`).get(MESSAGE_COUNTS_SINCE_KEY) as { n: number }).n;

test("celula com data aproximada: 'em ate N dias' ate a garantia de 30 dias (contada do FIM do mes de inicio), depois media mensal", () => {
  const stats = { inbound: 20, outbound: 22, months: 1, avgInbound: 20, avgOutbound: 22, avgTotal: 42 };
  const since = { date: "2026-10-01", approximate: true };
  const fim = renderMessageAverageCell(stats, since, "2026-10-31"); // a contagem pode ter comecado em qualquer dia de outubro
  assert.match(fim, />42 em até 30 dias</);
  assert.doesNotMatch(fim, /\/mês/, "nao vira media mensal so porque o dia 1 esta a 30 dias");
  assert.match(renderMessageAverageCell(stats, since, "2026-11-29"), />42 em até 59 dias</, "garantia de 29 dias: ainda recente");
  assert.match(renderMessageAverageCell(stats, since, "2026-11-30"), />42\/mês</, "garantia de 30 dias: media mensal");
  // data exata continua como antes (sem 'ate')
  assert.match(renderMessageAverageCell(stats, { date: "2026-10-20", approximate: false }, "2026-10-31"), />42 em 11 dias</);
  // fevereiro tem 28 dias: o fim do mes de inicio e dia 28
  assert.match(renderMessageAverageCell(stats, { date: "2027-02-01", approximate: true }, "2027-03-30"), />42\/mês</);
  assert.match(renderMessageAverageCell(stats, { date: "2027-02-01", approximate: true }, "2027-03-29"), />42 em até 56 dias</);
});

test("recordMessage so le o inicio da contagem uma vez (nao repete a consulta a cada mensagem)", () => {
  resetMessageCountsCacheForTests();
  db.prepare(`DELETE FROM app_meta WHERE key = ?`).run(MESSAGE_COUNTS_SINCE_KEY);
  recordMessage("551100090020", "inbound", new Date("2026-10-20T12:00:00-03:00"));
  assert.equal(metaRows(), 1);
  // se a chave fosse relida a cada mensagem, esta linha apagada seria recriada; com o cache, a primeira gravacao vale pro resto do processo
  db.prepare(`DELETE FROM app_meta WHERE key = ?`).run(MESSAGE_COUNTS_SINCE_KEY);
  recordMessage("551100090020", "inbound", new Date("2026-10-21T12:00:00-03:00"));
  assert.equal(metaRows(), 0);
  resetMessageCountsCacheForTests();
  recordMessage("551100090020", "inbound", new Date("2026-10-22T12:00:00-03:00"));
  assert.equal(metaRows(), 1);
});
