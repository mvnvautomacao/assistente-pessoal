// Card 12 (D-07): confirmacao aberta que NAO entende a mensagem da uma segunda chance -- um pedido novo
// claro e seguro (registrar, criar, consultar) troca a confirmacao; o resto recebe "nao entendi" com a
// dica de saida; "desfaz isso" cancela a confirmacao. A IA so e chamada depois que o resolvedor desistiu.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Interpretation } from "../../src/ai/interpret";
import { ensureUserSeeded, getOrCreateCategory, getOrCreatePaymentMethod, setDefaultPaymentMethod, insertExpense, getExpenseById } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { addDaysToDateString, spDateString } from "../../src/timeSP";
import { db } from "../../src/db";
import { createEvent } from "../../src/events/service";
import { NOT_UNDERSTOOD_TEXT } from "../../src/confirmation/preview";
import { PENDING_EXIT_HINT } from "../../src/pending/newRequest";

function msg(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `pn-${Math.random().toString(36).slice(2)}`, fromMe: false },
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
const pendingKinds = (n: string) =>
  (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? AND kind <> 'undo' ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);
const expensesLike = (n: string, text: string) => db.prepare(`SELECT * FROM expenses WHERE from_number = ? AND description LIKE ?`).all(n, `%${text}%`) as { id: number; amount: number }[];
const incomesLike = (n: string, text: string) => db.prepare(`SELECT * FROM incomes WHERE from_number = ? AND description LIKE ?`).all(n, `%${text}%`) as { id: number; amount: number }[];

type Sent = { to: string; text: string };
interface App {
  handle: (data: unknown) => Promise<void>;
  sent: Sent[];
  calls: string[]; // textos que chegaram na IA (interpretText)
  queueReply: (actions: Interpretation[]) => void;
  failNext: () => void;
  resetLimit: () => void;
  last: () => string;
}

// Reinicia o "servidor": descarta os modulos de src (menos banco e config) e recarrega o router --
// todo estado em memoria some, o SQLite continua. Cada chamada devolve um app novo (mocks proprios).
function freshApp(t: TestContext): App {
  const srcDir = path.join(__dirname, "..", "..", "src");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir) && !/[\\/](db|config)\.js$/.test(key)) delete require.cache[key];
  }
  const client = require("../../src/whatsapp/client");
  const ai = require("../../src/ai/interpret");
  const rateLimit = require("../../src/access/rateLimit");
  const router = require("../../src/router");
  rateLimit.resetRateLimitForTests();
  const sent: Sent[] = [];
  const calls: string[] = [];
  const queue: Interpretation[][] = [];
  let failing = false;
  t.mock.method(client, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  t.mock.method(ai, "interpretText", async (_from: string, text: string) => {
    calls.push(text);
    if (failing) {
      failing = false;
      throw new Error("IA fora do ar (simulado)");
    }
    return queue.shift() ?? [];
  });
  return {
    handle: router.handleIncomingMessage,
    sent,
    calls,
    queueReply: (a) => queue.push(a),
    failNext: () => {
      failing = true;
    },
    resetLimit: () => rateLimit.resetRateLimitForTests(),
    last: () => sent[sent.length - 1].text,
  };
}

const uberExpense = (description = "uber"): Interpretation => ({ type: "expense", amount: 30, description, category: "Transporte", date: today() });
const REPLACED = (label: string) => `Deixei a alteração de "${label}" de lado e entendi seu novo pedido.`;

// abre a previa de edicao de valor de um gasto (38 -> 45)
async function openExpensePreview(app: App, n: string, description: string) {
  const cat = getOrCreateCategory(n, "Alimentação");
  const exp = insertExpense({ fromNumber: n, amount: 38, description, categoryId: cat.id, paymentMethodId: getOrCreatePaymentMethod(n, "Pix").id, date: today() });
  app.queueReply([{ type: "edit_expense", query: description.toLowerCase(), changes: [{ field: "amount", value: "45" }] }]);
  await app.handle(msg(n, `muda o ${description.toLowerCase()} pra 45`));
  assert.match(app.last(), /Valor: R\$ 38,00 → R\$ 45,00/);
  assert.deepEqual(pendingKinds(n), ["edit_expense"]);
  app.calls.length = 0;
  return exp;
}

