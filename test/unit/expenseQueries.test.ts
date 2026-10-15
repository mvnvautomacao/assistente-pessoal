// Card 14: filtros de servico, resolucao de filtros e as consultas (lista, relatorio, entradas, saldo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config";
import {
  ensureUserSeeded,
  getExpenseSummaryBetween,
  getExpensesBetween,
  getOrCreateCategory,
  getOrCreatePaymentMethod,
  getRecentExpensesList,
  insertExpense,
} from "../../src/expenses/service";
import { insertIncome } from "../../src/incomes/service";
import { categoryNotFoundText, filterLabel, filterPhrase, hasAnyFilter, paymentMethodNotFoundText, resolveExpenseFilters } from "../../src/expenses/queryFilters";
import { MAX_RECENT_NOTE, periodExpenseList, runBalance, runExpenseReport, runIncomeReport, runListExpenses, runListIncomes } from "../../src/expenses/queries";
import { INVALID_RANGE_TEXT, INVALID_MONTH_TEXT } from "../../src/expenses/queryRange";

const TODAY = "2026-10-14";
let seq = 0;

// numero novo por cenario, ja com categorias/formas padrao
function user() {
  const n = `55110009600${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  return n;
}

function add(n: string, over: { amount?: number; description: string; date?: string; category?: string; payment?: string }) {
  return insertExpense({
    fromNumber: n,
    amount: over.amount ?? 10,
    description: over.description,
    categoryId: over.category ? getOrCreateCategory(n, over.category).id : null,
    paymentMethodId: over.payment ? getOrCreatePaymentMethod(n, over.payment).id : null,
    date: over.date ?? TODAY,
  });
}

function reply(outcome: ReturnType<typeof runListExpenses>) {
  assert.equal(outcome.type, "reply");
  return outcome as Extract<ReturnType<typeof runListExpenses>, { type: "reply" }>;
}

test("servico: getRecentExpensesList filtra por categoria e forma de pagamento, limita e ordena (data desc, id desc)", () => {
  const n = user();
  const other = user();
  add(n, { description: "mercado velho", category: "Mercado", payment: "Pix", date: "2026-10-01" });
  add(n, { description: "mercado novo", category: "Mercado", payment: "Nubank", date: "2026-10-13" });
  const lastSameDay = add(n, { description: "uber pix", category: "Transporte", payment: "Pix", date: "2026-10-13" });
  add(n, { description: "padaria", category: "Mercado", payment: "Pix", date: "2026-10-14" });
  add(other, { description: "de outro numero", category: "Mercado", payment: "Pix", date: "2026-10-14" });

  const mercado = getOrCreateCategory(n, "Mercado").id;
  const pix = getOrCreatePaymentMethod(n, "Pix").id;
  assert.deepEqual(getRecentExpensesList(n, 10).map((e) => e.description), ["padaria", "uber pix", "mercado novo", "mercado velho"]);
  assert.equal(getRecentExpensesList(n, 10)[1].id, lastSameDay.id, "mesmo dia: o id maior vem primeiro");
  assert.deepEqual(getRecentExpensesList(n, 2).map((e) => e.description), ["padaria", "uber pix"]);
  assert.deepEqual(getRecentExpensesList(n, 10, { categoryId: mercado }).map((e) => e.description), ["padaria", "mercado novo", "mercado velho"]);
  assert.deepEqual(getRecentExpensesList(n, 10, { paymentMethodId: pix }).map((e) => e.description), ["padaria", "uber pix", "mercado velho"]);
  assert.deepEqual(getRecentExpensesList(n, 10, { categoryId: mercado, paymentMethodId: pix }).map((e) => e.description), ["padaria", "mercado velho"]);
  assert.deepEqual(getRecentExpensesList(n, 10, { start: "2026-10-13", end: "2026-10-14" }).map((e) => e.description), ["uber pix", "mercado novo"]);
  assert.ok(getRecentExpensesList(n, 10).every((e) => e.description !== "de outro numero"), "isolamento por numero");
});

test("servico: getExpensesBetween com filtros e limite; getExpenseSummaryBetween com forma de pagamento", () => {
  const n = user();
  add(n, { amount: 100, description: "a", category: "Mercado", payment: "Nubank", date: "2026-09-05" });
  add(n, { amount: 50, description: "b", category: "Lazer", payment: "Nubank", date: "2026-09-10" });
  add(n, { amount: 30, description: "c", category: "Mercado", payment: "Pix", date: "2026-09-20" });
  add(n, { amount: 999, description: "fora", category: "Mercado", payment: "Nubank", date: "2026-10-01" });
  const nubank = getOrCreatePaymentMethod(n, "Nubank").id;
  const mercado = getOrCreateCategory(n, "Mercado").id;

  assert.deepEqual(getExpensesBetween(n, "2026-09-01", "2026-10-01").map((e) => e.description), ["c", "b", "a"]);
  assert.deepEqual(getExpensesBetween(n, "2026-09-01", "2026-10-01", { paymentMethodId: nubank }).map((e) => e.description), ["b", "a"]);
  assert.deepEqual(getExpensesBetween(n, "2026-09-01", "2026-10-01", { categoryId: mercado, paymentMethodId: nubank }).map((e) => e.description), ["a"]);
  assert.deepEqual(getExpensesBetween(n, "2026-09-01", "2026-10-01", { limit: 2 }).map((e) => e.description), ["c", "b"]);

  const summary = getExpenseSummaryBetween("2026-09-01", "2026-10-01", n, undefined, nubank);
  assert.equal(summary.total, 150);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.categoryTotals.map((c) => c.name), ["Mercado", "Lazer"]);
  assert.equal(getExpenseSummaryBetween("2026-09-01", "2026-10-01", n, mercado, nubank).total, 100);
  assert.equal(getExpenseSummaryBetween("2026-09-01", "2026-10-01", n).total, 180);
});

test("resolveExpenseFilters (RN04): acento, caixa, plural/apelido, combinacao e nao encontrado", () => {
  const n = user();
  getOrCreatePaymentMethod(n, "Nubank");
  getOrCreatePaymentMethod(n, "Crédito");
  const ok = (request: { category?: string; payment_method?: string }) => {
    const r = resolveExpenseFilters(n, request);
    assert.ok(r.ok, JSON.stringify(r));
    return (r as Extract<typeof r, { ok: true }>).filters;
  };
  assert.equal(ok({ category: "mercado" }).categoryName, "Mercado");
  assert.equal(ok({ category: "MERCADO" }).categoryName, "Mercado");
  assert.equal(ok({ category: "supermercados" }).categoryName, "Mercado", "plural/apelido: categoria citada na frase");
  assert.equal(ok({ category: "saude" }).categoryName, "Saúde", "sem acento");
  assert.equal(ok({ payment_method: "nubank" }).paymentMethodName, "Nubank");
  assert.equal(ok({ payment_method: "NUBANK" }).paymentMethodName, "Nubank");
  assert.equal(ok({ payment_method: "credito" }).paymentMethodName, "Crédito", "sem acento");
  const both = ok({ category: "mercado", payment_method: "pix" });
  assert.equal(both.categoryName, "Mercado");
  assert.equal(both.paymentMethodName, "Pix");
  assert.ok(hasAnyFilter(both));
  assert.deepEqual(ok({}), {});
  assert.ok(!hasAnyFilter(ok({})));
  assert.deepEqual(ok({ category: "  ", payment_method: "" }), {}, "em branco = sem filtro");

  const noCategory = resolveExpenseFilters(n, { category: "viagens" });
  assert.deepEqual(noCategory, { ok: false, message: 'Não achei a categoria "viagens". Pra ver as suas, diga "minhas categorias".' });
  assert.equal(categoryNotFoundText("x"), 'Não achei a categoria "x". Pra ver as suas, diga "minhas categorias".');
  const noPayment = resolveExpenseFilters(n, { payment_method: "inter" });
  assert.equal(noPayment.ok, false);
  assert.match((noPayment as { message: string }).message, /^Não achei a forma de pagamento "inter"\. As suas são: /);
  assert.ok((noPayment as { message: string }).message.includes("Nubank"));
  assert.equal(paymentMethodNotFoundText("x", []), 'Não achei a forma de pagamento "x".');

  assert.equal(filterLabel(both), "Mercado · Pix");
  assert.equal(filterLabel({ categoryName: "Mercado" }), "Mercado");
  assert.equal(filterLabel({}), "");
  assert.equal(filterPhrase(both), "de Mercado no Pix");
  assert.equal(filterPhrase({ paymentMethodName: "Nubank" }), "no Nubank");
});

test("runListExpenses -- ultimas N (RN01): padrao 10, maximo 20 com aviso, N<1 vira 10, ordem decrescente e total dos mostrados", () => {
  const n = user();
  for (let i = 1; i <= 25; i++) add(n, { amount: i, description: `compra ${i}`, date: `2026-10-${String(Math.min(i, 14)).padStart(2, "0")}` });

  const dflt = reply(runListExpenses(n, { last_n: 10 }, TODAY));
  assert.match(dflt.text, /^🧾 Últimos 10 gastos\n\n1\. R\$ 25,00 — compra 25 /);
  assert.equal(dflt.shownIds?.length, 10);
  assert.match(dflt.text, /💰 Total: R\$ 205,00\n/, "25+24+...+16");
  assert.ok(dflt.text.endsWith('Pra editar um, é só dizer, ex: "muda o valor do 2 pra 45".'));
  assert.equal(dflt.label, "Últimos 10 gastos");

  assert.equal(reply(runListExpenses(n, { last_n: 5 }, TODAY)).shownIds?.length, 5);
  const noNumber = reply(runListExpenses(n, { last_n: Number.NaN }, TODAY));
  assert.equal(noNumber.shownIds?.length, 10, "sem numero valido = 10");
  assert.equal(reply(runListExpenses(n, { last_n: 0 }, TODAY)).shownIds?.length, 10);
  assert.equal(reply(runListExpenses(n, { last_n: -4 }, TODAY)).shownIds?.length, 10);
  const big = reply(runListExpenses(n, { last_n: 50 }, TODAY));
  assert.equal(big.shownIds?.length, 20);
  assert.ok(big.text.includes(MAX_RECENT_NOTE));
  assert.equal(MAX_RECENT_NOTE, "Mostrei as 20 últimas (é o máximo por mensagem).");
  assert.ok(!reply(runListExpenses(n, { last_n: 20 }, TODAY)).text.includes("máximo por mensagem"), "exatamente 20 nao avisa");
  assert.equal(reply(runListExpenses(n, { last_n: 7.9 }, TODAY)).shownIds?.length, 7);
});

test("runListExpenses -- ultimas com menos gastos que N, um gasto so e nenhum gasto", () => {
  const n = user();
  assert.equal(reply(runListExpenses(n, { last_n: 10 }, TODAY)).text, "Você ainda não tem nenhum gasto registrado.");
  add(n, { description: "unico", category: "Mercado", payment: "Pix" });
  assert.match(reply(runListExpenses(n, { last_n: 10 }, TODAY)).text, /^🧾 Último gasto\n\n1\. R\$ 10,00 — unico \(Mercado, Pix\) — hoje\n/);
  add(n, { description: "segundo" });
  const two = reply(runListExpenses(n, { last_n: 10 }, TODAY));
  assert.match(two.text, /^🧾 Últimos 2 gastos\n/, "titulo com a quantidade real");
  assert.equal(two.shownIds?.length, 2);
});

test("runListExpenses -- filtro sem periodo nem N = ultimos 10 com o filtro (RN02); titulos de RN14", () => {
  const n = user();
  for (let i = 1; i <= 12; i++) add(n, { description: `mercado ${i}`, category: "Mercado", payment: i % 2 ? "Pix" : "Nubank", date: `2026-10-${String(i).padStart(2, "0")}` });
  add(n, { description: "uber", category: "Transporte", payment: "Pix", date: "2026-10-13" });

  const byCategory = reply(runListExpenses(n, { category: "mercado" }, TODAY));
  assert.match(byCategory.text, /^🧾 Mercado — últimos 10 gastos\n\n1\. R\$ 10,00 — mercado 12 \(Mercado, Nubank\) — 12\/10\n/);
  assert.equal(byCategory.shownIds?.length, 10);
  assert.ok(!byCategory.text.includes("uber"));

  const both = reply(runListExpenses(n, { category: "mercado", payment_method: "pix", last_n: 5 }, TODAY));
  assert.match(both.text, /^🧾 Mercado · Pix — últimos 5 gastos\n/);
  assert.equal(both.shownIds?.length, 5);
  assert.ok(!both.text.includes("Nubank"), "so Pix");

  const byPayment = reply(runListExpenses(n, { payment_method: "nubank" }, TODAY));
  assert.match(byPayment.text, /^🧾 Nubank — últimos 6 gastos\n/);

  // filtro que existe mas sem gastos / filtro inexistente
  assert.equal(reply(runListExpenses(n, { category: "lazer" }, TODAY)).text, "Nenhum gasto de Lazer registrado.");
  assert.equal(reply(runListExpenses(n, { category: "viagens" }, TODAY)).text, 'Não achei a categoria "viagens". Pra ver as suas, diga "minhas categorias".');
  assert.equal(reply(runListExpenses(n, { category: "viagens" }, TODAY)).shownIds, undefined, "erro nao grava lista");
  assert.match(reply(runListExpenses(n, { payment_method: "inter" }, TODAY)).text, /^Não achei a forma de pagamento "inter"\./);
});

test("runListExpenses -- filtro COM periodo vai direto pro detalhado, sem a pergunta 'resumo ou detalhado' (RN03)", () => {
  const n = user();
  add(n, { amount: 40, description: "mercado a", category: "Mercado", payment: "Pix", date: "2026-10-12" });
  add(n, { amount: 15, description: "mercado b", category: "Mercado", payment: "Pix", date: "2026-10-14" });
  add(n, { amount: 99, description: "lazer", category: "Lazer", payment: "Pix", date: "2026-10-13" });

  const week = reply(runListExpenses(n, { category: "mercado", days: 7 }, TODAY));
  assert.match(week.text, /^🧾 Gastos de Mercado — últimos 7 dias\n\n📅 qua 14\/10\n1\. R\$ 15,00 — mercado b/);
  assert.match(week.text, /📅 seg 12\/10\n2\. R\$ 40,00 — mercado a/);
  assert.ok(!week.text.includes("lazer"));
  assert.match(week.text, /💰 Total: R\$ 55,00\n/);

  const today = reply(runListExpenses(n, { payment_method: "pix", date: "2026-10-14" }, TODAY));
  assert.match(today.text, /^🧾 Gastos no Pix — hoje\n\n1\. R\$ 15,00 — mercado b \(Mercado, Pix\) — hoje\n/, "um dia so: lista simples com a data relativa");

  // sem filtro, varios dias: pergunta como sempre
  assert.deepEqual(runListExpenses(n, { days: 3 }, TODAY), { type: "ask_format", days: 3, log: "perguntou formato pros ultimos 3 dias" });
  // 1 dia nao pergunta
  assert.match(reply(runListExpenses(n, { days: 1 }, TODAY)).text, /^🧾 Gastos — hoje\n/);
  // mes e intervalo nunca perguntam (mesmo com "days" junto: o mes ganha)
  assert.match(reply(runListExpenses(n, { month: "2026-10", days: 3 }, TODAY)).text, /^🧾 Gastos — outubro\/2026\n/);
});

test("runListExpenses -- sem periodo nem filtro: avisa que vai mostrar hoje (como antes)", () => {
  const n = user();
  add(n, { description: "de hoje" });
  add(n, { description: "de ontem", date: "2026-10-13" });
  const out = reply(runListExpenses(n, {}, TODAY));
  assert.match(out.preface ?? "", /^Você não disse o dia, então vou te mostrar as compras de hoje\./);
  assert.match(out.text, /de hoje/);
  assert.ok(!out.text.includes("de ontem"));
  const empty = reply(runListExpenses(user(), {}, TODAY));
  assert.equal(empty.text, "Nenhum gasto registrado em hoje.");
});

test("runListExpenses -- mes nomeado, intervalo e erros de periodo (RN06/RN07)", () => {
  const n = user();
  add(n, { amount: 20, description: "setembro um", date: "2026-09-10", category: "Mercado" });
  add(n, { amount: 30, description: "setembro dois", date: "2026-09-20", category: "Lazer" });
  add(n, { amount: 40, description: "setembro tres", date: "2026-09-30", category: "Mercado" });
  add(n, { amount: 50, description: "outubro", date: "2026-10-02", category: "Mercado" });

  const month = reply(runListExpenses(n, { month: "2026-09" }, TODAY));
  assert.match(month.text, /^🧾 Gastos — setembro\/2026\n\n📅 qua 30\/09\n1\. R\$ 40,00 — setembro tres/);
  assert.match(month.text, /💰 Total: R\$ 90,00\n/);
  assert.ok(!month.text.includes("outubro"));

  const interval = reply(runListExpenses(n, { date_start: "2026-09-10", date_end: "2026-09-20" }, TODAY));
  assert.match(interval.text, /^🧾 Gastos — 10\/09 a 20\/09\n/);
  assert.equal(interval.shownIds?.length, 2);

  assert.equal(reply(runListExpenses(n, { month: "2026-12" }, TODAY)).text, "Nenhum gasto registrado em dezembro/2026.", "mes futuro");
  assert.equal(reply(runListExpenses(n, { month: "2026-09", category: "lazer" }, TODAY)).text.split("\n")[0], "🧾 Gastos de Lazer — setembro/2026");
  assert.equal(reply(runListExpenses(n, { month: "2026-08", category: "lazer" }, TODAY)).text, "Nenhum gasto de Lazer em agosto/2026.");
  assert.equal(reply(runListExpenses(n, { date_start: "2026-09-20", date_end: "2026-09-10" }, TODAY)).text, INVALID_RANGE_TEXT);
  assert.equal(reply(runListExpenses(n, { date_start: "2025-01-01", date_end: "2026-09-10" }, TODAY)).text, INVALID_RANGE_TEXT);
  assert.equal(reply(runListExpenses(n, { month: "setembro" }, TODAY)).text, INVALID_MONTH_TEXT);

  // ultimas N dentro de um mes
  const lastInMonth = reply(runListExpenses(n, { month: "2026-09", last_n: 2 }, TODAY));
  assert.match(lastInMonth.text, /^🧾 Últimos 2 gastos \(setembro\/2026\)\n/);
  assert.equal(lastInMonth.shownIds?.length, 2);
});

test("runListExpenses -- teto de 30 linhas, '...e mais N', link do painel e total do conjunto completo (RN10)", () => {
  const n = user();
  for (let i = 1; i <= 37; i++) add(n, { amount: 10, description: `gasto ${i}`, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, category: "Mercado" });
  const out = reply(runListExpenses(n, { month: "2026-09" }, TODAY));
  assert.equal(out.shownIds?.length, 30);
  assert.match(out.text, /…e mais 7 gastos\. Veja tudo no painel: /);
  assert.ok(out.text.includes(config.dashboardUrl));
  assert.match(out.text, /💰 Total: R\$ 370,00 em 37 gastos \(mostrando 30\)/);
  assert.ok(out.text.length <= 3500);

  // 30 exatos nao cortam
  const m = user();
  for (let i = 1; i <= 30; i++) add(m, { description: `g${i}`, date: "2026-09-10" });
  const exact = reply(runListExpenses(m, { month: "2026-09" }, TODAY));
  assert.equal(exact.shownIds?.length, 30);
  assert.ok(!exact.text.includes("…e mais"));
  assert.match(exact.text, /💰 Total: R\$ 300,00\n/);
  // resultado da pergunta "detalhado" (periodExpenseList) usa a mesma lista
  const detailed = periodExpenseList(m, { start: "2026-09-01", end: "2026-10-01", label: "setembro/2026" }, {}, TODAY);
  assert.equal(detailed.type, "reply");
});

test("runExpenseReport -- mes, forma de pagamento, categoria (sem a quebra), intervalo e erros (RN05)", () => {
  const n = user();
  add(n, { amount: 100, description: "a", category: "Mercado", payment: "Nubank", date: "2026-09-05" });
  add(n, { amount: 50, description: "b", category: "Lazer", payment: "Nubank", date: "2026-09-10" });
  add(n, { amount: 30, description: "c", category: "Mercado", payment: "Pix", date: "2026-09-20" });
  add(n, { amount: 60, description: "ago", category: "Mercado", payment: "Nubank", date: "2026-08-20" });

  const month = runExpenseReport(n, { month: "2026-09" }, TODAY);
  assert.match(month.text, /^💰 Gastos — setembro\/2026\n\nTotal: R\$ 180,00 em 3 gasto\(s\)/);
  assert.match(month.text, /🔺 200% em relação ao período anterior \(R\$ 60,00\)/);
  assert.match(month.text, /• Mercado: R\$ 130,00\n• Lazer: R\$ 50,00$/);
  assert.equal(month.log, "setembro/2026");

  const nubank = runExpenseReport(n, { month: "2026-09", payment_method: "nubank" }, TODAY);
  assert.match(nubank.text, /^💰 Nubank — setembro\/2026\n\nTotal: R\$ 150,00 em 2 gasto\(s\)/);
  assert.match(nubank.text, /• Mercado: R\$ 100,00\n• Lazer: R\$ 50,00$/, "so forma de pagamento mantem a quebra por categoria");

  const both = runExpenseReport(n, { month: "2026-09", payment_method: "nubank", category: "mercado" }, TODAY);
  assert.match(both.text, /^💰 Mercado · Nubank — setembro\/2026\n\nTotal: R\$ 100,00 em 1 gasto\(s\)/);
  assert.ok(!both.text.includes("•"), "com categoria nao repete a quebra");

  assert.match(runExpenseReport(n, { date_start: "2026-09-01", date_end: "2026-09-10" }, TODAY).text, /^💰 Gastos — 01\/09 a 10\/09\n\nTotal: R\$ 150,00/);
  assert.equal(runExpenseReport(n, { month: "2026-12" }, TODAY).text, "💰 Gastos — dezembro/2026\n\nNenhum gasto registrado nesse período.");
  assert.equal(runExpenseReport(n, { payment_method: "inter" }, TODAY).text.startsWith('Não achei a forma de pagamento "inter".'), true);
  assert.equal(runExpenseReport(n, { category: "viagens" }, TODAY).text, 'Não achei a categoria "viagens". Pra ver as suas, diga "minhas categorias".');
  assert.equal(runExpenseReport(n, { date_start: "2026-09-20", date_end: "2026-09-01" }, TODAY).text, INVALID_RANGE_TEXT);
  // sem periodo = esse mes
  assert.match(runExpenseReport(n, {}, TODAY).text, /^💰 Gastos — esse mês \(outubro de 2026\)/);
  assert.match(runExpenseReport(n, { period: "week" }, TODAY).text, /^💰 Gastos — essa semana/);
});

test("runIncomeReport, runListIncomes e runBalance -- mes, intervalo, 'mes passado' e formato padrao (RN09)", () => {
  const n = user();
  insertIncome({ fromNumber: n, amount: 3000, description: "Salário", date: "2026-09-05" });
  insertIncome({ fromNumber: n, amount: 500, description: "Freela", date: "2026-09-15" });
  insertIncome({ fromNumber: n, amount: 200, description: "Outubro", date: "2026-10-02" });
  add(n, { amount: 400, description: "mercado", category: "Mercado", payment: "Pix", date: "2026-09-12" });
  add(n, { amount: 1000, description: "tv", category: "Compras", payment: "Crédito", date: "2026-09-13" });

  assert.equal(runIncomeReport(n, { month: "2026-09" }, TODAY).text, "💵 Entradas — setembro/2026\n\nTotal: R$ 3.500,00 em 2 entrada(s)");
  assert.equal(runIncomeReport(n, { date_start: "2026-09-10", date_end: "2026-09-20" }, TODAY).text, "💵 Entradas — 10/09 a 20/09\n\nTotal: R$ 500,00 em 1 entrada(s)");
  assert.equal(runIncomeReport(n, { month: "2026-08" }, TODAY).text, "💵 Entradas — agosto/2026\n\nNenhuma entrada registrada nesse período.");
  assert.equal(runIncomeReport(n, {}, TODAY).text, "💵 Entradas — esse mês (outubro de 2026)\n\nTotal: R$ 200,00 em 1 entrada(s)");
  assert.equal(runIncomeReport(n, { month: "setembro" }, TODAY).text, INVALID_MONTH_TEXT);
  assert.equal(runIncomeReport(n, { date_start: "2026-09-20", date_end: "2026-09-10" }, TODAY).text, INVALID_RANGE_TEXT);

  const list = runListIncomes(n, { month: "2026-09" }, TODAY);
  assert.match(list.text, /^💵 Entradas — setembro\/2026\n\n1\. Freela — R\$ 500,00 · 15\/09\n2\. Salário — R\$ 3\.000,00 · 05\/09\n/);
  assert.equal(list.shownIds?.length, 2);
  assert.equal(list.label, "setembro/2026");
  assert.equal(runListIncomes(n, { month: "2026-01" }, TODAY).text, "💵 Entradas — janeiro/2026\n\nNenhuma entrada registrada nesse período.");
  assert.equal(runListIncomes(n, { date_start: "2026-09-20", date_end: "2026-09-10" }, TODAY).text, INVALID_RANGE_TEXT);
  assert.equal(runListIncomes(n, { month: "2026-01" }, TODAY).shownIds, undefined);

  const balance = runBalance(n, { month: "2026-09" }, TODAY);
  assert.match(balance.text, /^📊 Saldo — setembro\/2026\n\n💵 Entradas: R\$ 3\.500,00\n💰 Gastos \(Pix\/dinheiro\): R\$ 400,00\n✅ Saldo: R\$ 3\.100,00\n\n💳 No cartão: R\$ 1\.000,00 \(não abate do saldo\)/);
  assert.match(runBalance(n, { date_start: "2026-09-12", date_end: "2026-09-13" }, TODAY).text, /^📊 Saldo — 12\/09 a 13\/09\n/);
  assert.match(runBalance(n, {}, TODAY).text, /^📊 Saldo — esse mês \(outubro de 2026\)/);
  assert.equal(runBalance(n, { month: "13" }, TODAY).text, INVALID_MONTH_TEXT);
  assert.match(runBalance(n, { month: "2026-12" }, TODAY).text, /Saldo: R\$ 0,00/);
});

test("consultas isoladas por numero", () => {
  const a = user();
  const b = user();
  add(a, { amount: 77, description: "so do a", category: "Mercado", payment: "Pix", date: "2026-09-10" });
  insertIncome({ fromNumber: a, amount: 900, description: "so do a", date: "2026-09-10" });
  assert.equal(reply(runListExpenses(b, { month: "2026-09" }, TODAY)).text, "Nenhum gasto registrado em setembro/2026.");
  assert.equal(reply(runListExpenses(b, { last_n: 10 }, TODAY)).text, "Você ainda não tem nenhum gasto registrado.");
  assert.match(runExpenseReport(b, { month: "2026-09" }, TODAY).text, /Nenhum gasto registrado nesse período/);
  assert.match(runIncomeReport(b, { month: "2026-09" }, TODAY).text, /Nenhuma entrada registrada/);
});
