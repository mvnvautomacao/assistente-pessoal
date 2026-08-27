import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import { getOrCreateCategory, findRecentExpense, insertExpense, ensureUserSeeded } from "../../src/expenses/service";
import { setBudget } from "../../src/expenses/budgets";
import { spDateString } from "../../src/timeSP";

function evolutionMessage(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `test-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

// Mocka a IA (nunca chama a Anthropic de verdade nos testes) e o envio real de
// WhatsApp (nunca manda mensagem de verdade). `queueReply` enfileira a proxima
// resposta que a IA "daria"; cada chamada a interpretText consome uma da fila
// (fila vazia = simula a IA nao ter sido chamada, retornando nenhuma acao — util
// pra confirmar que fluxos de resposta pendente interceptam ANTES da IA).
function withMocks(t: TestContext) {
  const sent: { to: string; text: string }[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  const queue: Interpretation[][] = [];
  t.mock.method(aiInterpret, "interpretText", async () => queue.shift() ?? []);
  return { sent, queueReply: (actions: Interpretation[]) => queue.push(actions) };
}

const today = () => spDateString();

const A = "551100090001";
const B = "551100090002";
// pre-seeda pra nenhum teste receber a mensagem de boas-vindas (so dispara na
// primeira mensagem de um numero) misturada com a resposta que o teste espera
[A, B].forEach(ensureUserSeeded);

test("mensagem de gasto com categoria existente: registra direto e confirma", async (t) => {
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 45, category: "Mercado", description: "compras da semana", date: "2026-01-10" }]);
  await handleIncomingMessage(evolutionMessage(A, "45 no mercado"));

  const expense = findRecentExpense(A, "compras da semana");
  assert.equal(expense?.amount, 45);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /✅/);
  assert.match(sent[0].text, /45/);
});

test("mensagem de gasto com categoria desconhecida: fica pendente e pergunta, depois resolve com a resposta em texto puro (sem chamar a IA de novo)", async (t) => {
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 30, category: "CategoriaBemInventadaXYZ", description: "algo estranho", date: "2026-01-11" }]);
  await handleIncomingMessage(evolutionMessage(A, "30 em algo estranho"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /[Qq]ual categoria/);

  // nao enfileiramos nenhuma resposta nova de IA: se o codigo chamasse
  // interpretText aqui (bug), receberia [] e nao mandaria a confirmacao esperada
  await handleIncomingMessage(evolutionMessage(A, "Pets"));
  const expense = findRecentExpense(A, "algo estranho");
  assert.equal(expense?.amount, 30);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Pets/);
});

test("fila de categorizacao pendente e isolada por numero (outro numero nao interfere)", async (t) => {
  // numeros dedicados: fica de proposito uma pendencia sem resolver no final
  // deste teste, entao nao pode reusar A/B (usados por outros testes depois)
  const P = "551100090005";
  const Q = "551100090006";
  [P, Q].forEach(ensureUserSeeded);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 15, category: "CategoriaSoParaFila", description: "gasto na fila", date: "2026-01-12" }]);
  await handleIncomingMessage(evolutionMessage(P, "15 em algo raro"));
  assert.match(sent[0].text, /[Qq]ual categoria/);

  queueReply([{ type: "list_categories" }]);
  await handleIncomingMessage(evolutionMessage(Q, "quais categorias eu tenho"));

  const expense = findRecentExpense(P, "gasto na fila");
  assert.equal(expense, null); // ainda pendente, Q nao resolveu nada de P
});

test("correct_category: corrige a categoria do gasto mais recente e aprende a palavra-chave", async (t) => {
  // numero dedicado: o teste anterior ("fila de categorizacao...") deixa de
  // proposito uma pendencia sem resolver pro numero A, que interceptaria essa
  // mensagem como resposta da pendencia em vez de passar pela IA
  const C = "551100090004";
  ensureUserSeeded(C);
  const cat = getOrCreateCategory(C, "Lazer-correct");
  insertExpense({ fromNumber: C, amount: 22, description: "cabeleireiro corrigir", categoryId: null, paymentMethodId: null, date: "2026-01-13" });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "correct_category", category: "Lazer-correct", query: "cabeleireiro corrigir" }]);
  await handleIncomingMessage(evolutionMessage(C, "corrige a categoria do cabeleireiro pra lazer"));

  const expense = findRecentExpense(C, "cabeleireiro corrigir");
  assert.equal(expense?.category_id, cat.id);
  assert.match(sent[0].text, /corrigida/);
});

test("orcamento estourado: a confirmacao do gasto vem com o alerta junto", async (t) => {
  const cat = getOrCreateCategory(A, "Alerta-webhook");
  setBudget(A, cat.id, 100);
  insertExpense({ fromNumber: A, amount: 90, description: "gasto anterior", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 50, category: "Alerta-webhook", description: "estoura o orcamento", date: today() }]);
  await handleIncomingMessage(evolutionMessage(A, "50 em alerta webhook"));

  assert.match(sent[0].text, /🚨/);
});

test("list_expenses + edit_expense por numero, com cache de curta duracao", async (t) => {
  const cat = getOrCreateCategory(A, "Cache-teste");
  insertExpense({ fromNumber: A, amount: 10, description: "item cache 1", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: A, amount: 20, description: "item cache 2", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  // "hoje" vem explicito na interpretacao (date preenchido), entao NAO dispara o
  // aviso de "dia assumido" -- so a lista mesmo, numa unica mensagem
  queueReply([{ type: "list_expenses", date: today() }]);
  await handleIncomingMessage(evolutionMessage(A, "quais gastos eu tive hoje"));
  assert.match(sent[0].text, /item cache 2/); // mais recente primeiro = item 1 da lista

  queueReply([{ type: "edit_expense", list_ref: 1, field: "amount", value: "77" }]);
  await handleIncomingMessage(evolutionMessage(A, "muda o valor do 1 pra 77"));
  const edited = findRecentExpense(A, "item cache 2");
  assert.equal(edited?.amount, 77);
});

test("referencia por numero expira depois de outra acao no meio", async (t) => {
  const cat = getOrCreateCategory(A, "Cache-expira");
  insertExpense({ fromNumber: A, amount: 5, description: "item vai expirar", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "list_expenses" }]);
  await handleIncomingMessage(evolutionMessage(A, "editar compras"));

  queueReply([{ type: "list_categories" }]); // acao no meio, nao relacionada
  await handleIncomingMessage(evolutionMessage(A, "quais categorias eu tenho"));

  queueReply([{ type: "edit_expense", list_ref: 1, field: "amount", value: "999" }]);
  await handleIncomingMessage(evolutionMessage(A, "edita o 1 pro valor 999"));

  assert.match(sent[sent.length - 1].text, /qual dia/i);
  const stillOriginal = findRecentExpense(A, "item vai expirar");
  assert.equal(stillOriginal?.amount, 5); // nao foi editado, a referencia tinha expirado
});

test("pedido de gastos de mais de 1 dia pergunta resumo x detalhado, e a resposta em texto puro resolve (sem chamar a IA)", async (t) => {
  const cat = getOrCreateCategory(A, "MultiDia-teste");
  insertExpense({ fromNumber: A, amount: 12, description: "multi dia 1", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "list_expenses", days: 3 }]);
  await handleIncomingMessage(evolutionMessage(A, "gastos dos ultimos 3 dias"));
  assert.match(sent[0].text, /resumo.*detalhado/is);

  await handleIncomingMessage(evolutionMessage(A, "detalhado"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /multi dia 1/);
});

test("help: explica as funcionalidades", async (t) => {
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(A, "o que voce faz"));
  assert.match(sent[0].text, /Gastos/);
  assert.match(sent[0].text, /Agenda/);
});

test("unknown com likely_intent: pede os detalhes especificos em vez da mensagem generica", async (t) => {
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "expense" }]);
  await handleIncomingMessage(evolutionMessage(A, "gasto"));
  assert.match(sent[0].text, /valor/);
});

test("SEGURANCA/ISOLAMENTO: gastos e categorias de A nunca aparecem numa consulta de B pelo webhook", async (t) => {
  const cat = getOrCreateCategory(A, "SoDeA-webhook");
  insertExpense({ fromNumber: A, amount: 999, description: "nao pode vazar pra B", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "list_expenses" }]);
  await handleIncomingMessage(evolutionMessage(B, "quais gastos eu tive hoje"));
  assert.doesNotMatch(sent[0].text, /nao pode vazar pra B/);
});

test("numero novo recebe mensagem de boas-vindas antes da resposta normal; numero ja conhecido nao recebe de novo", async (t) => {
  const NEW_NUMBER = "551100090099";
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "expense", amount: 20, category: "Mercado", description: "primeira compra", date: "2026-01-14" }]);
  await handleIncomingMessage(evolutionMessage(NEW_NUMBER, "20 no mercado"));

  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /assistente pessoal/i);
  assert.match(sent[1].text, /✅/); // a confirmacao normal do gasto ainda acontece, so depois

  queueReply([{ type: "expense", amount: 30, category: "Mercado", description: "segunda compra", date: "2026-01-15" }]);
  await handleIncomingMessage(evolutionMessage(NEW_NUMBER, "30 no mercado"));
  assert.equal(sent.length, 3); // nao mandou boas-vindas de novo, so a confirmacao
  assert.match(sent[2].text, /✅/);
});