test("Card 12: previa de edicao aberta + 'gastei 30 no uber' => edicao descartada, gasto registrado, nada aplicado", async (t) => {
  const N = "551100094001";
  seed(N);
  const app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12a");
  app.queueReply([uberExpense()]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.deepEqual(app.calls, ["gastei 30 no uber"], "uma unica chamada da IA");
  assert.ok(app.sent.some((m) => m.text === REPLACED("Mercado c12a")), "linha de troca");
  assert.equal(expensesLike(N, "uber").length, 1, "gasto novo registrado");
  assert.equal(getExpenseById(N, exp.id)?.amount, 38, "nada da edicao foi aplicado");
  assert.ok(!pendingKinds(N).includes("edit_expense"));
  // a linha de troca vem antes da resposta do pedido novo
  const idx = app.sent.findIndex((m) => m.text === REPLACED("Mercado c12a"));
  assert.ok(idx >= 0 && idx < app.sent.length - 1);
});

test("Card 12: consultas -- 'quanto gastei esse mes', 'o que tenho amanha' e 'gastos de hoje' trocam a previa", async (t) => {
  const N = "551100094002";
  seed(N);
  const app = freshApp(t);
  const cases: [string, Interpretation][] = [
    ["quanto gastei esse mês", { type: "expense_report", period: "month" }],
    ["o que tenho amanhã", { type: "report", days: 1 }],
    ["gastos de hoje", { type: "list_expenses", days: 1 }],
  ];
  for (const [i, [text, action]] of cases.entries()) {
    app.resetLimit();
    await openExpensePreview(app, N, `Mercado c12b${i}`);
    const before = app.sent.length;
    app.queueReply([action]);
    await app.handle(msg(N, text));
    assert.equal(app.sent[before].text, REPLACED(`Mercado c12b${i}`), text);
    assert.ok(app.sent.length > before + 1, `${text}: respondeu o pedido novo`);
    assert.ok(!pendingKinds(N).includes("edit_expense"), `${text}: previa descartada`);
  }
});

test("Card 12: pergunta de apagar 1/3 aberta + 'gastei 30 no uber' => nada apagado, pergunta descartada, gasto registrado", async (t) => {
  const N = "551100094003";
  seed(N);
  const app = freshApp(t);
  const cat = getOrCreateCategory(N, "Alimentação");
  const exp = insertExpense({ fromNumber: N, amount: 38, description: "Gasto apagar c12", categoryId: cat.id, paymentMethodId: null, date: today() });
  app.queueReply([{ type: "delete_expense", query: "gasto apagar c12" }]);
  await app.handle(msg(N, "apaga o gasto apagar c12"));
  assert.match(app.last(), /🗑️ Apagar este gasto\?/);
  app.calls.length = 0;
  app.queueReply([uberExpense()]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.deepEqual(app.calls, ["gastei 30 no uber"]);
  assert.ok(app.sent.some((m) => m.text === "Deixei a pergunta anterior de lado e entendi seu novo pedido."), "pergunta de apagar nao tem rotulo de edicao");
  assert.ok(getExpenseById(N, exp.id), "o gasto nao foi apagado");
  assert.equal(expensesLike(N, "uber").length, 1);
  assert.deepEqual(pendingKinds(N).filter((k) => k.startsWith("delete_")), []);
});

test("Card 12: menu de campos (escolha) aberto + 'recebi 3000 de salario' => menu descartado, entrada registrada", async (t) => {
  const N = "551100094004";
  seed(N);
  const app = freshApp(t);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 38, description: "Gasto menu c12", categoryId: cat.id, paymentMethodId: null, date: today() });
  await app.handle(msg(N, "editar"));
  await app.handle(msg(N, "1"));
  await app.handle(msg(N, "1"));
  assert.match(app.last(), /O que você quer mudar\?/);
  assert.deepEqual(pendingKinds(N), ["field_menu"]);
  app.calls.length = 0;
  app.queueReply([{ type: "income", amount: 3000, description: "salario c12", date: today() }]);
  await app.handle(msg(N, "recebi 3000 de salário"));
  assert.deepEqual(app.calls, ["recebi 3000 de salário"]);
  assert.ok(app.sent.some((m) => m.text.startsWith("Deixei a alteração de ")), app.sent.map((m) => m.text).join(" | "));
  assert.equal(incomesLike(N, "salario c12").length, 1);
  assert.ok(!pendingKinds(N).includes("field_menu"));
});

