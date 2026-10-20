// Card 21, parte 3 (D-09, D-10): dinheiro sempre "R$ 10,00", data+hora sempre "qui 15/10 às 10:00", boas-vindas curta e ajuda por assunto.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreateCategory, insertExpense } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { setBudget } from "../../src/expenses/budgets";

const NOW = new Date("2026-10-15T10:00:00-03:00").getTime();

let seq = 0;
function user(): string {
  const n = `55110008800${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function ask(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  const before = app.sent.length;
  app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.sent.slice(before).map((m) => m.text);
}

const NO_OLD_MONEY = /R\$\d|R\$ ?\d+\.\d{2}\b/;

test("D-09: gasto, entrada, orcamento e total saem com 'R$ 10,00' (nunca R$10.00)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const texts: string[] = [];
  texts.push(...(await ask(app, n, "gastei 1234.5 no mercado", { type: "expense", amount: 1234.5, description: "mercado", category: "Mercado", payment_method: "Pix" })));
  texts.push(...(await ask(app, n, "recebi 3500 de salario", { type: "income", amount: 3500, description: "salario", date: "2026-10-15" })));
  texts.push(...(await ask(app, n, "orcamento de mercado 500", { type: "set_budget", category: "Mercado", amount: 500 })));
  texts.push(...(await ask(app, n, "orcamentos", { type: "list_budgets" })));
  assert.ok(texts.some((x) => x.includes("R$ 1.234,50")), texts.join("\n"));
  assert.ok(texts.some((x) => x.includes("R$ 3.500,00")), texts.join("\n"));
  assert.ok(texts.some((x) => x.includes("R$ 500,00")), texts.join("\n"));
  for (const text of texts) assert.doesNotMatch(text, NO_OLD_MONEY, text);
});

test("D-09: aviso de orcamento (80% e estouro) usa formatBRL", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const cat = getOrCreateCategory(n, "Lazer");
  setBudget(n, cat.id, 100);
  const first = await ask(app, n, "gastei 85 no cinema", { type: "expense", amount: 85, description: "cinema", category: "Lazer", payment_method: "Pix" });
  assert.ok(first.some((x) => x.includes("(R$ 85,00 de R$ 100,00)")), first.join("\n"));
  const second = await ask(app, n, "gastei 30 no teatro", { type: "expense", amount: 30, description: "teatro", category: "Lazer", payment_method: "Pix" });
  assert.ok(second.some((x) => x.includes("R$ 115,00 de R$ 100,00 (115%)")), second.join("\n"));
  insertExpense({ fromNumber: n, amount: 1, description: "x", categoryId: cat.id, paymentMethodId: null, date: "2026-10-15" });
});

test("D-09: evento e lembrete criados mostram 'ter 20/10 às 10:00' (sem segundos nem ano)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const [ev] = await ask(app, n, "marca dentista dia 20 as 10h", { type: "event", title: "dentista", start: "2026-10-20T10:00:00-03:00" });
  assert.match(ev, /criado na agenda em ter 20\/10 às 10:00 \(aviso/);
  const [rem] = await ask(app, n, "me lembra de pagar dia 21 as 9h", { type: "reminder", message: "pagar", due_at: "2026-10-21T09:00:00-03:00" });
  assert.match(rem, /vou avisar em qua 21\/10 às 09:00/);
  assert.doesNotMatch(ev + rem, /\d{2}:\d{2}:\d{2}/);
});

test("D-10: boas-vindas cabe numa tela (curta) e cita gasto, entrada, agenda, lembrete, consulta, conta fixa, editar/apagar, desfazer e ajuda", async (t) => {
  const app = bootApp(t, NOW);
  const n = `55110008899${seq++}`;
  allowNumber(n);
  app.resetLimit();
  await app.handle(msg(n, "oi"));
  const welcome = app.sent.find((m) => m.to === n)!.text;
  assert.ok(welcome.length <= 1000, `boas-vindas com ${welcome.length} caracteres`);
  assert.ok(welcome.split("\n").length <= 20);
  for (const part of ["gastei 50", "recebi", "marca dentista", "me lembra", "quanto gastei este mês", "todo dia 10", "apaga o 3", "desfazer", "ajuda"]) {
    assert.ok(welcome.includes(part), `faltou "${part}"`);
  }
});

test("D-10: ajuda por assunto 'agenda' (agenda numerada) e os assuntos de entradas, consultas e contas fixas existem", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const [agenda] = await ask(app, n, "como mexo na agenda", { type: "help", topic: "agenda" });
  assert.match(agenda, /Como ver a agenda e mexer pelo número/);
  assert.match(agenda, /"cancela o 3"/);
  const [income] = await ask(app, n, "como registro entrada", { type: "help", topic: "income" });
  assert.match(income, /entrada de dinheiro/);
  const [report] = await ask(app, n, "como vejo quanto gastei", { type: "help", topic: "expense_report" });
  assert.match(report, /quanto gastei esse mês/);
  const [fixed] = await ask(app, n, "como cadastro conta fixa", { type: "help", topic: "recurring_expense" });
  assert.match(fixed, /gasto fixo/);
});
