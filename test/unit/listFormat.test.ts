import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_HINT,
  ExpenseListLine,
  MAX_DESCRIPTION_CHARS,
  MAX_MESSAGE_CHARS,
  dayHeader,
  formatExpenseLine,
  formatExpenseList,
  truncateText,
} from "../../src/confirmation/listFormat";

const TODAY = "2026-10-14";
const LINK = "https://painel.exemplo.com";

function line(id: number, over: Partial<ExpenseListLine> = {}): ExpenseListLine {
  return { id, amount: 38, description: `Gasto ${id}`, date: TODAY, category: "Alimentação", payment_method: "Pix", ...over };
}

test("truncateText: ate 60 caracteres, com reticencias, espacos colapsados", () => {
  assert.equal(MAX_DESCRIPTION_CHARS, 60);
  assert.equal(truncateText("  Mercado   do bairro  "), "Mercado do bairro");
  const long = "a".repeat(100);
  const cut = truncateText(long);
  assert.equal(cut.length, 60);
  assert.ok(cut.endsWith("…"));
  assert.equal(truncateText("x".repeat(60)), "x".repeat(60));
  assert.equal(truncateText("abcdef", 4), "abc…");
});

test("dayHeader: dia da semana e dd/MM", () => {
  assert.equal(dayHeader("2026-10-08"), "qui 08/10");
  assert.equal(dayHeader("2026-10-11"), "dom 11/10");
  assert.equal(dayHeader("2026-10-10T12:00:00"), "sáb 10/10");
});

test("formatExpenseLine (RN12): R$ 38,00, categoria/pagamento, hoje/ontem/dd/MM; sem categoria e sem pagamento", () => {
  const opts = { today: TODAY, withDate: true };
  assert.equal(formatExpenseLine(line(1), 1, opts), "1. R$ 38,00 — Gasto 1 (Alimentação, Pix) — hoje");
  assert.equal(formatExpenseLine(line(2, { date: "2026-10-13", amount: 12.5, payment_method: "Crédito", category: "Transporte" }), 2, opts), "2. R$ 12,50 — Gasto 2 (Transporte, Crédito) — ontem");
  assert.equal(formatExpenseLine(line(3, { date: "2026-10-08" }), 3, opts), "3. R$ 38,00 — Gasto 3 (Alimentação, Pix) — 08/10");
  assert.equal(formatExpenseLine(line(4, { category: null, payment_method: null }), 4, opts), "4. R$ 38,00 — Gasto 4 (sem categoria) — hoje");
  assert.equal(formatExpenseLine(line(5, { payment_method: null }), 5, opts), "5. R$ 38,00 — Gasto 5 (Alimentação) — hoje");
  assert.equal(formatExpenseLine(line(6, { amount: 1234.5 }), 6, { today: TODAY, withDate: false }), "6. R$ 1.234,50 — Gasto 6 (Alimentação, Pix)");
  assert.equal(formatExpenseLine(line(7, { description: "Compra (parcela 2/3)" }), 7, opts), "7. R$ 38,00 — Compra (parcela 2/3) (Alimentação, Pix) — hoje");
  assert.ok(formatExpenseLine(line(8, { description: "d".repeat(200) }), 8, opts).includes("d".repeat(59) + "…"));
});

test("lista simples: titulo, linhas numeradas, total e rodape de edicao (contrato 'ultimas compras')", () => {
  const out = formatExpenseList({
    title: "Últimos 2 gastos",
    items: [line(1), line(2, { date: "2026-10-13", amount: 12.5, category: "Transporte", payment_method: "Crédito" })],
    total: 50.5,
    totalCount: 2,
    today: TODAY,
    grouped: false,
    dashboardUrl: LINK,
  });
  assert.equal(
    out.text,
    `🧾 Últimos 2 gastos\n\n1. R$ 38,00 — Gasto 1 (Alimentação, Pix) — hoje\n2. R$ 12,50 — Gasto 2 (Transporte, Crédito) — ontem\n\n💰 Total: R$ 50,50\n\n${EDIT_HINT}`
  );
  assert.equal(EDIT_HINT, 'Pra editar um, é só dizer, ex: "muda o valor do 2 pra 45".');
  assert.deepEqual(out.shown.map((i) => i.id), [1, 2]);
});