test("Card 12: o que o resolvedor entende continua sendo resposta -- a IA NAO e chamada", async (t) => {
  const N = "551100094005";
  seed(N);
  const app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12e");
  await app.handle(msg(N, "50")); // novo valor: correcao
  assert.match(app.last(), /Valor: R\$ 38,00 → R\$ 50,00/);
  await app.handle(msg(N, "R$ 55"));
  assert.match(app.last(), /Valor: R\$ 38,00 → R\$ 55,00/);
  await app.handle(msg(N, "dois")); // opcao 2: corrigir
  assert.match(app.last(), /Ou responde \*cancelar\*/);
  await app.handle(msg(N, "cancelar"));
  assert.equal(app.last(), "Beleza, não mexi em nada.");
  assert.deepEqual(app.calls, [], "nenhuma chamada da IA enquanto o resolvedor entendia");
  assert.equal(getExpenseById(N, exp.id)?.amount, 38);

  // data/hora de evento (a extracao de data e uma chamada propria, nao a segunda chance)
  const ai = require("../../src/ai/interpret");
  t.mock.method(ai, "extractDateTimeFromAnswer", async () => ({ newTime: "16:00" }));
  createEvent({ fromNumber: N, title: "Evento c12e", start: futureAt(3, 14), end: futureAt(3, 15) });
  app.queueReply([{ type: "edit_event", query: "evento c12e", new_time: "15:00" }]);
  await app.handle(msg(N, "muda o evento c12e pra 15h"));
  app.calls.length = 0;
  await app.handle(msg(N, "amanhã às 16h"));
  assert.deepEqual(app.calls, [], "'amanha as 16h' e correcao de data/hora");
  assert.match(app.last(), /16:00/);
  await app.handle(msg(N, "3"));
});

test("Card 12: 'bla bla' => 'nao entendi' + dica de saida, a previa continua aberta", async (t) => {
  const N = "551100094006";
  seed(N);
  const app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12f");
  await app.handle(msg(N, "bla bla")); // a IA (fila vazia) nao devolve nada
  assert.deepEqual(app.calls, ["bla bla"]);
  assert.equal(app.last(), NOT_UNDERSTOOD_TEXT);
  assert.ok(app.last().endsWith(PENDING_EXIT_HINT));
  assert.deepEqual(pendingKinds(N), ["edit_expense"], "a previa continua");
  await app.handle(msg(N, "1")); // e ainda da pra confirmar
  assert.equal(getExpenseById(N, exp.id)?.amount, 45);
});

