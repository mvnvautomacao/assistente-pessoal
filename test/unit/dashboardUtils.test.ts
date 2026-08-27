import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBrazilPhone,
  escapeHtml,
  formatMoney,
  formatAmountInput,
  formatDate,
  monthLabel,
  shiftMonth,
  toSPDateTimeLocal,
  fromSPDateTimeLocal,
  calendarCells,
  buildCsv,
  formatAmountCsv,
} from "../../src/dashboard/utils";

test("normalizeBrazilPhone remove o 9 extra do numero digitado no formato padrao", () => {
  assert.equal(normalizeBrazilPhone("5561999210718"), "556199210718");
});

test("normalizeBrazilPhone nao mexe num numero que ja esta no formato do WhatsApp", () => {
  assert.equal(normalizeBrazilPhone("556199210718"), "556199210718");
});

test("normalizeBrazilPhone limpa formatacao (espacos, parenteses, traco)", () => {
  assert.equal(normalizeBrazilPhone("+55 (61) 99921-0718"), "556199210718");
});

test("escapeHtml neutraliza os caracteres perigosos pra injecao de HTML", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
});

test("formatMoney formata em real brasileiro", () => {
  assert.equal(formatMoney(1234.5), "R$ 1.234,50");
});

test("formatAmountInput: numero -> string mascarada com milhar e 2 casas", () => {
  assert.equal(formatAmountInput(1234.5), "1.234,50");
  assert.equal(formatAmountInput(80), "80,00");
  assert.equal(formatAmountInput(0.05), "0,05");
});

test("formatDate NAO retrocede um dia pra data-calendario pura (regressao do bug de fuso)", () => {
  // "2026-08-25" (so data, sem hora) passado por `new Date()` direto e interpretado
  // como meia-noite UTC, que reprojetada pro fuso de Sao Paulo (UTC-3) virava 24/08.
  assert.equal(formatDate("2026-08-25"), "25/08/2026");
});

test("formatDate funciona tambem com uma string que tem hora junto", () => {
  assert.equal(formatDate("2026-08-25T14:32:00.000Z"), "25/08/2026");
});

test("monthLabel capitaliza so a primeira letra ('Agosto de 2026', nao 'Agosto De 2026')", () => {
  assert.equal(monthLabel("2026-08"), "Agosto de 2026");
});

test("shiftMonth avança e volta mes corretamente, inclusive virando o ano", () => {
  assert.equal(shiftMonth("2026-08", 1), "2026-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("toSPDateTimeLocal / fromSPDateTimeLocal fazem o caminho de ida e volta", () => {
  const iso = "2026-08-25T14:32:00-03:00";
  assert.equal(toSPDateTimeLocal(iso), "2026-08-25T14:32");
  assert.equal(fromSPDateTimeLocal("2026-08-25T14:32"), "2026-08-25T14:32:00-03:00");
});

test("calendarCells: agosto de 2026 comeca no sabado (6 vazios antes do dia 1)", () => {
  const cells = calendarCells("2026-08");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.slice(0, 6).every((c) => c === null), true);
  assert.equal(cells[6], "2026-08-01");
  assert.equal(cells[36], "2026-08-31"); // ultimo dia do mes
  assert.equal(cells.length, 42); // 6 semanas completas pra caber os 31 dias + folga
});

test("calendarCells: fevereiro em ano bissexto (2028) tem 29 dias", () => {
  const cells = calendarCells("2028-02");
  const days = cells.filter((c): c is string => c !== null);
  assert.equal(days.length, 29);
  assert.equal(days[days.length - 1], "2028-02-29");
});

test("calendarCells: cada mes tem exatamente o numero certo de dias, sem duplicar nem pular", () => {
  const cells = calendarCells("2026-04"); // abril tem 30 dias
  const days = cells.filter((c): c is string => c !== null);
  assert.equal(days.length, 30);
  assert.deepEqual(days[0], "2026-04-01");
  assert.deepEqual(days[29], "2026-04-30");
});

test("formatAmountCsv usa virgula decimal, sem separador de milhar", () => {
  assert.equal(formatAmountCsv(45.9), "45,90");
  assert.equal(formatAmountCsv(1234.5), "1234,50");
  assert.equal(formatAmountCsv(0), "0,00");
});

test("buildCsv usa ; como separador de campo e comeca com o BOM UTF-8 (Excel PT-BR)", () => {
  const csv = buildCsv(["Data", "Descrição"], [["27/08/2026", "Mercado"]]);
  assert.equal(csv.charCodeAt(0), 0xfeff); // BOM
  const withoutBom = csv.slice(1);
  const lines = withoutBom.split("\r\n");
  assert.equal(lines[0], "Data;Descrição");
  assert.equal(lines[1], "27/08/2026;Mercado");
});

test("buildCsv coloca entre aspas (e escapa aspas internas) campo que tem ; ou aspas", () => {
  const csv = buildCsv(["Descrição"], [['Compra "grande"; especial']]);
  const line = csv.slice(1).split("\r\n")[1];
  assert.equal(line, '"Compra ""grande""; especial"');
});