test("lista com aviso (maximo de 20) logo abaixo do titulo", () => {
  const out = formatExpenseList({ title: "Últimos 1 gasto", items: [line(1)], total: 38, totalCount: 1, today: TODAY, grouped: false, dashboardUrl: LINK, note: "Mostrei as 20 últimas (é o máximo por mensagem)." });
  assert.match(out.text, /^🧾 Últimos 1 gasto\nMostrei as 20 últimas \(é o máximo por mensagem\)\.\n\n1\. /);
});

test("lista agrupada por dia: cabecalho '📅 qui 08/10', numeracao unica e sem data nas linhas", () => {
  const out = formatExpenseList({
    title: "Gastos — 08/10 a 09/10",
    items: [line(3, { date: "2026-10-09" }), line(2, { date: "2026-10-08", amount: 10 }), line(1, { date: "2026-10-08", amount: 5 })],
    total: 53,
    totalCount: 3,
    today: TODAY,
    grouped: true,
    dashboardUrl: LINK,
  });
  assert.equal(
    out.text,
    `🧾 Gastos — 08/10 a 09/10\n\n📅 sex 09/10\n1. R$ 38,00 — Gasto 3 (Alimentação, Pix)\n\n📅 qui 08/10\n2. R$ 10,00 — Gasto 2 (Alimentação, Pix)\n3. R$ 5,00 — Gasto 1 (Alimentação, Pix)\n\n💰 Total: R$ 53,00\n\n${EDIT_HINT}`
  );
});

test("teto de itens (RN10): '...e mais N' com o link do painel e total do conjunto COMPLETO com a contagem", () => {
  const shown = Array.from({ length: 30 }, (_, i) => line(i + 1));
  const out = formatExpenseList({ title: "Gastos — setembro/2026", items: shown, total: 1234.56, totalCount: 37, today: TODAY, grouped: false, dashboardUrl: LINK });
  assert.equal(out.shown.length, 30);
  assert.match(out.text, new RegExp(`\\n\\n…e mais 7 gastos\\. Veja tudo no painel: ${LINK.replace(/\./g, "\\.")}\\n\\n`));
  assert.match(out.text, /💰 Total: R\$ 1\.234,56 em 37 gastos \(mostrando 30\)/);
  assert.match(out.text, /\n30\. R\$ 38,00 — Gasto 30/);
  // singular
  const one = formatExpenseList({ title: "T", items: shown.slice(0, 2), total: 100, totalCount: 3, today: TODAY, grouped: false, dashboardUrl: LINK });
  assert.match(one.text, /…e mais 1 gasto\. Veja tudo/);
  // sem corte: sem a linha de "mais" e sem a contagem no total
  const all = formatExpenseList({ title: "T", items: shown.slice(0, 2), total: 76, totalCount: 2, today: TODAY, grouped: false, dashboardUrl: LINK });
  assert.ok(!all.text.includes("…e mais"));
  assert.ok(!all.text.includes("mostrando"));
});

test("mensagem sempre cabe (~3.500 caracteres): com descricoes longas, corta linhas e o 'mais N' acompanha", () => {
  const long = Array.from({ length: 30 }, (_, i) => line(i + 1, { description: "descricao muito longa ".repeat(10), category: "Categoria com nome bem comprido", payment_method: "Forma de pagamento comprida", amount: 123456.78 }));
  for (const grouped of [false, true]) {
    const items = grouped ? long.map((l, i) => ({ ...l, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` })) : long;
    const out = formatExpenseList({ title: "Gastos — setembro/2026", items, total: 9999999, totalCount: 80, today: TODAY, grouped, dashboardUrl: LINK });
    assert.ok(out.text.length <= MAX_MESSAGE_CHARS, `${grouped}: ${out.text.length}`);
    assert.ok(out.shown.length >= 1 && out.shown.length < 30);
    assert.match(out.text, new RegExp(`…e mais ${80 - out.shown.length} gastos`));
    assert.match(out.text, new RegExp(`em 80 gastos \\(mostrando ${out.shown.length}\\)`));
    // a numeracao vai de 1 ao ultimo item MOSTRADO (nao existe item sem aparecer)
    assert.match(out.text, new RegExp(`\\n${out.shown.length}\\. R\\$`));
    assert.ok(!out.text.includes(`\n${out.shown.length + 1}. R$`));
  }
  // ate um unico item gigante cabe
  const huge = formatExpenseList({ title: "T", items: [line(1, { description: "x".repeat(5000) })], total: 1, totalCount: 1, today: TODAY, grouped: false, dashboardUrl: LINK });
  assert.ok(huge.text.length < MAX_MESSAGE_CHARS);
});