test("Card 12: pedido que abre outra confirmacao ou muda config nao troca nada (delete_event, edit_*, set_*, undo...)", async (t) => {
  const N = "551100094007";
  seed(N);
  const app = freshApp(t);
  await openExpensePreview(app, N, "Mercado c12g");
  createEvent({ fromNumber: N, title: "Reuniao c12g", start: futureAt(3, 14), end: futureAt(3, 15) });
  const unsafe: [string, Interpretation][] = [
    ["apaga o evento reunião", { type: "delete_event", query: "reuniao c12g" }],
    ["muda a reunião c12g", { type: "edit_event", query: "reuniao c12g", new_date: today() }],
    ["define orçamento de lazer", { type: "set_budget", category: "Lazer", amount: 300 }],
    ["adia o lembrete 30 min", { type: "snooze_reminder", minutes: 30 }],
    ["não entendi nada", { type: "unknown", description: "x" }],
  ];
  for (const [text, action] of unsafe) {
    app.resetLimit();
    app.calls.length = 0;
    app.queueReply([action]);
    await app.handle(msg(N, text));
    assert.equal(app.last(), NOT_UNDERSTOOD_TEXT, text);
    assert.deepEqual(pendingKinds(N), ["edit_expense"], `${text}: previa mantida`);
  }
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE from_number = ?`).get(N) as { n: number }).n, 1, "o evento nao foi apagado");
});

test("Card 12: uma palavra so ('pix', 'hoje') nunca troca a confirmacao e nem chama a IA", async (t) => {
  const N = "551100094008";
  seed(N);
  const app = freshApp(t);
  await openExpensePreview(app, N, "Mercado c12h");
  app.queueReply([uberExpense()]); // mesmo que a IA devolvesse um gasto, nao chega a ser chamada
  for (const word of ["pix", "hoje"]) {
    app.resetLimit();
    await app.handle(msg(N, word));
    assert.equal(app.last(), NOT_UNDERSTOOD_TEXT, word);
  }
  assert.deepEqual(app.calls, [], "palavra solta nao vai pra IA");
  assert.deepEqual(pendingKinds(N), ["edit_expense"]);
  assert.equal(expensesLike(N, "uber").length, 0);
});

test("Card 12: 'desfaz isso' com previa aberta cancela a previa SEM desfazer a ultima acao; o segundo desfaz", async (t) => {
  const N = "551100094009";
  seed(N);
  const app = freshApp(t);
  // ultima acao desfazivel: um gasto registrado agora
  app.queueReply([{ type: "expense", amount: 12, description: "cafe c12i", category: "Mercado", date: today() }]);
  await app.handle(msg(N, "gastei 12 no cafe c12i"));
  assert.equal(expensesLike(N, "cafe c12i").length, 1);
  await openExpensePreview(app, N, "Mercado c12i");
  app.calls.length = 0;

  await app.handle(msg(N, "desfaz isso"));
  assert.equal(app.last(), 'Cancelei a alteração de "Mercado c12i" — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.');
  assert.deepEqual(app.calls, [], "desfazer nao chama a IA");
  assert.deepEqual(pendingKinds(N).filter((k) => k === "edit_expense"), []);
  assert.equal(expensesLike(N, "cafe c12i").length, 1, "a ultima acao NAO foi desfeita");

  app.queueReply([{ type: "undo" }]);
  await app.handle(msg(N, "desfaz isso"));
  assert.equal(expensesLike(N, "cafe c12i").length, 0, "o segundo 'desfaz isso' desfaz a ultima acao");
});

test("Card 12: falha da IA => 'nao entendi' + dica e a confirmacao continua aberta", async (t) => {
  const N = "551100094010";
  seed(N);
  const app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12j");
  t.mock.method(console, "error", () => {});
  app.failNext();
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.equal(app.last(), NOT_UNDERSTOOD_TEXT);
  assert.deepEqual(pendingKinds(N), ["edit_expense"]);
  assert.equal(expensesLike(N, "uber").length, 0);
  await app.handle(msg(N, "1"));
  assert.equal(getExpenseById(N, exp.id)?.amount, 45, "a previa seguia valendo");
});

test("Card 12: dois pedidos (um seguro e um nao) => nenhum e atendido e a confirmacao continua", async (t) => {
  const N = "551100094011";
  seed(N);
  const app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12k");
  app.queueReply([uberExpense(), { type: "delete_expense", query: "mercado c12k" }]);
  await app.handle(msg(N, "gastei 30 no uber e apaga o mercado"));
  assert.equal(app.last(), NOT_UNDERSTOOD_TEXT);
  assert.equal(expensesLike(N, "uber").length, 0);
  assert.ok(getExpenseById(N, exp.id));
  assert.deepEqual(pendingKinds(N), ["edit_expense"]);
});

test("Card 12: dois pedidos seguros => os dois sao atendidos depois da troca", async (t) => {
  const N = "551100094012";
  seed(N);
  const app = freshApp(t);
  await openExpensePreview(app, N, "Mercado c12l");
  app.queueReply([uberExpense("uber c12l"), { type: "income", amount: 100, description: "bico c12l", date: today() }]);
  await app.handle(msg(N, "gastei 30 no uber e recebi 100 de bico"));
  assert.equal(expensesLike(N, "uber c12l").length, 1);
  assert.equal(incomesLike(N, "bico c12l").length, 1);
});

test("Card 12: com a confirmacao persistida, o servidor reiniciado troca do mesmo jeito", async (t) => {
  const N = "551100094013";
  seed(N);
  let app = freshApp(t);
  const exp = await openExpensePreview(app, N, "Mercado c12m");
  app = freshApp(t); // reinicio: memoria zerada, banco igual
  app.queueReply([uberExpense("uber c12m")]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.ok(app.sent.some((m) => m.text === REPLACED("Mercado c12m")));
  assert.equal(expensesLike(N, "uber c12m").length, 1);
  assert.equal(getExpenseById(N, exp.id)?.amount, 38);
});

test("Card 12: confirmacao de outro numero continua intacta", async (t) => {
  const N = "551100094014";
  const OTHER = "551100094015";
  seed(N, OTHER);
  const app = freshApp(t);
  await openExpensePreview(app, OTHER, "Mercado outro c12n");
  await openExpensePreview(app, N, "Mercado c12n");
  app.queueReply([uberExpense("uber c12n")]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.deepEqual(pendingKinds(N).filter((k) => k === "edit_expense"), []);
  assert.deepEqual(pendingKinds(OTHER), ["edit_expense"], "a previa do outro numero segue aberta");
  await app.handle(msg(OTHER, "1"));
  assert.match(app.last(), /atualizado: valor R\$ 45,00/);
});

test("Card 12: 'nao entendi' das confirmacoes de apagar e da entrada tambem trazem a dica de saida (e a segunda chance vale)", async (t) => {
  const N = "551100094016";
  seed(N);
  const app = freshApp(t);
  createEvent({ fromNumber: N, title: "Evento apagar c12o", start: futureAt(3, 14), end: futureAt(3, 15) });
  app.queueReply([{ type: "delete_event", query: "evento apagar c12o" }]);
  await app.handle(msg(N, "cancela o evento apagar c12o"));
  await app.handle(msg(N, "bla bla"));
  assert.equal(app.last(), `Não entendi 🤔 Responde *1* pra cancelar o evento ou *3* pra manter.\n${PENDING_EXIT_HINT}`);
  app.queueReply([uberExpense("uber c12o")]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.equal(expensesLike(N, "uber c12o").length, 1);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE from_number = ?`).get(N) as { n: number }).n, 1, "o evento nao foi cancelado");
});

