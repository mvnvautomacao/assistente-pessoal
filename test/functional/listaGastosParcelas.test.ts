// Card 17 (RN01, RN02): "editar gasto" e "ultimas compras" mostram os 10 gastos reais mais recentes; parcelas de meses
// futuros so no mes delas (ou quando pedidas). Reproduz o defeito reportado: compra parcelada empurrava o gasto de hoje.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, insertExpense, getOrCreateCategory } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-17T12:00:00-03:00");
const TODAY = "2026-10-17";

let seq = 0;
function user(): string {
  const n = `55110009300${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

function add(n: string, description: string, date: string, amount = 10) {
  return insertExpense({ fromNumber: n, amount, description, categoryId: getOrCreateCategory(n, "Outros").id, paymentMethodId: null, date });
}

// compra parcelada: uma linha por parcela, a primeira em firstDate e as outras nos meses seguintes
function parcelado(n: string, nome: string, firstDate: string, parcelas: number) {
  const [y, m, d] = firstDate.split("-").map(Number);
  for (let i = 0; i < parcelas; i++) {
    const total = y * 12 + (m - 1) + i;
    const date = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
    add(n, `${nome} (parcela ${i + 1}/${parcelas})`, date, 100);
  }
}

test("Card 17 (defeito 2): compra parcelada em 6x registrada hoje -- 'editar gasto' mostra a parcela 1 em primeiro e nao as parcelas futuras", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Mercado antigo", "2026-10-10");
  parcelado(n, "Tênis", TODAY, 6);
  await say(app, n, "editar");
  const list = await say(app, n, "1");
  assert.match(list, /^Seus últimos gastos:\n1\. Tênis \(parcela 1\/6\)/, list);
  assert.ok(!list.includes("parcela 2/6"), list);
  assert.ok(list.includes("Mercado antigo"));
});

test("Card 17: 'ultimas compras' tem o mesmo comportamento -- parcela 1 em primeiro, parcelas futuras ocultas", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Padaria", "2026-10-16");
  parcelado(n, "Geladeira", TODAY, 6);
  const text = await say(app, n, "últimas compras", { type: "list_expenses", last_n: 10 });
  assert.match(text, /Geladeira \(parcela 1\/6\)[\s\S]*Padaria/);
  assert.ok(!text.includes("parcela 2/6"), text);
});

test("Card 17: parcela com vencimento mais adiante no mes atual aparece DEPOIS dos gastos que ja aconteceram", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Parcela do dia 25", "2026-10-25");
  add(n, "Mercado de hoje", TODAY);
  add(n, "Padaria de ontem", "2026-10-16");
  add(n, "Parcela de novembro", "2026-11-05");
  await say(app, n, "editar");
  const list = await say(app, n, "1");
  const order = ["Mercado de hoje", "Padaria de ontem", "Parcela do dia 25"].map((s) => list.indexOf(s));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], list);
  assert.ok(!list.includes("Parcela de novembro"));
});

test("Card 17: 'mostra as parcelas futuras' inclui meses futuros; 'gastos de novembro' mostra a parcela de novembro sem o pedido", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  parcelado(n, "Tênis", TODAY, 4);
  const future = await say(app, n, "mostra as parcelas futuras", { type: "list_expenses", include_future: true });
  assert.match(future, /^🧾 Últimos 4 gastos \(com parcelas futuras\)/);
  for (const p of [1, 2, 3, 4]) assert.ok(future.includes(`parcela ${p}/4`), future);
  assert.ok(future.indexOf("parcela 1/4") < future.indexOf("parcela 2/4") && future.indexOf("parcela 2/4") < future.indexOf("parcela 3/4"), "futuras do mais proximo ao mais distante");
  const nov = await say(app, n, "gastos de novembro", { type: "list_expenses", month: "2026-11" });
  assert.ok(nov.includes("Tênis (parcela 2/4)"), nov);
});

test("Card 17: na virada do mes a parcela do mes novo passa a aparecer sem nenhuma acao", async (t) => {
  const app = bootApp(t, at("2026-10-31T12:00:00-03:00"));
  const n = user();
  add(n, "Mercado", "2026-10-31");
  add(n, "Tênis (parcela 1/3)", "2026-10-31", 100);
  add(n, "Tênis (parcela 2/3)", "2026-11-30", 100);
  add(n, "Tênis (parcela 3/3)", "2026-12-31", 100);
  await say(app, n, "editar");
  const before = await say(app, n, "1");
  assert.ok(!before.includes("parcela 2/3"), before);
  await say(app, n, "cancelar");
  app.setNow(at("2026-11-01T09:00:00-03:00"));
  await say(app, n, "editar");
  const after = await say(app, n, "1");
  assert.ok(after.includes("parcela 2/3"), after);
  assert.ok(!after.includes("parcela 3/3"), after);
});

test("Card 17 (RN02): a lista tem 10 itens e a linha 'Mostrei os 10 mais recentes'; 'dez' escolhe o decimo; outro numero nao aparece", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const other = user();
  for (let i = 1; i <= 12; i++) add(n, `Gasto ${String(i).padStart(2, "0")}`, `2026-10-${String(i).padStart(2, "0")}`);
  add(other, "SEGREDO", TODAY);
  await say(app, n, "editar");
  const list = await say(app, n, "1");
  assert.equal(list.split("\n").filter((l) => /^\d+\. /.test(l)).length, 10);
  assert.match(list, /10\. Gasto 03/);
  assert.ok(list.includes('Mostrei os 10 mais recentes. Pra achar outro, diga o nome (ex: "muda o mercado").'), list);
  assert.ok(!list.includes("SEGREDO"));
  const menu = await say(app, n, "dez");
  assert.match(menu, /^✏️ Gasto 03 — /);
});

test("Card 17: 'apagar gasto' lista os gastos mais recentes (parcelas futuras de fora)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  parcelado(n, "Tênis", TODAY, 3);
  add(n, "Padaria", "2026-10-16");
  const text = await say(app, n, "apagar gasto");
  assert.match(text, /1\. Tênis \(parcela 1\/3\)/);
  assert.ok(!text.includes("parcela 2/3"), text);
});
