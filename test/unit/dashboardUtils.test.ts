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