// ---- correcoes da revisao (Card 12) ----------------------------------------------------------------

test("Card 12: no menu de campos a dica de saida e 'cancelar' (o '3' e um campo) e 'cancelar' sai de verdade", async (t) => {
  const N = "551100094020";
  seed(N);
  const app = freshApp(t);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 38, description: "Gasto menu c12p", categoryId: cat.id, paymentMethodId: null, date: today() });
  await app.handle(msg(N, "editar"));
  await app.handle(msg(N, "1"));
  await app.handle(msg(N, "1"));
  assert.deepEqual(pendingKinds(N), ["field_menu"]);
  await app.handle(msg(N, "bla bla"));
  assert.equal(app.last(), "Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.\nSe quer fazer outra coisa, responde *cancelar* e me manda o pedido de novo.");
  assert.ok(!app.last().includes("*3*"), "nada de 'responde *3*' num menu em que 3 e um campo");
  await app.handle(msg(N, "cancelar"));
  assert.equal(app.last(), "Beleza, não mexi em nada.");
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 12: resposta curta e ambigua ('mercado 40') nao vira gasto -- registrar exige 3 palavras ou mais", async (t) => {
  const N = "551100094021";
  seed(N);
  const app = freshApp(t);
  const cat = getOrCreateCategory(N, "Alimentação");
  insertExpense({ fromNumber: N, amount: 38, description: "Gasto menu c12q", categoryId: cat.id, paymentMethodId: null, date: today() });
  await app.handle(msg(N, "editar"));
  await app.handle(msg(N, "1"));
  await app.handle(msg(N, "1"));
  app.calls.length = 0;
  app.queueReply([{ type: "expense", amount: 40, description: "mercado", category: "Mercado", date: today() }]);
  await app.handle(msg(N, "mercado 40"));
  assert.equal(expensesLike(N, "mercado").length, 0, "nenhum gasto registrado");
  assert.deepEqual(pendingKinds(N), ["field_menu"], "o menu continua");
  assert.match(app.last(), /Não entendi/);
  // a frase completa continua trocando
  app.queueReply([{ type: "expense", amount: 40, description: "mercado", category: "Mercado", date: today() }]);
  await app.handle(msg(N, "gastei 40 no mercado"));
  assert.equal(expensesLike(N, "mercado").length, 1);
});

