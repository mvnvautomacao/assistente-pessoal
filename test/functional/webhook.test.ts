import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import { getOrCreateCategory, findRecentExpense, insertExpense, ensureUserSeeded, getExpenseById } from "../../src/expenses/service";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { getRecentBlockedAttempts } from "../../src/activity/service";
import { config } from "../../src/config";
import { setBudget } from "../../src/expenses/budgets";
import { spDateString } from "../../src/timeSP";
import { createEvent, getEventById, findUpcomingEvents } from "../../src/events/service";
import { listReminders } from "../../src/reminders/service";
import { listRecurringExpenses } from "../../src/expenses/recurring";

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

// pre-seeda categorias/formas padrao (pra nenhum teste receber a mensagem de
// boas-vindas misturada com a resposta que o teste espera) e autoriza o numero
// na allowlist (senao toda mensagem seria ignorada em silencio, ver access/allowlist.ts)
function seed(...numbers: string[]) {
  numbers.forEach((n) => {
    ensureUserSeeded(n);
    allowNumber(n);
  });
}

const A = "551100090001";
const B = "551100090002";
seed(A, B);

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
  seed(P, Q);

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
  seed(C);
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
  allowNumber(NEW_NUMBER); // autorizado, mas sem ensureUserSeeded -- o ponto do teste e que ele e novo
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

const nearFuture = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

test("delete_event: pede confirmacao antes de excluir, so cancela de verdade com 'sim'", async (t) => {
  const event = createEvent({ fromNumber: A, title: "Reuniao a cancelar", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "reuniao a cancelar" }]);
  await handleIncomingMessage(evolutionMessage(A, "cancela a reuniao a cancelar"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.ok(getEventById(A, event.id)); // ainda nao foi excluido, so perguntou

  await handleIncomingMessage(evolutionMessage(A, "sim"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /removido/);
  assert.equal(getEventById(A, event.id), undefined);
});

test("delete_event: responder 'nao' mantem o evento", async (t) => {
  const event = createEvent({ fromNumber: A, title: "Reuniao a manter", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "reuniao a manter" }]);
  await handleIncomingMessage(evolutionMessage(A, "cancela a reuniao a manter"));

  await handleIncomingMessage(evolutionMessage(A, "não, deixa"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /não mexi/i);
  assert.ok(getEventById(A, event.id)); // continua existindo
});

test("delete_event: resposta ambigua pergunta de novo, sem excluir nem manter resolvido", async (t) => {
  const event = createEvent({ fromNumber: A, title: "Reuniao ambigua", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "reuniao ambigua" }]);
  await handleIncomingMessage(evolutionMessage(A, "cancela a reuniao ambigua"));

  await handleIncomingMessage(evolutionMessage(A, "sei la"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /[Nn][ãa]o entendi/);
  assert.ok(getEventById(A, event.id)); // segue pendente, nao decidiu nada ainda

  // agora confirma de verdade, ainda funcionando (estado nao foi perdido)
  await handleIncomingMessage(evolutionMessage(A, "sim"));
  assert.equal(getEventById(A, event.id), undefined);
});

// numeros dedicados pra cada teste de undo: cada acao (expense/event/reminder/...)
// grava a ultima acao reversivel pro numero, entao reusar A/B poderia pegar
// pendencia deixada por outro teste anterior no arquivo.

test("undo: desfaz o gasto acabado de registrar (delete_expense)", async (t) => {
  const U1 = "551100090020";
  seed(U1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 40, category: "Mercado", description: "gasto pra desfazer", date: today() }]);
  await handleIncomingMessage(evolutionMessage(U1, "40 no mercado"));
  const expense = findRecentExpense(U1, "gasto pra desfazer");
  assert.ok(expense);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U1, "desfaz isso"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /↩️/);
  assert.equal(getExpenseById(U1, expense!.id), null);
});

test("undo: sem nada pendente, avisa que nao tem o que desfazer", async (t) => {
  const U2 = "551100090021";
  seed(U2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U2, "desfaz isso"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /não tem nada/i);
});

test("undo: reverte a ultima edicao de um gasto (restore_expense)", async (t) => {
  const U3 = "551100090022";
  seed(U3);
  const cat = getOrCreateCategory(U3, "Undo-edit");
  insertExpense({ fromNumber: U3, amount: 10, description: "gasto a editar undo", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "gasto a editar undo", field: "amount", value: "99" }]);
  await handleIncomingMessage(evolutionMessage(U3, "muda o gasto a editar undo pra 99"));
  const edited = findRecentExpense(U3, "gasto a editar undo");
  assert.equal(edited?.amount, 99);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U3, "desfaz isso"));
  const reverted = findRecentExpense(U3, "gasto a editar undo");
  assert.equal(reverted?.amount, 10);
});

