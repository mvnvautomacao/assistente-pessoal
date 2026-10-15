// Card 14: consultas de gastos e entradas -- ultimas N, filtros por categoria e forma de pagamento, meses passados,
// intervalos, teto de itens e formato padrao. Relogio fixo em 14/10/2026 12:00 (SP) salvo onde o teste diz outra coisa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, getOrCreatePaymentMethod, insertExpense, setDefaultPaymentMethod } from "../../src/expenses/service";
import { insertIncome } from "../../src/incomes/service";
import { allowNumber } from "../../src/access/allowlist";
import { INVALID_RANGE_TEXT } from "../../src/expenses/queryRange";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-14T12:00:00-03:00"); // quarta-feira

let seq = 0;
function user(): string {
  const n = `55110009700${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  return n;
}

function add(n: string, over: { amount?: number; description: string; date?: string; category?: string; payment?: string }) {
  return insertExpense({
    fromNumber: n,
    amount: over.amount ?? 10,
    description: over.description,
    categoryId: over.category ? getOrCreateCategory(n, over.category).id : null,
    paymentMethodId: over.payment ? getOrCreatePaymentMethod(n, over.payment).id : null,
    date: over.date ?? "2026-10-14",
  });
}

async function ask(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("Card 14: 'mostra as 10 ultimas compras' lista as 10 mais recentes numeradas, com total e rodape; 'muda o valor do 2' edita o item 2", async (t) => {
  const n = user();
  for (let i = 1; i <= 12; i++) add(n, { amount: i, description: `compra ${i}`, date: i <= 7 ? "2026-10-14" : "2026-10-13", category: "Mercado", payment: "Pix" });
  const app = bootApp(t, NOW);
  const text = await ask(app, n, "mostra as 10 últimas compras", { type: "list_expenses", last_n: 10 });
  assert.match(text, /^🧾 Últimos 10 gastos\n\n1\. R\$ 7,00 — compra 7 \(Mercado, Pix\) — hoje\n/);
  assert.equal(text.split("\n").filter((l) => /^\d+\. /.test(l)).length, 10);
  assert.match(text, /\n10\. R\$ 10,00 — compra 10 \(Mercado, Pix\) — ontem\n/);
  assert.match(text, /💰 Total: R\$ 61,00\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45"\.$/); // 7+6+5+4+3+2+1+12+11+10

  // a lista mostrada vale pro "muda o valor do 2 pra 45"
  const preview = await ask(app, n, "muda o valor do 2 pra 45", { type: "edit_expense", list_ref: 2, changes: [{ field: "amount", value: "45" }] });
  assert.match(preview, /compra 6/);
  assert.match(preview, /Valor: R\$ 6,00 → R\$ 45,00/);
});

test("Card 14: 'ultimas 5' = 5, 'ultimas compras' sem numero = 10, 'ultimas 50' = 20 com o aviso de maximo", async (t) => {
  const n = user();
  for (let i = 1; i <= 25; i++) add(n, { description: `compra ${i}`, date: "2026-10-10" });
  const app = bootApp(t, NOW);
  const count = (text: string) => text.split("\n").filter((l) => /^\d+\. /.test(l)).length;
  assert.equal(count(await ask(app, n, "últimas 5 compras", { type: "list_expenses", last_n: 5 })), 5);
  assert.equal(count(await ask(app, n, "últimas compras", { type: "list_expenses", last_n: 10 })), 10);
  const fifty = await ask(app, n, "últimas 50 compras", { type: "list_expenses", last_n: 50 });
  assert.equal(count(fifty), 20);
  assert.match(fifty, /Mostrei as 20 últimas \(é o máximo por mensagem\)\./);
});

test("Card 14: filtros por categoria e forma de pagamento (separados, juntos e sem periodo = ultimos 10)", async (t) => {
  const n = user();
  add(n, { description: "mercado pix", category: "Mercado", payment: "Pix" });
  add(n, { description: "mercado nubank", category: "Mercado", payment: "Nubank" });
  add(n, { description: "uber pix", category: "Transporte", payment: "Pix" });
  const app = bootApp(t, NOW);

  const mercado = await ask(app, n, "últimas 10 de mercado", { type: "list_expenses", last_n: 10, category: "Mercado" });
  assert.match(mercado, /^🧾 Mercado — últimos 2 gastos\n/);
  assert.ok(mercado.includes("mercado pix") && mercado.includes("mercado nubank") && !mercado.includes("uber"));

  const pix = await ask(app, n, "gastos no pix", { type: "list_expenses", payment_method: "Pix" });
  assert.match(pix, /^🧾 Pix — últimos 2 gastos\n/);
  assert.ok(pix.includes("mercado pix") && pix.includes("uber pix") && !pix.includes("nubank"));

  const both = await ask(app, n, "últimas 5 de mercado no pix", { type: "list_expenses", last_n: 5, category: "Mercado", payment_method: "Pix" });
  assert.match(both, /^🧾 Mercado · Pix — último gasto\n/);
  assert.ok(both.includes("mercado pix") && !both.includes("nubank") && !both.includes("uber"));

  const noPeriod = await ask(app, n, "gastos de mercado", { type: "list_expenses", category: "Mercado" });
  assert.match(noPeriod, /^🧾 Mercado — últimos 2 gastos\n/);
});

test("Card 14: filtro com periodo ('mercado essa semana') lista direto, sem 'resumo ou detalhado'; sem filtro a pergunta continua", async (t) => {
  const n = user();
  add(n, { amount: 40, description: "mercado a", category: "Mercado", payment: "Pix", date: "2026-10-12" });
  add(n, { amount: 99, description: "lazer b", category: "Lazer", payment: "Pix", date: "2026-10-13" });
  const app = bootApp(t, NOW);

  const week = await ask(app, n, "gastos de mercado essa semana", { type: "list_expenses", category: "Mercado", days: 7 });
  assert.match(week, /^🧾 Gastos de Mercado — últimos 7 dias\n\n📅 seg 12\/10\n1\. R\$ 40,00 — mercado a/);
  assert.equal(app.sent.length, 1, "uma mensagem so, sem pergunta");

  const noFilter = await ask(app, n, "gastos dos últimos 3 dias", { type: "list_expenses", days: 3 });
  assert.equal(noFilter, 'Você quer o *resumo por categoria* (com o total, como antes) ou o *detalhado*, com cada gasto separado por dia? Responde "resumo" ou "detalhado".');
  const detailed = await ask(app, n, "detalhado");
  assert.match(detailed, /^🧾 Gastos — últimos 3 dias\n\n📅 ter 13\/10/);
  assert.match(detailed, /lazer b/);
  assert.match(detailed, /💰 Total: R\$ 139,00\n/);

  await ask(app, n, "gastos dos últimos 3 dias", { type: "list_expenses", days: 3 });
  const summary = await ask(app, n, "resumo");
  assert.match(summary, /^💰 Gastos — últimos 3 dias\n\nTotal: R\$ 139,00 em 2 gasto\(s\)/);
});

test("Card 14: categoria ou forma de pagamento inexistente -> mensagem com o nome e nenhuma lista", async (t) => {
  const n = user();
  add(n, { description: "algo" });
  const app = bootApp(t, NOW);
  assert.equal(await ask(app, n, "gastos de viagens", { type: "list_expenses", category: "viagens" }), 'Não achei a categoria "viagens". Pra ver as suas, diga "minhas categorias".');
  assert.match(await ask(app, n, "gastos no inter", { type: "list_expenses", payment_method: "inter" }), /^Não achei a forma de pagamento "inter"\./);
  assert.equal(await ask(app, n, "quanto gastei em viagens", { type: "expense_report", category: "viagens" }), 'Não achei a categoria "viagens". Pra ver as suas, diga "minhas categorias".');
  assert.equal(app.sent.length, 3);
});

test("Card 14: 'quanto gastei em setembro' e 'mes passado' -> resumo do mes com comparacao; 'no Nubank em setembro' filtra por pagamento", async (t) => {
  const n = user();
  add(n, { amount: 100, description: "a", category: "Mercado", payment: "Nubank", date: "2026-09-05" });
  add(n, { amount: 50, description: "b", category: "Lazer", payment: "Pix", date: "2026-09-10" });
  add(n, { amount: 40, description: "ago", category: "Mercado", payment: "Nubank", date: "2026-08-15" });
  add(n, { amount: 7, description: "outubro", category: "Mercado", payment: "Nubank", date: "2026-10-02" });
  const app = bootApp(t, NOW);

  const setembro = await ask(app, n, "quanto gastei em setembro", { type: "expense_report", month: "2026-09" });
  assert.match(setembro, /^💰 Gastos — setembro\/2026\n\nTotal: R\$ 150,00 em 2 gasto\(s\)/);
  assert.match(setembro, /% em relação ao período anterior \(R\$ 40,00\)/);
  assert.match(setembro, /• Mercado: R\$ 100,00\n• Lazer: R\$ 50,00$/);

  const passado = await ask(app, n, "quanto gastei no mês passado", { type: "expense_report", month: "2026-09" });
  assert.equal(passado, setembro);

  const nubank = await ask(app, n, "quanto gastei no Nubank em setembro", { type: "expense_report", month: "2026-09", payment_method: "Nubank" });
  assert.match(nubank, /^💰 Nubank — setembro\/2026\n\nTotal: R\$ 100,00 em 1 gasto\(s\)/);

  const futuro = await ask(app, n, "quanto gastei em dezembro", { type: "expense_report", month: "2026-12" });
  assert.equal(futuro, "💰 Gastos — dezembro/2026\n\nNenhum gasto registrado nesse período.");

  // sem periodo: esse mes (mudou so o formato do valor)
  assert.match(await ask(app, n, "quanto gastei esse mês", { type: "expense_report", period: "month" }), /^💰 Gastos — esse mês \(outubro de 2026\)\n\nTotal: R\$ 7,00 em 1 gasto\(s\)/);
});

test("Card 14: 'gastos de 10 a 20 de setembro' lista por dia no intervalo; intervalo invalido pede outro periodo", async (t) => {
  const n = user();
  add(n, { amount: 11, description: "dia 10", date: "2026-09-10", category: "Mercado" });
  add(n, { amount: 22, description: "dia 20", date: "2026-09-20", category: "Mercado" });
  add(n, { amount: 33, description: "dia 21", date: "2026-09-21", category: "Mercado" });
  add(n, { amount: 44, description: "dia 09", date: "2026-09-09", category: "Mercado" });
  const app = bootApp(t, NOW);
  const text = await ask(app, n, "gastos de 10 a 20 de setembro", { type: "list_expenses", date_start: "2026-09-10", date_end: "2026-09-20" });
  assert.match(text, /^🧾 Gastos — 10\/09 a 20\/09\n\n📅 dom 20\/09\n1\. R\$ 22,00 — dia 20 \(Mercado\)\n\n📅 qui 10\/09\n2\. R\$ 11,00 — dia 10 \(Mercado\)\n\n💰 Total: R\$ 33,00\n/);
  assert.ok(!text.includes("dia 21") && !text.includes("dia 09"));

  assert.equal(await ask(app, n, "gastos de 20 a 10 de setembro", { type: "list_expenses", date_start: "2026-09-20", date_end: "2026-09-10" }), INVALID_RANGE_TEXT);
  assert.equal(await ask(app, n, "gastos de janeiro de 2025 a setembro", { type: "list_expenses", date_start: "2025-01-01", date_end: "2026-09-10" }), INVALID_RANGE_TEXT);
});

test("Card 14: income_report, list_incomes e balance com mes ('mes passado') e intervalo", async (t) => {
  const n = user();
  insertIncome({ fromNumber: n, amount: 3000, description: "Salário", date: "2026-09-05" });
  insertIncome({ fromNumber: n, amount: 500, description: "Freela", date: "2026-09-15" });
  insertIncome({ fromNumber: n, amount: 100, description: "Outubro", date: "2026-10-03" });
  add(n, { amount: 400, description: "mercado", date: "2026-09-12", category: "Mercado", payment: "Pix" });
  const app = bootApp(t, NOW);

  assert.equal(await ask(app, n, "quanto recebi no mês passado", { type: "income_report", month: "2026-09" }), "💵 Entradas — setembro/2026\n\nTotal: R$ 3.500,00 em 2 entrada(s)");
  assert.equal(await ask(app, n, "entradas de 10 a 20", { type: "income_report", date_start: "2026-09-10", date_end: "2026-09-20" }), "💵 Entradas — 10/09 a 20/09\n\nTotal: R$ 500,00 em 1 entrada(s)");
  const list = await ask(app, n, "minhas entradas de setembro", { type: "list_incomes", month: "2026-09" });
  assert.match(list, /^💵 Entradas — setembro\/2026\n\n1\. Freela — R\$ 500,00 · 15\/09\n2\. Salário — R\$ 3\.000,00 · 05\/09\n/);
  assert.match(await ask(app, n, "saldo de setembro", { type: "balance", month: "2026-09" }), /^📊 Saldo — setembro\/2026\n\n💵 Entradas: R\$ 3\.500,00\n💰 Gastos \(Pix\/dinheiro\): R\$ 400,00\n✅ Saldo: R\$ 3\.100,00/);
  assert.match(await ask(app, n, "saldo de 10 a 20", { type: "balance", date_start: "2026-09-10", date_end: "2026-09-20" }), /^📊 Saldo — 10\/09 a 20\/09\n\n💵 Entradas: R\$ 500,00\n💰 Gastos \(Pix\/dinheiro\): R\$ 400,00/);

  // "editar a entrada 1" depois da lista com mes: a numeracao vale
  const edit = await ask(app, n, "muda o valor da 1 pra 600", { type: "edit_income", list_ref: 1, changes: [{ field: "amount", value: "600" }] });
  assert.match(edit, /Freela/);
});

test("Card 14: mais de 30 gastos no periodo -> 30 linhas, '...e mais N' com o link do painel e total do conjunto completo", async (t) => {
  const n = user();
  for (let i = 1; i <= 35; i++) add(n, { amount: 10, description: `gasto ${i}`, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, category: "Mercado" });
  const app = bootApp(t, NOW);
  const text = await ask(app, n, "gastos de setembro", { type: "list_expenses", month: "2026-09" });
  assert.equal(text.split("\n").filter((l) => /^\d+\. /.test(l)).length, 30);
  assert.match(text, /…e mais 5 gastos\. Veja tudo no painel: /);
  assert.ok(text.includes(config.dashboardUrl));
  assert.match(text, /💰 Total: R\$ 350,00 em 35 gastos \(mostrando 30\)/);
  assert.ok(text.length <= 3500);

  // "muda o 30" vale (so os mostrados foram guardados); o 31 nao existe na lista
  const ok = await ask(app, n, "muda o valor do 30 pra 99", { type: "edit_expense", list_ref: 30, changes: [{ field: "amount", value: "99" }] });
  assert.match(ok, /Valor: R\$ 10,00 → R\$ 99,00/);
  await ask(app, n, "cancelar");
  const missing = await ask(app, n, "muda o valor do 31 pra 99", { type: "edit_expense", list_ref: 31, changes: [{ field: "amount", value: "99" }] });
  assert.match(missing, /Não sei a que gasto o número "31" se refere/);
});

test("Card 14: duas consultas seguidas -- 'muda o 2' refere-se a ULTIMA lista mostrada", async (t) => {
  const n = user();
  const a1 = add(n, { description: "primeira lista a", date: "2026-10-14" });
  const a2 = add(n, { description: "primeira lista b", date: "2026-10-14" });
  const m1 = add(n, { description: "mercado antigo", category: "Mercado", date: "2026-09-01" });
  const m2 = add(n, { description: "mercado velho", category: "Mercado", date: "2026-08-01" });
  const app = bootApp(t, NOW);
  await ask(app, n, "gastos de hoje", { type: "list_expenses", date: "2026-10-14" });
  await ask(app, n, "últimas de mercado", { type: "list_expenses", last_n: 10, category: "Mercado" });
  await ask(app, n, "muda o valor do 2 pra 45", { type: "edit_expense", list_ref: 2, changes: [{ field: "amount", value: "45" }] });
  assert.match(app.last(), /mercado velho/);
  await ask(app, n, "1");
  assert.equal(getExpenseById(n, m2.id)?.amount, 45);
  assert.equal(getExpenseById(n, a2.id)?.amount, 10);
  assert.equal(getExpenseById(n, m1.id)?.amount, 10);
  assert.equal(getExpenseById(n, a1.id)?.amount, 10);
});

test("Card 14: 22h em Sao Paulo com o servidor em UTC -- 'hoje', semana e mes usam a data de SP", async (t) => {
  const n = user();
  add(n, { amount: 21, description: "gasto de hoje em SP", date: "2026-10-14" });
  add(n, { amount: 99, description: "gasto de amanha em UTC", date: "2026-10-15" });
  const originalTz = process.env.TZ;
  process.env.TZ = "UTC";
  t.after(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  const app = bootApp(t, at("2026-10-15T01:30:00Z")); // 22:30 de 14/10 em SP
  const today = await ask(app, n, "gastos de hoje", { type: "list_expenses" });
  assert.ok(app.sent.some((m) => m.text.startsWith("Você não disse o dia")));
  assert.match(today, /gasto de hoje em SP/);
  assert.ok(!today.includes("amanha em UTC"));
  const week = await ask(app, n, "quanto gastei essa semana", { type: "expense_report", period: "week" });
  assert.match(week, /^💰 Gastos — essa semana\n\nTotal: R\$ 21,00 em 1 gasto\(s\)/);
  const month = await ask(app, n, "quanto gastei esse mês", { type: "expense_report", period: "month" });
  assert.match(month, /^💰 Gastos — esse mês \(outubro de 2026\)\n\nTotal: R\$ 120,00 em 2 gasto\(s\)/);
});

test("Card 14: outro numero com gastos nunca aparece nas listas e relatorios", async (t) => {
  const a = user();
  const b = user();
  add(a, { amount: 500, description: "segredo do a", category: "Mercado", payment: "Pix" });
  insertIncome({ fromNumber: a, amount: 900, description: "salario do a", date: "2026-10-05" });
  const app = bootApp(t, NOW);
  assert.equal(await ask(app, b, "últimas compras", { type: "list_expenses", last_n: 10 }), "Você ainda não tem nenhum gasto registrado.");
  assert.equal(await ask(app, b, "gastos de mercado", { type: "list_expenses", category: "mercado" }), "Nenhum gasto de Mercado registrado.");
  assert.match(await ask(app, b, "quanto gastei esse mês", { type: "expense_report", period: "month" }), /Nenhum gasto registrado nesse período/);
  assert.match(await ask(app, b, "minhas entradas", { type: "list_incomes", period: "month" }), /Nenhuma entrada registrada/);
  assert.ok(!app.sent.some((m) => m.to === b && m.text.includes("segredo do a")));
});

test("Card 14: valores e datas no formato padrao (R$ 38,00 e hoje/ontem/dd/MM)", async (t) => {
  const n = user();
  add(n, { amount: 38, description: "hoje", date: "2026-10-14", category: "Mercado", payment: "Pix" });
  add(n, { amount: 1234.5, description: "ontem", date: "2026-10-13", category: "Mercado", payment: "Pix" });
  add(n, { amount: 5, description: "antigo", date: "2026-10-01" });
  const app = bootApp(t, NOW);
  const text = await ask(app, n, "últimas compras", { type: "list_expenses", last_n: 10 });
  assert.ok(text.includes("1. R$ 38,00 — hoje (Mercado, Pix) — hoje"));
  assert.ok(text.includes("2. R$ 1.234,50 — ontem (Mercado, Pix) — ontem"));
  assert.ok(text.includes("3. R$ 5,00 — antigo (sem categoria) — 01/10"));
  assert.ok(!/R\$\d/.test(text) && !text.includes("/2026"));
});