test("Card 12: pergunta de apagar entrada usa 'pergunta sobre', nao 'alteracao' (troca e desfazer)", async (t) => {
  const N = "551100094022";
  seed(N);
  const app = freshApp(t);
  const { insertIncome } = require("../../src/incomes/service");
  insertIncome({ fromNumber: N, amount: 500, description: "Salario c12r", date: today() });
  app.queueReply([{ type: "delete_income", query: "salario c12r" }]);
  await app.handle(msg(N, "apaga a entrada salario c12r"));
  assert.match(app.last(), /Vou apagar a entrada/);

  await app.handle(msg(N, "desfaz isso"));
  assert.equal(app.last(), 'Cancelei a pergunta sobre "Salario c12r" — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.');

  app.queueReply([{ type: "delete_income", query: "salario c12r" }]);
  await app.handle(msg(N, "apaga a entrada salario c12r"));
  app.queueReply([uberExpense("uber c12r")]);
  await app.handle(msg(N, "gastei 30 no uber"));
  assert.ok(app.sent.some((m) => m.text === 'Deixei a pergunta sobre "Salario c12r" de lado e entendi seu novo pedido.'));
  assert.ok(!app.sent.some((m) => m.text.includes('alteração de "Salario c12r"')));
});

test("Card 12: no maximo 3 segundas chances (chamadas da IA) por numero na janela; depois, so o 'nao entendi'", async (t) => {
  const N = "551100094024";
  seed(N);
  const app = freshApp(t);
  await openExpensePreview(app, N, "Mercado c12t");
  for (let i = 0; i < 5; i++) {
    app.resetLimit();
    await app.handle(msg(N, `bla bla ${i}`));
    assert.equal(app.last(), NOT_UNDERSTOOD_TEXT);
  }
  assert.equal(app.calls.length, 3, "so 3 chamadas da IA para 5 mensagens nao entendidas");
  // a troca bem sucedida zera o contador; o pedido que ja passou da cota nao e avaliado
  const budgetLog = (db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE from_number = ? AND type = 'pending_not_understood'`).get(N) as { n: number }).n;
  assert.equal(budgetLog, 5, "uma unica linha de log por resposta nao entendida");
});

test("Card 12: IA falhou => uma unica linha de log, e as respostas nao entendidas nao duplicam o log do fluxo", async (t) => {
  const N = "551100094025";
  seed(N);
  const app = freshApp(t);
  await openExpensePreview(app, N, "Mercado c12u");
  t.mock.method(console, "error", () => {});
  app.failNext();
  await app.handle(msg(N, "gastei 30 no uber"));
  const rows = db.prepare(`SELECT type, summary FROM activity_log WHERE from_number = ? AND (type = 'pending_not_understood' OR summary LIKE '%nao entendida%')`).all(N) as { type: string; summary: string }[];
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.match(rows[0].summary, /IA falhou/);
});