test("undo: reverte a ultima correcao de categoria (restore_category)", async (t) => {
  const U4 = "551100090023";
  seed(U4);
  const original = getOrCreateCategory(U4, "Undo-original");
  const changed = getOrCreateCategory(U4, "Undo-mudada");
  insertExpense({ fromNumber: U4, amount: 15, description: "gasto categoria undo", categoryId: original.id, paymentMethodId: null, date: today() });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "correct_category", category: "Undo-mudada", query: "gasto categoria undo" }]);
  await handleIncomingMessage(evolutionMessage(U4, "muda a categoria do gasto categoria undo pra undo-mudada"));
  let expense = findRecentExpense(U4, "gasto categoria undo");
  assert.equal(expense?.category_id, changed.id);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U4, "desfaz isso"));
  expense = findRecentExpense(U4, "gasto categoria undo");
  assert.equal(expense?.category_id, original.id);
});

test("undo: desfaz o evento acabado de criar (delete_event)", async (t) => {
  const U5 = "551100090024";
  seed(U5);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "event", title: "Evento pra desfazer", start: nearFuture() }]);
  await handleIncomingMessage(evolutionMessage(U5, "marca evento pra desfazer amanha"));
  assert.equal(findUpcomingEvents(U5, "Evento pra desfazer").length, 1);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U5, "desfaz isso"));
  assert.equal(findUpcomingEvents(U5, "Evento pra desfazer").length, 0);
});

test("undo: recria o evento que acabou de ser cancelado (recreate_event)", async (t) => {
  const U6 = "551100090025";
  seed(U6);
  const event = createEvent({ fromNumber: U6, title: "Evento pra recriar", start: nearFuture(), location: "Sala 2" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "evento pra recriar" }]);
  await handleIncomingMessage(evolutionMessage(U6, "cancela o evento pra recriar"));
  await handleIncomingMessage(evolutionMessage(U6, "sim"));
  assert.equal(getEventById(U6, event.id), undefined);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U6, "desfaz isso"));
  const recreated = findUpcomingEvents(U6, "Evento pra recriar");
  assert.equal(recreated.length, 1);
  assert.equal(recreated[0].location, "Sala 2");
});

test("undo: desfaz o lembrete acabado de criar (delete_reminder)", async (t) => {
  const U7 = "551100090026";
  seed(U7);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "lembrete pra desfazer", due_at: nearFuture() }]);
  await handleIncomingMessage(evolutionMessage(U7, "me lembra de algo amanha"));
  assert.equal(listReminders(U7).length, 1);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(U7, "desfaz isso"));
  assert.equal(listReminders(U7).length, 0);
});

test("set_recurring_expense: cadastra o gasto fixo e confirma com o dia do mes", async (t) => {
  const R1 = "551100090030";
  seed(R1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "internet", amount: 99.9, category: "Contas", day_of_month: 10 }]);
  await handleIncomingMessage(evolutionMessage(R1, "todo dia 10 pago 99,90 de internet"));

  assert.match(sent[0].text, /🔁/);
  assert.match(sent[0].text, /dia 10/);
  const recurring = listRecurringExpenses(R1);
  assert.equal(recurring.length, 1);
  assert.equal(recurring[0].description, "internet");
  assert.equal(recurring[0].day_of_month, 10);
});

test("set_recurring_expense: dia do mes invalido nao cadastra nada", async (t) => {
  const R2 = "551100090031";
  seed(R2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "algo estranho", amount: 10, category: "Contas", day_of_month: 40 }]);
  await handleIncomingMessage(evolutionMessage(R2, "todo dia 40 pago 10 de algo estranho"));

  assert.match(sent[0].text, /entre 1 e 31/);
  assert.equal(listRecurringExpenses(R2).length, 0);
});

test("list_recurring_expenses: lista os gastos fixos cadastrados, isolado por numero", async (t) => {
  const R3 = "551100090032";
  const R4 = "551100090033";
  seed(R3, R4);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "set_recurring_expense", description: "academia", amount: 89.9, category: "Saude", day_of_month: 5 }]);
  await handleIncomingMessage(evolutionMessage(R3, "todo dia 5 pago 89,90 de academia"));

  queueReply([{ type: "list_recurring_expenses" }]);
  await handleIncomingMessage(evolutionMessage(R4, "quais gastos fixos eu tenho"));
  assert.match(sent[1].text, /ainda não tem nenhum gasto fixo/i);

  queueReply([{ type: "list_recurring_expenses" }]);
  await handleIncomingMessage(evolutionMessage(R3, "quais gastos fixos eu tenho"));
  assert.match(sent[2].text, /academia/);
});

