// Card 9: confirmacoes de apagar/remover no padrao 1/3, a prova de erro e persistentes
// (9 fluxos). Cada fluxo passa pelos mesmos cenarios: pergunta no formato novo, respostas
// ambiguas nao agem, 3/nao cancelam, 1/sim executam, reinicio do servidor no meio, expiracao
// aos 10 minutos (9m59s ainda vale), "cancelar" geral e isolamento entre numeros.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Interpretation } from "../../src/ai/interpret";
import { ensureUserSeeded, getOrCreateCategory, getOrCreatePaymentMethod, setDefaultPaymentMethod, insertExpense, getExpenseById, findCategoryByName, searchExpenses } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { addDaysToDateString, spDateString } from "../../src/timeSP";
import { db } from "../../src/db";
import { createEvent, getEventById } from "../../src/events/service";
import { createReminder, getReminderById } from "../../src/reminders/service";
import { createRecurringExpense, listRecurringExpenses } from "../../src/expenses/recurring";
import { createBillAlert, listBillAlerts } from "../../src/bills/service";
import { setBudget, getBudget } from "../../src/expenses/budgets";
import { deleteNotUnderstood } from "../../src/confirmation/deletePreview";

// ---- helpers ------------------------------------------------------------------

function msg(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `dc-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

function seed(...numbers: string[]) {
  for (const n of numbers) {
    ensureUserSeeded(n);
    allowNumber(n);
    setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  }
}

const today = () => spDateString();
const futureAt = (daysAhead: number, hour: number) => `${addDaysToDateString(today(), daysAhead)}T${String(hour).padStart(2, "0")}:00:00-03:00`;
const pendingKinds = (n: string) => (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);

type Sent = { to: string; text: string };
interface App {
  handle: (data: unknown) => Promise<void>;
  sent: Sent[];
  queueReply: (actions: Interpretation[]) => void;
  setNow: (offsetMs: number) => void;
  last: () => string;
}

// Reinicia o "servidor": descarta TODOS os modulos de src (menos o banco e a config) e recarrega
// o router. Todo estado em memoria some; o SQLite continua. Um relogio por teste.
const clocks = new WeakMap<TestContext, { offset: number }>();
function restartApp(t: TestContext): App {
  const srcDir = path.join(__dirname, "..", "..", "src");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir) && !/[\\/](db|config)\.js$/.test(key)) delete require.cache[key];
  }
  const client = require("../../src/whatsapp/client");
  const ai = require("../../src/ai/interpret");
  const router = require("../../src/router");
  const sent: Sent[] = [];
  t.mock.method(client, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  const queue: Interpretation[][] = [];
  t.mock.method(ai, "interpretText", async () => queue.shift() ?? []);
  let clock = clocks.get(t);
  if (!clock) {
    const realNow = Date.now();
    const created = { offset: 0 };
    clock = created;
    clocks.set(t, created);
    t.mock.method(Date, "now", () => realNow + created.offset);
  }
  const c = clock;
  return {
    handle: router.handleIncomingMessage,
    sent,
    queueReply: (a) => queue.push(a),
    setNow: (ms) => (c.offset = ms),
    last: () => sent[sent.length - 1].text,
  };
}

const MIN = 60 * 1000;

// ---- os 9 fluxos ---------------------------------------------------------------

interface Flow {
  name: string;
  kind: string; // tipo no pending_state
  setup: (n: string) => unknown;
  action: (ctx: any) => Interpretation;
  question: RegExp;
  notUnderstood: Parameters<typeof deleteNotUnderstood>[0];
  applied: (n: string, ctx: any) => boolean; // o efeito de confirmar ja aconteceu?
}

const flows: Flow[] = [
  {
    name: "cancelar evento",
    kind: "delete_event",
    setup: (n) => createEvent({ fromNumber: n, title: "Evento apagar c9", start: futureAt(3, 14), end: futureAt(3, 15) }),
    action: () => ({ type: "delete_event", query: "evento apagar c9" }),
    question: /^🗑️ Cancelar este evento\?\nEvento apagar c9 — .* às 14:00–15:00\n\n1 🗑️ Cancelar o evento\n3 ↩️ Manter na agenda$/,
    notUnderstood: { flow: "event" },
    applied: (n, ctx) => getEventById(n, ctx.id) === undefined,
  },
  {
    name: "apagar lembrete",
    kind: "delete_reminder",
    setup: (n) => ({ id: createReminder(n, "Lembrete apagar c9", futureAt(2, 9)) }),
    action: () => ({ type: "delete_reminder", query: "lembrete apagar c9" }),
    question: /^🗑️ Apagar este lembrete\?\nLembrete apagar c9 — .* às 09:00\n\n1 🗑️ Apagar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "reminder" },
    applied: (n, ctx) => getReminderById(n, ctx.id) === undefined,
  },
  {
    name: "apagar gasto",
    kind: "delete_expense",
    setup: (n) => {
      const cat = getOrCreateCategory(n, "Alimentação");
      return insertExpense({ fromNumber: n, amount: 38, description: "Gasto apagar c9", categoryId: cat.id, paymentMethodId: getOrCreatePaymentMethod(n, "Pix").id, date: "2026-10-07" });
    },
    action: () => ({ type: "delete_expense", query: "gasto apagar c9" }),
    question: /^🗑️ Apagar este gasto\?\nGasto apagar c9 — R\$ 38,00 · 07\/10 · Pix · Alimentação\n\n1 🗑️ Apagar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "expense" },
    applied: (n, ctx) => getExpenseById(n, ctx.id) === null,
  },
  {
    name: "apagar categoria",
    kind: "delete_category",
    setup: (n) => {
      const cat = getOrCreateCategory(n, "Categoria apagar c9");
      insertExpense({ fromNumber: n, amount: 5, description: "item da categoria c9", categoryId: cat.id, paymentMethodId: null, date: today() });
      return cat;
    },
    action: () => ({ type: "delete_category", category: "Categoria apagar c9" }),
    question: /^🗑️ Apagar a categoria "Categoria apagar c9"\?\nO 1 gasto dela fica sem categoria \(não é apagado\)\.\n\n1 🗑️ Apagar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "category" },
    applied: (n) => findCategoryByName(n, "Categoria apagar c9") === null,
  },
  {
    name: "remover orçamento",
    kind: "remove_budget",
    setup: (n) => {
      const cat = getOrCreateCategory(n, "Orcamento c9");
      setBudget(n, cat.id, 300);
      return cat;
    },
    action: () => ({ type: "remove_budget", category: "Orcamento c9" }),
    question: /^🗑️ Remover o orçamento de "Orcamento c9"\?\nR\$ 300,00\/mês\n\n1 🗑️ Remover\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "budget" },
    applied: (n, ctx) => getBudget(n, ctx.id) === null,
  },
  {
    name: "parar gasto fixo",
    kind: "remove_recurring",
    setup: (n) => createRecurringExpense({ fromNumber: n, description: "Academia c9", amount: 89.9, categoryId: null, paymentMethodId: null, dayOfMonth: 5 }),
    action: () => ({ type: "remove_recurring_expense", query: "academia c9" }),
    question: /^🛑 Parar de lançar este gasto fixo\?\nAcademia c9 — R\$ 89,90 · todo dia 5\n\n1 🛑 Parar de lançar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "recurring" },
    applied: (n) => listRecurringExpenses(n).length === 0,
  },
  {
    name: "parar alerta de conta",
    kind: "remove_bill_alert",
    setup: (n) => createBillAlert({ fromNumber: n, name: "Conta c9", dayOfMonth: 10 }),
    action: () => ({ type: "remove_bill_alert", query: "conta c9" }),
    question: /^🛑 Parar o alerta de "Conta c9"\?\ntodo dia 10\n\n1 🛑 Parar de avisar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "bill_alert" },
    applied: (n) => listBillAlerts(n).length === 0,
  },
  {
    name: "juntar categorias",
    kind: "merge_categories",
    setup: (n) => {
      const origem = getOrCreateCategory(n, "Origem c9");
      getOrCreateCategory(n, "Destino c9");
      insertExpense({ fromNumber: n, amount: 7, description: "item merge c9", categoryId: origem.id, paymentMethodId: null, date: today() });
      return origem;
    },
    action: () => ({ type: "merge_categories", category: "Origem c9", to_category: "Destino c9" }),
    question: /^🔀 Juntar "Origem c9" em "Destino c9"\?\n1 gasto vai pra "Destino c9" e "Origem c9" vai deixar de existir\.\n\n1 🔀 Juntar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "merge" },
    applied: (n) => findCategoryByName(n, "Origem c9") === null,
  },
  {
    name: "recategorizar em lote",
    kind: "bulk_recategorize",
    setup: (n) => {
      const origem = getOrCreateCategory(n, "Origem lote c9");
      getOrCreateCategory(n, "Destino lote c9");
      insertExpense({ fromNumber: n, amount: 10, description: "lote c9 um", categoryId: origem.id, paymentMethodId: null, date: today() });
      return insertExpense({ fromNumber: n, amount: 20, description: "lote c9 dois", categoryId: origem.id, paymentMethodId: null, date: today() });
    },
    action: () => ({ type: "bulk_recategorize", scope: "today", to_category: "Destino lote c9" }),
    question: /^🔀 Mudar 2 gastos para "Destino lote c9"\?\n\(os gastos de hoje\)\n• R\$ 20,00 — lote c9 dois\n• R\$ 10,00 — lote c9 um\n\n1 ✅ Mudar\n3 ❌ Cancelar$/,
    notUnderstood: { flow: "bulk" },
    applied: (n, ctx) => getExpenseById(n, ctx.id)?.category_id === findCategoryByName(n, "Destino lote c9")?.id,
  },
];

// um numero por (fluxo, cenario)
const numberFor = (flowIdx: number, scenario: number) => `55110009${2000 + flowIdx * 10 + scenario}`;

async function ask(app: App, flow: Flow, n: string, ctx: unknown) {
  app.queueReply([flow.action(ctx)]);
  await app.handle(msg(n, `pedido de ${flow.name}`));
}

flows.forEach((flow, idx) => {
  test(`card 9 [${flow.name}]: pergunta no formato 1/3; respostas ambiguas nao agem; 3 cancela sem lista; 1 executa`, async (t) => {
    const n = numberFor(idx, 0);
    seed(n);
    const ctx = flow.setup(n);
    const app = restartApp(t);
    await ask(app, flow, n, ctx);
    assert.match(app.last(), flow.question);
    assert.deepEqual(pendingKinds(n), [flow.kind]);

    // RN01: nenhuma dessas frases confirma nem cancela
    for (const text of ["pode ser amanhã", "sim, mas só o do dia 10", "não, é o outro", "2", "talvez"]) {
      await app.handle(msg(n, text));
      assert.equal(app.last(), deleteNotUnderstood(flow.notUnderstood), `"${text}"`);
      assert.equal(flow.applied(n, ctx), false, `"${text}" nao pode executar`);
      assert.deepEqual(pendingKinds(n), [flow.kind], `"${text}" mantem a pendencia`);
    }

    await app.handle(msg(n, "3"));
    assert.match(app.last(), /^Beleza, não (mexi em nada|apaguei nada)/);
    assert.equal(flow.applied(n, ctx), false);
    assert.deepEqual(pendingKinds(n), []);

    // de novo: "1" executa (e grava o desfazer)
    await ask(app, flow, n, ctx);
    await app.handle(msg(n, "1"));
    assert.equal(flow.applied(n, ctx), true);
    assert.ok(!pendingKinds(n).includes(flow.kind));
    assert.deepEqual(pendingKinds(n).filter((k) => k !== "undo"), []);
  });

  test(`card 9 [${flow.name}]: a pergunta sobrevive a reinicio do servidor (modulos recarregados, mesmo banco)`, async (t) => {
    const n = numberFor(idx, 1);
    seed(n);
    const ctx = flow.setup(n);
    let app = restartApp(t);
    await ask(app, flow, n, ctx);
    assert.deepEqual(pendingKinds(n), [flow.kind]);
    app = restartApp(t);
    await app.handle(msg(n, "sim"));
    assert.equal(flow.applied(n, ctx), true);
    assert.ok(app.sent.length >= 1);
  });

  test(`card 9 [${flow.name}]: vale 10 minutos -- 9m59s executa, 10m01s so avisa que expirou`, async (t) => {
    const early = numberFor(idx, 2);
    const late = numberFor(idx, 3);
    seed(early, late);
    const ctxEarly = flow.setup(early);
    const ctxLate = flow.setup(late);
    let app = restartApp(t);
    await ask(app, flow, early, ctxEarly);
    await ask(app, flow, late, ctxLate);

    app = restartApp(t);
    app.setNow(10 * MIN - 1000);
    await app.handle(msg(early, "1"));
    assert.equal(flow.applied(early, ctxEarly), true);

    app = restartApp(t);
    app.setNow(10 * MIN + 1000);
    await app.handle(msg(late, "1"));
    assert.match(app.last(), /^⌛ A confirmação de ".+" expirou \(passaram mais de 10 minutos\) e eu não mexi em nada\. Se ainda quiser, é só pedir de novo\.$/);
    assert.equal(flow.applied(late, ctxLate), false);
  });

  test(`card 9 [${flow.name}]: "esquece" (cancelamento geral) apaga a confirmacao; outro numero nao e afetado`, async (t) => {
    const a = numberFor(idx, 4);
    const b = numberFor(idx, 5);
    seed(a, b);
    const ctxA = flow.setup(a);
    const ctxB = flow.setup(b);
    const app = restartApp(t);
    await ask(app, flow, a, ctxA);
    await ask(app, flow, b, ctxB);
    await app.handle(msg(a, "esquece"));
    assert.deepEqual(pendingKinds(a), []);
    assert.equal(flow.applied(a, ctxA), false);
    // a confirmacao do outro numero continua de pe e so ele a confirma
    assert.deepEqual(pendingKinds(b), [flow.kind]);
    await app.handle(msg(b, "1"));
    assert.equal(flow.applied(b, ctxB), true);
    assert.equal(flow.applied(a, ctxA), false);
  });
});

// ---- apagar gasto: casos proprios ----------------------------------------------------

test("card 9: apagar gasto SEM alvo explicito -- opcao 2 mostra os ultimos; 'nao' e '3' cancelam e nunca abrem a lista", async (t) => {
  const n = "551100092100";
  seed(n);
  const cat = getOrCreateCategory(n, "Alimentação");
  insertExpense({ fromNumber: n, amount: 11, description: "escolha c9 um", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: n, amount: 22, description: "escolha c9 dois", categoryId: cat.id, paymentMethodId: null, date: today() });
  const app = restartApp(t);

  app.queueReply([{ type: "delete_expense" }]);
  await app.handle(msg(n, "apaga o último gasto"));
  assert.match(app.last(), /^🗑️ Apagar este gasto\?\nescolha c9 dois — R\$ 22,00 · \d{2}\/\d{2} · Alimentação\n\n1 🗑️ Apagar\n2 🔎 Não é esse, ver os últimos\n3 ❌ Cancelar$/);

  // "nao" e "3" cancelam e NAO abrem a lista (mudanca deliberada)
  for (const cancel of ["não", "3"]) {
    await app.handle(msg(n, cancel));
    assert.equal(app.last(), "Beleza, não apaguei nada.");
    assert.deepEqual(pendingKinds(n), []);
    app.queueReply([{ type: "delete_expense" }]);
    await app.handle(msg(n, "apaga o último gasto"));
  }

  // mensagem ambigua inclui a opcao 2
  await app.handle(msg(n, "pode ser amanhã"));
  assert.equal(app.last(), "Não entendi 🤔 Responde *1* pra apagar, *2* pra ver os últimos gastos ou *3* pra cancelar.");

  // "nao e esse" vale como 2 -> lista numerada; o numero escolhido apaga (e a lista sobrevive a reinicio)
  await app.handle(msg(n, "não é esse"));
  assert.match(app.last(), /^Qual desses você quer apagar\? Responde com o número \(ou "cancelar"\)\.\n\n1\. escolha c9 dois — R\$ 22,00 · \d{2}\/\d{2}\n2\. escolha c9 um — R\$ 11,00/);
  assert.deepEqual(pendingKinds(n), ["delete_expense"]);
  const after = restartApp(t);
  await after.handle(msg(n, "2"));
  assert.equal(after.last(), '🗑️ Gasto "escolha c9 um" apagado.\nErrou? Responde *desfazer*.');
  assert.equal(searchExpenses(n, "escolha c9 um").length, 0);
  assert.equal(searchExpenses(n, "escolha c9 dois").length, 1);
});

test("card 9: apagar gasto COM alvo explicito nao oferece a opcao 2", async (t) => {
  const n = "551100092101";
  seed(n);
  insertExpense({ fromNumber: n, amount: 38, description: "mercado explicito c9", categoryId: null, paymentMethodId: null, date: today() });
  const app = restartApp(t);
  app.queueReply([{ type: "delete_expense", query: "mercado explicito" }]);
  await app.handle(msg(n, "apaga o mercado explicito"));
  assert.doesNotMatch(app.last(), /2 🔎/);
  assert.match(app.last(), /1 🗑️ Apagar\n3 ❌ Cancelar$/);
  await app.handle(msg(n, "2")); // "2" nao existe aqui
  assert.equal(app.last(), "Não entendi 🤔 Responde *1* pra apagar ou *3* pra cancelar.");
  await app.handle(msg(n, "1"));
  assert.equal(searchExpenses(n, "mercado explicito").length, 0);
});

test("card 9: compra parcelada -- pergunta com nome, parcelas e total; 1 apaga todas; desfazer recria; valores em R$ 0,00", async (t) => {
  const n = "551100092102";
  seed(n);
  const app = restartApp(t);
  app.queueReply([{ type: "installment_expense", description: "Geladeira c9", category: "Compras", total_amount: 900, installments: 3 }]);
  await app.handle(msg(n, "comprei uma geladeira de 900 em 3x"));
  assert.equal(searchExpenses(n, "Geladeira c9").length, 3);

  app.queueReply([{ type: "delete_expense", query: "geladeira c9" }]);
  await app.handle(msg(n, "apaga a geladeira c9"));
  // varias parcelas batem com o texto: a lista numerada do Card 2 vem antes; escolhe a 1a
  if (/Achei \d+ gastos/.test(app.last())) await app.handle(msg(n, "1"));
  assert.match(app.last(), /^🗑️ Apagar TODAS as 3 parcelas\?\nGeladeira c9 — 3x · total R\$ 900,00\n\n1 🗑️ Apagar todas\n3 ❌ Cancelar$/);
  await app.handle(msg(n, "1"));
  assert.match(app.last(), /as 3 parcelas \(total R\$ 900,00\) foram removidas\./);
  assert.equal(searchExpenses(n, "Geladeira c9").length, 0);
  app.queueReply([{ type: "undo" }]);
  await app.handle(msg(n, "desfaz isso"));
  assert.equal(searchExpenses(n, "Geladeira c9").length, 3);
});

test("card 9: alvo apagado entre a pergunta e o 1 -- mensagem de 'ja nao existe', sem erro", async (t) => {
  const n = "551100092103";
  seed(n);
  const e = insertExpense({ fromNumber: n, amount: 9, description: "sumiu c9", categoryId: null, paymentMethodId: null, date: today() });
  const app = restartApp(t);
  app.queueReply([{ type: "delete_expense", query: "sumiu c9" }]);
  await app.handle(msg(n, "apaga o sumiu c9"));
  db.prepare(`DELETE FROM expenses WHERE id = ?`).run(e.id); // sumiu "por fora" (ex: painel)
  await app.handle(msg(n, "1"));
  assert.equal(app.last(), "Esse gasto já não existe mais.");
  assert.deepEqual(pendingKinds(n), []);
});

test("card 9: desfazer de cada fluxo continua funcionando (evento, lembrete, gasto, categoria, orcamento, gasto fixo, alerta, juntar, lote)", async (t) => {
  const results: string[] = [];
  for (const [idx, flow] of flows.entries()) {
    const n = numberFor(idx, 6);
    seed(n);
    const ctx = flow.setup(n);
    const app = restartApp(t);
    await ask(app, flow, n, ctx);
    await app.handle(msg(n, "1"));
    assert.equal(flow.applied(n, ctx), true, flow.name);
    assert.match(app.last(), /Errou\? Responde \*desfazer\*\.$/, `${flow.name}: dica de desfazer`);
    app.queueReply([{ type: "undo" }]);
    await app.handle(msg(n, "desfaz isso"));
    results.push(`${flow.name}: ${app.last().split("\n")[0].slice(0, 30)}`);
    assert.match(app.last(), /^↩️ Prontinho/, flow.name);
  }
  assert.equal(results.length, 9);
});

test("card 9: o aviso de expiracao reconhece os kinds novos com o rotulo certo (e a 'lista de gastos para apagar')", async (t) => {
  const n = "551100092104";
  seed(n);
  insertExpense({ fromNumber: n, amount: 12, description: "lista exp c9", categoryId: null, paymentMethodId: null, date: today() });
  const app = restartApp(t);
  app.queueReply([{ type: "delete_expense" }]);
  await app.handle(msg(n, "apaga um gasto"));
  await app.handle(msg(n, "2")); // abre a lista de escolha (kind delete_expense, modo choices)
  app.setNow(11 * MIN);
  await app.handle(msg(n, "1"));
  assert.match(app.last(), /^⌛ A confirmação de "lista de gastos para apagar" expirou/);
  assert.equal(searchExpenses(n, "lista exp c9").length, 1);
  // a linha vencida continua guardada so pro aviso; um segundo "1" nao repete o aviso
  const before = app.sent.length;
  await app.handle(msg(n, "1"));
  assert.ok(!app.sent.slice(before).some((m) => /expirou/.test(m.text)));
});