test("remove_recurring_expense: desativa o gasto fixo encontrado por texto", async (t) => {
  const R5 = "551100090034";
  seed(R5);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "streaming filmes", amount: 39.9, category: "Lazer", day_of_month: 20 }]);
  await handleIncomingMessage(evolutionMessage(R5, "todo dia 20 pago 39,90 de streaming filmes"));

  queueReply([{ type: "remove_recurring_expense", query: "streaming" }]);
  await handleIncomingMessage(evolutionMessage(R5, "cancela o gasto fixo do streaming"));
  assert.match(sent[1].text, /removido/);
  assert.equal(listRecurringExpenses(R5).length, 0);
});

test("numero nao autorizado: nao recebe NENHUMA resposta e nem chama a IA (evita loop de bot com bot)", async (t) => {
  const BLOCKED = "551100090040";
  assert.equal(isNumberAllowed(BLOCKED), false);

  const { sent, queueReply } = withMocks(t);
  // nao enfileira nenhuma resposta de IA: se o codigo chamasse interpretText aqui
  // (bug), receberia [] silenciosamente em vez de travar o teste — a asserção
  // real de que a IA nao foi chamada e a ausencia de qualquer envio abaixo
  queueReply([{ type: "expense", amount: 999, category: "Nao Deveria Processar", description: "nao deveria registrar", date: today() }]);
  await handleIncomingMessage(evolutionMessage(BLOCKED, "oi, aqui e a empresa XPTO"));

  assert.ok(!sent.some((s) => s.to === BLOCKED)); // o proprio numero bloqueado nao recebe nada de volta
  assert.equal(findRecentExpense(BLOCKED), null); // e nao processou a acao (nao criou o gasto)
  // o dono recebe um alerta (uma vez), pra saber na hora em vez de descobrir depois
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, config.myWhatsappNumber);
  assert.match(sent[0].text, new RegExp(BLOCKED));
  const blocked = getRecentBlockedAttempts(50);
  assert.ok(blocked.some((b) => b.from_number === BLOCKED && b.summary.includes("oi, aqui e a empresa XPTO")));
});

test("numero autorizado depois de bloqueado passa a receber resposta normalmente", async (t) => {
  const LATE = "551100090041";
  assert.equal(isNumberAllowed(LATE), false);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(LATE, "o que voce faz"));
  assert.ok(!sent.some((s) => s.to === LATE)); // ainda bloqueado, LATE nao recebe nada
  assert.equal(sent.length, 1); // so o alerta pro dono

  allowNumber(LATE, "aprovado pelo /admin");
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(LATE, "o que voce faz"));
  assert.equal(sent.length, 3); // + boas-vindas (numero novo) + a resposta da ajuda
});

test("mensagem de grupo (@g.us) e ignorada incondicionalmente, mesmo que o JID esteja liberado por engano", async (t) => {
  const GROUP_JID = "123456789-987654321@g.us";
  allowNumber(GROUP_JID); // simula alguem aprovando um grupo por engano no /admin

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "help" }]);
  await handleIncomingMessage({
    key: { remoteJid: GROUP_JID, id: "test-group-1", fromMe: false },
    messageType: "conversation",
    message: { conversation: "mensagem de um grupo" },
  });

  assert.equal(sent.length, 0); // nao responde em grupo, mesmo autorizado
});

test("rate limit: mais de 20 mensagens em 5 min pausa o numero, avisa ele uma vez e avisa o dono uma vez", async (t) => {
  const RL = "551100090051";
  seed(RL);
  const { sent, queueReply } = withMocks(t);

  // 20 mensagens dentro do limite: fila de IA vazia -> [] de interpretacoes -> nao manda nada
  for (let i = 0; i < 20; i++) {
    await handleIncomingMessage(evolutionMessage(RL, `mensagem numero ${i}`));
  }
  assert.equal(sent.length, 0);

  // a 21a estoura o limite
  await handleIncomingMessage(evolutionMessage(RL, "mensagem que estoura o limite"));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, RL);
  assert.match(sent[0].text, /pausar/i);
  assert.equal(sent[1].to, config.myWhatsappNumber);
  assert.match(sent[1].text, new RegExp(RL));

  // enquanto o cooldown estiver ativo, fica em silencio total (nao repete o aviso)
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(RL, "mensagem durante o cooldown"));
  assert.equal(sent.length, 2); // nao aumentou
});
