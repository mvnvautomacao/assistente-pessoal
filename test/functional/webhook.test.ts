import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import {
  getOrCreateCategory,
  findRecentExpense,
  insertExpense,
  ensureUserSeeded,
  getExpenseById,
  findCategoryByName,
  searchExpenses,
} from "../../src/expenses/service";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { resetRateLimitForTests } from "../../src/access/rateLimit";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";
import { getRecentBlockedAttempts } from "../../src/activity/service";
import { config } from "../../src/config";
import { setBudget, getBudget } from "../../src/expenses/budgets";
import { spDateString } from "../../src/timeSP";
import { createEvent, getEventById, findUpcomingEvents } from "../../src/events/service";
import { listReminders, createReminder, findPendingRemindersByText } from "../../src/reminders/service";
import { listRecurringExpenses } from "../../src/expenses/recurring";

function evolutionMessage(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `test-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

// base64 inline no payload (mesmo formato que resolveMediaBase64 aceita direto,
// sem precisar buscar via getBase64FromMediaMessage) -- conteudo fake, ja que
// quem "le" a imagem nos testes e sempre o mock de interpretReceiptImage.
function evolutionImageMessage(from: string, mimetype = "image/jpeg") {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `test-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "imageMessage" as const,
    message: { imageMessage: { mimetype }, base64: "ZmFrZS1pbWFnZS1kYXRh" },
  };
}

// Mocka a IA (nunca chama a Anthropic de verdade nos testes) e o envio real de
// WhatsApp (nunca manda mensagem de verdade). `queueReply` enfileira a proxima
// resposta que a IA "daria"; cada chamada a interpretText consome uma da fila
// (fila vazia = simula a IA nao ter sido chamada, retornando nenhuma acao — util
// pra confirmar que fluxos de resposta pendente interceptam ANTES da IA).
function withMocks(t: TestContext) {
  // reseta contadores globais em memoria (rate limit, alerta pro dono) -- sem
  // isso, testes que reusam o mesmo numero repetidas vezes no arquivo (convencao
  // estabelecida aqui) acumulariam mensagens de cenarios sem relacao entre si e
  // dispararia o freio de emergencia sem ter nada a ver com o que o teste testa.
  resetRateLimitForTests();
  resetOwnerAlertForTests();
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
  assert.match(sent[0].text, /compras da semana/); // nome do produto/descricao na confirmacao
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
  assert.match(sent[1].text, /algo estranho/); // nome do produto/descricao na confirmacao
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
  assert.match(sent[0].text, /[Cc]onfirma/);
  await handleIncomingMessage(evolutionMessage(C, "sim"));

  const expense = findRecentExpense(C, "cabeleireiro corrigir");
  assert.equal(expense?.category_id, cat.id);
  assert.match(sent[1].text, /corrigida/);
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
  assert.match(sent[1].text, /[Cc]onfirma/);
  await handleIncomingMessage(evolutionMessage(A, "sim"));
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

test("unknown (evento parcial): sabe o dia mas falta a hora -- pergunta so a hora, preservando titulo e data, e cria ao responder", async (t) => {
  const EVU1 = "551100090201";
  seed(EVU1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "event", title: "revisão do carro", date: "2026-09-10" }]);
  await handleIncomingMessage(evolutionMessage(EVU1, "quarta feira agendar revisão do carro"));
  assert.match(sent[0].text, /revis[ãa]o do carro/i);
  assert.match(sent[0].text, /hora/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newTime: "10:00" }));
  await handleIncomingMessage(evolutionMessage(EVU1, "10h"));
  const [event] = findUpcomingEvents(EVU1, "revis");
  assert.ok(event);
  assert.equal(event.start, "2026-09-10T10:00:00-03:00");
  assert.match(sent[1].text, /criado/i);
});

test("unknown (evento parcial): so sabe o titulo -- pergunta dia E hora juntos, preservando o titulo, e cria ao responder os dois", async (t) => {
  const EVU2 = "551100090207";
  seed(EVU2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "event", title: "médico dr gustavo ted" }]);
  await handleIncomingMessage(evolutionMessage(EVU2, "agendar o médico dr gustavo ted"));
  assert.match(sent[0].text, /gustavo ted/i);
  assert.match(sent[0].text, /dia/i);
  assert.match(sent[0].text, /hor[áa]rio/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: "2026-09-16", newTime: "14:00" }));
  await handleIncomingMessage(evolutionMessage(EVU2, "quarta as 14h"));
  const [event] = findUpcomingEvents(EVU2, "gustavo");
  assert.ok(event);
  assert.equal(event.start, "2026-09-16T14:00:00-03:00");
});

test("unknown (lembrete parcial): sabe o dia mas falta a hora -- pergunta so a hora, preservando a mensagem e a data", async (t) => {
  const RMU1 = "551100090206";
  seed(RMU1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "reminder", message: "pagar a internet", date: "2026-09-15" }]);
  await handleIncomingMessage(evolutionMessage(RMU1, "sexta me lembra de pagar a internet"));
  assert.match(sent[0].text, /pagar a internet/i);
  assert.match(sent[0].text, /hora/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newTime: "09:00" }));
  await handleIncomingMessage(evolutionMessage(RMU1, "9h"));
  const [reminder] = findPendingRemindersByText(RMU1, "internet");
  assert.ok(reminder);
  assert.equal(reminder.due_at, "2026-09-15T09:00:00-03:00");
});

test("unknown (gasto parcial): sabe o valor mas falta o que foi -- pergunta so a descricao, preservando o valor", async (t) => {
  const EXU1 = "551100090202";
  seed(EXU1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "expense", amount: 50, category: "Mercado" }]);
  await handleIncomingMessage(evolutionMessage(EXU1, "gastei 50 reais"));
  assert.match(sent[0].text, /50/);
  assert.match(sent[0].text, /que foi/i);

  t.mock.method(aiInterpret, "extractExpenseInfoFromAnswer", async () => ({ description: "compras da semana" }));
  await handleIncomingMessage(evolutionMessage(EXU1, "foi no mercado"));
  const expense = findRecentExpense(EXU1, "compras da semana");
  assert.equal(expense?.amount, 50);
  assert.match(sent[1].text, /✅/);
});

test("unknown (gasto parcial): sabe do que foi mas falta o valor -- pergunta so o valor, preservando a descricao", async (t) => {
  const EXU2 = "551100090203";
  seed(EXU2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "expense", description: "remedio na farmacia", category: "Saúde" }]);
  await handleIncomingMessage(evolutionMessage(EXU2, "comprei remedio na farmacia"));
  assert.match(sent[0].text, /remedio na farmacia/i);
  assert.match(sent[0].text, /quanto/i);

  t.mock.method(aiInterpret, "extractExpenseInfoFromAnswer", async () => ({ amount: 35.9 }));
  await handleIncomingMessage(evolutionMessage(EXU2, "35,90"));
  const expense = findRecentExpense(EXU2, "remedio na farmacia");
  assert.equal(expense?.amount, 35.9);
});

test("unknown (fila de completude): duas mensagens incompletas na mesma vez -- pergunta uma de cada vez, na ordem", async (t) => {
  const EVU3 = "551100090204";
  seed(EVU3);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "unknown", likely_intent: "event", title: "revisão do carro", date: "2026-09-10" },
    { type: "unknown", likely_intent: "event", title: "médico dr gustavo ted" },
  ]);
  await handleIncomingMessage(evolutionMessage(EVU3, "quarta feira agendar revisão do carro, e agendar o médico dr gustavo ted"));
  assert.equal(sent.length, 1); // so pergunta sobre o primeiro por enquanto
  assert.match(sent[0].text, /revis[ãa]o do carro/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newTime: "10:00" }));
  await handleIncomingMessage(evolutionMessage(EVU3, "10h"));
  assert.equal(sent.length, 3); // confirma o 1o E ja pergunta o 2o, na mesma resposta
  assert.match(sent[1].text, /criado/i);
  assert.match(sent[2].text, /gustavo ted/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: "2026-09-11", newTime: "14:00" }));
  await handleIncomingMessage(evolutionMessage(EVU3, "sexta as 14h"));
  assert.equal(sent.length, 4);
  assert.match(sent[3].text, /criado/i);

  assert.equal(findUpcomingEvents(EVU3, "carro").length, 1);
  assert.equal(findUpcomingEvents(EVU3, "gustavo").length, 1);
});

test("unknown (evento parcial): responder 'nao' cancela sem criar nada", async (t) => {
  const EVU4 = "551100090205";
  seed(EVU4);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "event", title: "dentista", date: "2026-09-12" }]);
  await handleIncomingMessage(evolutionMessage(EVU4, "quinta marcar dentista"));
  assert.match(sent[0].text, /hora/i);

  await handleIncomingMessage(evolutionMessage(EVU4, "não, deixa pra lá"));
  assert.match(sent[1].text, /não criei nada/i);
  assert.equal(findUpcomingEvents(EVU4, "dentista").length, 0);
});

test("compra parcelada: com tudo informado, cria as N parcelas direto, uma por mes, com a soma batendo o total", async (t) => {
  const IN1 = "551100090301";
  seed(IN1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "installment_expense", description: "TV", category: "Compras", total_amount: 1000, installments: 3 }]);
  await handleIncomingMessage(evolutionMessage(IN1, "comprei uma TV de 1000 parcelada em 3x"));

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /✅/);
  assert.match(sent[0].text, /3x/);

  const items = searchExpenses(IN1, "TV");
  assert.equal(items.length, 3);
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 1000);
  const dates = items.map((i) => i.date.slice(0, 10)).sort();
  assert.equal(dates[0], today());
});

test("compra parcelada: sabe o valor e a descricao mas falta quantas vezes -- pergunta e cria ao responder", async (t) => {
  const IN2 = "551100090302";
  seed(IN2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "installment_expense", description: "Geladeira", category: "Compras", total_amount: 1500 }]);
  await handleIncomingMessage(evolutionMessage(IN2, "comprei uma geladeira de 1500 parcelada"));
  assert.match(sent[0].text, /[Gg]eladeira/);
  assert.match(sent[0].text, /quantas vezes/i);

  t.mock.method(aiInterpret, "extractInstallmentInfoFromAnswer", async () => ({ installments: 3 }));
  await handleIncomingMessage(evolutionMessage(IN2, "3 vezes"));
  const items = searchExpenses(IN2, "Geladeira");
  assert.equal(items.length, 3);
  assert.match(sent[1].text, /✅/);
});

test("compra parcelada: categoria desconhecida pergunta antes de criar, so cria depois de responder", async (t) => {
  const IN3 = "551100090303";
  seed(IN3);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "installment_expense", description: "coisa bem estranha", category: "CategoriaBemInventadaXYZ", total_amount: 300, installments: 3 },
  ]);
  await handleIncomingMessage(evolutionMessage(IN3, "comprei uma coisa bem estranha de 300 parcelada em 3x"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /[Cc]ategoria/);
  assert.equal(searchExpenses(IN3, "coisa bem estranha").length, 0);

  await handleIncomingMessage(evolutionMessage(IN3, "Pets"));
  const items = searchExpenses(IN3, "coisa bem estranha");
  assert.equal(items.length, 3);
  assert.match(sent[1].text, /✅/);
});

test("compra parcelada: valor de CADA parcela informado direto (nao o total) -- cada parcela sai exatamente com esse valor", async (t) => {
  const IN4 = "551100090304";
  seed(IN4);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "installment_expense", description: "Notebook", category: "Compras", installment_amount: 250, installments: 4 }]);
  await handleIncomingMessage(evolutionMessage(IN4, "notebook em 4x de 250"));
  const items = searchExpenses(IN4, "Notebook");
  assert.equal(items.length, 4);
  for (const item of items) assert.equal(item.amount, 250);
});

test("compra parcelada: undo remove todas as parcelas de uma vez", async (t) => {
  const IN5 = "551100090305";
  seed(IN5);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "installment_expense", description: "Sofa", category: "Compras", total_amount: 900, installments: 3 }]);
  await handleIncomingMessage(evolutionMessage(IN5, "sofa parcelado em 3x de 900"));
  assert.equal(searchExpenses(IN5, "Sofa").length, 3);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(IN5, "desfaz isso"));
  assert.equal(searchExpenses(IN5, "Sofa").length, 0);
  assert.match(sent[1].text, /desfiz/i);
});

test("imagem de comprovante: leitura completa mostra resumo, confirma com 'sim' e registra", async (t) => {
  const RC1 = "551100090401";
  seed(RC1);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Posto Ipiranga",
    date: "2026-09-01",
    totalAmount: 150,
    category: "Veículo",
    paymentMethod: "Pix",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC1));
  assert.match(sent[0].text, /Li assim/);
  assert.match(sent[0].text, /150/);
  assert.equal(searchExpenses(RC1, "Posto Ipiranga").length, 0);

  await handleIncomingMessage(evolutionMessage(RC1, "sim"));
  const items = searchExpenses(RC1, "Posto Ipiranga");
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 150);
  assert.match(sent[1].text, /✅/);
});

test("imagem de comprovante: categoria nao identificada pergunta antes de confirmar", async (t) => {
  const RC2 = "551100090402";
  seed(RC2);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Loja XPTO Bem Estranha",
    date: "2026-09-01",
    totalAmount: 80,
    paymentMethod: "Débito",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC2));
  assert.match(sent[0].text, /[Cc]ategoria/);

  await handleIncomingMessage(evolutionMessage(RC2, "Compras"));
  assert.match(sent[1].text, /Li assim/);

  await handleIncomingMessage(evolutionMessage(RC2, "sim"));
  assert.equal(searchExpenses(RC2, "Loja XPTO Bem Estranha").length, 1);
});

test("imagem de comprovante: forma de pagamento nao identificada pergunta antes de confirmar", async (t) => {
  const RC3 = "551100090403";
  seed(RC3);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Restaurante do Zé",
    date: "2026-09-01",
    totalAmount: 60,
    category: "Mercado",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC3));
  assert.match(sent[0].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(RC3, "no débito"));
  assert.match(sent[1].text, /Li assim/);
  assert.match(sent[1].text, /débito/i);

  await handleIncomingMessage(evolutionMessage(RC3, "sim"));
  assert.equal(searchExpenses(RC3, "Restaurante do Zé").length, 1);
});

test("imagem de comprovante: responder 'nao' cancela sem registrar nada", async (t) => {
  const RC4 = "551100090404";
  seed(RC4);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Farmacia Central",
    date: "2026-09-01",
    totalAmount: 35.9,
    category: "Saúde",
    paymentMethod: "Dinheiro",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC4));
  await handleIncomingMessage(evolutionMessage(RC4, "não"));
  assert.match(sent[1].text, /não registrei nada/i);
  assert.equal(searchExpenses(RC4, "Farmacia Central").length, 0);
});

test("imagem de comprovante: correcao em texto livre antes de confirmar ajusta o valor lido", async (t) => {
  const RC5 = "551100090405";
  seed(RC5);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Supermercado Extra",
    date: "2026-09-01",
    totalAmount: 100,
    category: "Mercado",
    paymentMethod: "Pix",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC5));

  t.mock.method(aiInterpret, "extractReceiptCorrectionFromAnswer", async () => ({ amount: 120 }));
  await handleIncomingMessage(evolutionMessage(RC5, "na verdade foi 120"));
  assert.match(sent[1].text, /120/);

  await handleIncomingMessage(evolutionMessage(RC5, "sim"));
  const items = searchExpenses(RC5, "Supermercado Extra");
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 120);
});

test("imagem de comprovante: parcelamento detectado no cupom cria as N parcelas ao confirmar", async (t) => {
  const RC6 = "551100090406";
  seed(RC6);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Loja de Eletronicos",
    date: "2026-09-01",
    installmentAmount: 200,
    installments: 3,
    category: "Compras",
    paymentMethod: "Cartão de crédito",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC6));
  assert.match(sent[0].text, /3x/);

  await handleIncomingMessage(evolutionMessage(RC6, "sim"));
  const items = searchExpenses(RC6, "Loja de Eletronicos");
  assert.equal(items.length, 3);
  for (const item of items) assert.equal(item.amount, 200);
});

test("imagem de comprovante: imagem que nao parece nota fiscal nao registra nada", async (t) => {
  const RC7 = "551100090407";
  seed(RC7);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({ isReceipt: false }));
  await handleIncomingMessage(evolutionImageMessage(RC7));
  assert.match(sent[0].text, /[Nn]ão consegui ler/);
});

// Regressao: relatado em producao -- foto enviada, numero liberado, mas SEM
// resposta nenhuma e SEM linha no /admin. Causa: um erro dentro do
// processamento de imagem (ex: falha na chamada da IA) nao tinha try/catch
// proprio, entao era engolido em silencio pelo .catch() do webhook.ts (so
// aparecia no console do servidor). Agora tem que sempre responder algo e
// registrar em logActivity, mesmo quando a leitura da imagem falha.
test("imagem de comprovante: erro na leitura da imagem responde algo pro usuario, nao fica em silencio", async (t) => {
  const RC8 = "551100090408";
  seed(RC8);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => {
    throw new Error("falha simulada na chamada da IA");
  });
  await handleIncomingMessage(evolutionImageMessage(RC8));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /[Dd]eu erro/);
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
  await handleIncomingMessage(evolutionMessage(U3, "sim"));
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
  await handleIncomingMessage(evolutionMessage(U4, "sim"));
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
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(listRecurringExpenses(R5).length, 1); // ainda nao removido, so perguntou

  await handleIncomingMessage(evolutionMessage(R5, "sim"));
  assert.match(sent[2].text, /removido/);
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

// Regressao de um bug real relatado em producao: "atender carol as quinze horas"
// foi marcado 12h em vez de 15h. A IA devolveu o horario sem o offset -03:00
// explicito; o container de producao roda em UTC, entao new Date(string sem
// offset) tratava como se ja fosse UTC, adiantando o evento em 3h. Local nao
// pegava porque o dev roda em America/Sao_Paulo por coincidencia -- por isso o
// teste confere new Date(...).toISOString(), que normaliza pra UTC sempre,
// independente do fuso da maquina que roda o teste.
test("evento criado com horario sem offset explicito (como a IA as vezes devolve) guarda o horario certo, nao adiantado", async (t) => {
  const TZ1 = "551100090060";
  seed(TZ1);
  const { queueReply } = withMocks(t);
  // 15h sem "-03:00" no final, exatamente como o bug relatado
  queueReply([{ type: "event", title: "atender Carol", start: "2026-09-10T15:00:00" }]);
  await handleIncomingMessage(evolutionMessage(TZ1, "atender carol as quinze horas"));

  const matches = findUpcomingEvents(TZ1, "atender Carol");
  assert.equal(matches.length, 1);
  // 15h em Brasilia = 18h UTC, nao importa o fuso da maquina rodando o teste
  assert.equal(new Date(matches[0].start).toISOString(), "2026-09-10T18:00:00.000Z");
});

test("lembrete criado com horario sem offset explicito guarda o horario certo, nao adiantado", async (t) => {
  const TZ2 = "551100090061";
  seed(TZ2);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "tomar remedio", due_at: "2026-09-10T20:00:00" }]);
  await handleIncomingMessage(evolutionMessage(TZ2, "me lembra de tomar remedio as 20h"));

  const reminders = listReminders(TZ2);
  assert.equal(reminders.length, 1);
  assert.equal(new Date(reminders[0].due_at).toISOString(), "2026-09-10T23:00:00.000Z");
});

// Regressao de um bug real relatado em producao: "criar caregoria 'marina' nos
// meus gastos" (erro de digitacao em "categoria") foi a PRIMEIRA mensagem de um
// numero novo, e foi entendida como um gasto em vez de criar a categoria --
// porque nao existia nenhuma acao dedicada pra "so criar uma categoria vazia",
// so pra corrigir a categoria de um gasto ja existente (correct_category).
test("create_category: cria a categoria mesmo sem gasto nenhum associado ainda", async (t) => {
  const CC1 = "551100090070";
  allowNumber(CC1); // numero novo de proposito (sem ensureUserSeeded), igual o caso relatado
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "create_category", category: "Marina" }]);
  await handleIncomingMessage(evolutionMessage(CC1, "criar caregoria 'marina' nos meus gastos"));

  assert.ok(findCategoryByName(CC1, "Marina"));
  assert.match(sent[sent.length - 1].text, /criada/);
  assert.doesNotMatch(sent[sent.length - 1].text, /gasto registrado/i);
});

test("create_category: categoria que ja existe avisa em vez de fingir que criou de novo", async (t) => {
  const CC2 = "551100090071";
  seed(CC2);
  getOrCreateCategory(CC2, "Pets");

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "create_category", category: "Pets" }]);
  await handleIncomingMessage(evolutionMessage(CC2, "cria uma categoria chamada Pets"));

  assert.match(sent[0].text, /já tem/i);
});

test("bulk_recategorize (scope=today): pede confirmacao, so aplica com 'sim', e nao mexe em gasto de outro dia", async (t) => {
  const BR1 = "551100090080";
  seed(BR1);
  const origem = getOrCreateCategory(BR1, "Origem-hoje");
  const destino = getOrCreateCategory(BR1, "Lazer-hoje");
  const hoje1 = insertExpense({ fromNumber: BR1, amount: 10, description: "hoje 1", categoryId: origem.id, paymentMethodId: null, date: today() });
  const hoje2 = insertExpense({ fromNumber: BR1, amount: 20, description: "hoje 2", categoryId: origem.id, paymentMethodId: null, date: today() });
  const ontem = insertExpense({ fromNumber: BR1, amount: 30, description: "ontem", categoryId: origem.id, paymentMethodId: null, date: "2020-01-01" });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "today", to_category: "Lazer-hoje" }]);
  await handleIncomingMessage(evolutionMessage(BR1, "muda os gastos de hoje pra lazer-hoje"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(getExpenseById(BR1, hoje1.id)?.category_id, origem.id); // ainda nao mudou, so perguntou

  await handleIncomingMessage(evolutionMessage(BR1, "sim"));
  assert.equal(getExpenseById(BR1, hoje1.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR1, hoje2.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR1, ontem.id)?.category_id, origem.id); // gasto de outro dia nao foi mexido
});

test("bulk_recategorize (scope=last_n): move so os N mais recentes", async (t) => {
  const BR2 = "551100090081";
  seed(BR2);
  const origem = getOrCreateCategory(BR2, "Origem-n");
  const destino = getOrCreateCategory(BR2, "Mercado-n");
  const antigo = insertExpense({ fromNumber: BR2, amount: 1, description: "antigo", categoryId: origem.id, paymentMethodId: null, date: "2026-01-01" });
  const novo1 = insertExpense({ fromNumber: BR2, amount: 2, description: "novo 1", categoryId: origem.id, paymentMethodId: null, date: "2026-02-01" });
  const novo2 = insertExpense({ fromNumber: BR2, amount: 3, description: "novo 2", categoryId: origem.id, paymentMethodId: null, date: "2026-03-01" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "last_n", n: 2, to_category: "Mercado-n" }]);
  await handleIncomingMessage(evolutionMessage(BR2, "muda os ultimos 2 gastos pra mercado-n"));
  await handleIncomingMessage(evolutionMessage(BR2, "sim"));

  assert.equal(getExpenseById(BR2, novo1.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR2, novo2.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR2, antigo.id)?.category_id, origem.id); // fora dos 2 mais recentes
});

test("bulk_recategorize (scope=from_category): move todos os gastos de uma categoria pra outra", async (t) => {
  const BR3 = "551100090082";
  seed(BR3);
  const origem = getOrCreateCategory(BR3, "Mercado-swap");
  const destino = getOrCreateCategory(BR3, "Lazer-swap");
  const e1 = insertExpense({ fromNumber: BR3, amount: 10, description: "swap 1", categoryId: origem.id, paymentMethodId: null, date: "2026-05-01" });
  const e2 = insertExpense({ fromNumber: BR3, amount: 20, description: "swap 2", categoryId: origem.id, paymentMethodId: null, date: "2026-05-02" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "from_category", category: "Mercado-swap", to_category: "Lazer-swap" }]);
  await handleIncomingMessage(evolutionMessage(BR3, "muda os gastos de mercado-swap pra lazer-swap"));
  await handleIncomingMessage(evolutionMessage(BR3, "sim"));

  assert.equal(getExpenseById(BR3, e1.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR3, e2.id)?.category_id, destino.id);
});

test("bulk_recategorize: responder 'nao' nao muda nada", async (t) => {
  const BR4 = "551100090083";
  seed(BR4);
  const origem = getOrCreateCategory(BR4, "Origem-nao");
  const destino = getOrCreateCategory(BR4, "Destino-nao");
  const e1 = insertExpense({ fromNumber: BR4, amount: 10, description: "fica igual", categoryId: origem.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "today", to_category: "Destino-nao" }]);
  await handleIncomingMessage(evolutionMessage(BR4, "muda os gastos de hoje pra destino-nao"));
  await handleIncomingMessage(evolutionMessage(BR4, "não, deixa"));

  assert.match(sent[1].text, /não mexi/i);
  assert.equal(getExpenseById(BR4, e1.id)?.category_id, origem.id);
});

test("bulk_recategorize: sem gasto encontrado avisa em vez de pedir confirmacao do nada", async (t) => {
  const BR5 = "551100090084";
  seed(BR5);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "today", to_category: "Qualquer" }]);
  await handleIncomingMessage(evolutionMessage(BR5, "muda os gastos de hoje pra qualquer"));
  assert.match(sent[0].text, /[Nn]ão encontrei/);
});

test("bulk_recategorize: undo desfaz a recategorizacao em lote inteira", async (t) => {
  const BR6 = "551100090085";
  seed(BR6);
  const origem = getOrCreateCategory(BR6, "Origem-undo");
  const destino = getOrCreateCategory(BR6, "Destino-undo");
  const e1 = insertExpense({ fromNumber: BR6, amount: 10, description: "undo 1", categoryId: origem.id, paymentMethodId: null, date: today() });
  const e2 = insertExpense({ fromNumber: BR6, amount: 20, description: "undo 2", categoryId: null, paymentMethodId: null, date: today() }); // sem categoria antes

  const { queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "today", to_category: "Destino-undo" }]);
  await handleIncomingMessage(evolutionMessage(BR6, "muda os gastos de hoje pra destino-undo"));
  await handleIncomingMessage(evolutionMessage(BR6, "sim"));
  assert.equal(getExpenseById(BR6, e1.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR6, e2.id)?.category_id, destino.id);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(BR6, "desfaz isso"));
  assert.equal(getExpenseById(BR6, e1.id)?.category_id, origem.id);
  assert.equal(getExpenseById(BR6, e2.id)?.category_id, null); // volta pra "sem categoria", nao fica preso no destino
});

test("bulk_recategorize (scope=period): move so os gastos do intervalo de datas exato", async (t) => {
  const BR7 = "551100090086";
  seed(BR7);
  const origem = getOrCreateCategory(BR7, "Origem-periodo");
  const destino = getOrCreateCategory(BR7, "Destino-periodo");
  const dentro = insertExpense({ fromNumber: BR7, amount: 10, description: "dentro do intervalo", categoryId: origem.id, paymentMethodId: null, date: "2026-03-15" });
  const fora = insertExpense({ fromNumber: BR7, amount: 20, description: "fora do intervalo", categoryId: origem.id, paymentMethodId: null, date: "2026-04-01" });

  const { queueReply } = withMocks(t);
  queueReply([
    { type: "bulk_recategorize", scope: "period", date_start: "2026-03-10", date_end: "2026-03-20", to_category: "Destino-periodo" },
  ]);
  await handleIncomingMessage(evolutionMessage(BR7, "muda os gastos de 10 a 20 de marco pra destino-periodo"));
  await handleIncomingMessage(evolutionMessage(BR7, "sim"));

  assert.equal(getExpenseById(BR7, dentro.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR7, fora.id)?.category_id, origem.id); // fora do intervalo, nao mexeu
});

test("bulk_recategorize (scope=keyword): move so os gastos cuja descricao bate com a palavra", async (t) => {
  const BR8 = "551100090087";
  seed(BR8);
  const origem = getOrCreateCategory(BR8, "Origem-keyword");
  const destino = getOrCreateCategory(BR8, "Alimentacao-keyword");
  const bate = insertExpense({ fromNumber: BR8, amount: 10, description: "iFood lanche", categoryId: origem.id, paymentMethodId: null, date: "2026-01-01" });
  const naoBate = insertExpense({ fromNumber: BR8, amount: 20, description: "uber corrida", categoryId: origem.id, paymentMethodId: null, date: "2026-01-02" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "bulk_recategorize", scope: "keyword", query: "ifood", to_category: "Alimentacao-keyword" }]);
  await handleIncomingMessage(evolutionMessage(BR8, "muda todo gasto com ifood na descricao pra alimentacao-keyword"));
  await handleIncomingMessage(evolutionMessage(BR8, "sim"));

  assert.equal(getExpenseById(BR8, bate.id)?.category_id, destino.id);
  assert.equal(getExpenseById(BR8, naoBate.id)?.category_id, origem.id);
});

test("merge_categories: junta a categoria de origem na de destino, apaga a origem, e move os gastos", async (t) => {
  const MC1 = "551100090090";
  seed(MC1);
  const origem = getOrCreateCategory(MC1, "Mercado-merge");
  const destino = getOrCreateCategory(MC1, "Supermercado-merge");
  const e1 = insertExpense({ fromNumber: MC1, amount: 10, description: "merge 1", categoryId: origem.id, paymentMethodId: null, date: "2026-01-01" });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "merge_categories", category: "Mercado-merge", to_category: "Supermercado-merge" }]);
  await handleIncomingMessage(evolutionMessage(MC1, "junta a categoria mercado-merge com supermercado-merge"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.ok(findCategoryByName(MC1, "Mercado-merge")); // ainda existe, so perguntou

  await handleIncomingMessage(evolutionMessage(MC1, "sim"));
  assert.equal(findCategoryByName(MC1, "Mercado-merge"), null); // categoria de origem foi apagada
  assert.equal(getExpenseById(MC1, e1.id)?.category_id, destino.id);
});

test("merge_categories: undo recria a categoria de origem e devolve os gastos pra ela", async (t) => {
  const MC2 = "551100090091";
  seed(MC2);
  const origem = getOrCreateCategory(MC2, "Lazer-merge-undo");
  const destino = getOrCreateCategory(MC2, "Diversao-merge-undo");
  const e1 = insertExpense({ fromNumber: MC2, amount: 10, description: "merge undo 1", categoryId: origem.id, paymentMethodId: null, date: "2026-01-01" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "merge_categories", category: "Lazer-merge-undo", to_category: "Diversao-merge-undo" }]);
  await handleIncomingMessage(evolutionMessage(MC2, "junta lazer-merge-undo em diversao-merge-undo"));
  await handleIncomingMessage(evolutionMessage(MC2, "sim"));
  assert.equal(findCategoryByName(MC2, "Lazer-merge-undo"), null);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(MC2, "desfaz isso"));
  const recreated = findCategoryByName(MC2, "Lazer-merge-undo");
  assert.ok(recreated);
  assert.equal(getExpenseById(MC2, e1.id)?.category_id, recreated!.id);
});

// Pedido do usuario: nenhuma alteracao (gasto, categoria...) deve ser aplicada
// sem antes mostrar "de X pra Y" e pedir confirmacao -- e se a resposta nao for
// um "sim"/"nao" claro, deve dar pra AJUSTAR o valor proposto antes de efetivar.
test("edit_expense: pede confirmacao antes de mudar, e permite ajustar o valor antes de confirmar", async (t) => {
  const EE1 = "551100090095";
  seed(EE1);
  const cat = getOrCreateCategory(EE1, "Edit-confirm");
  insertExpense({ fromNumber: EE1, amount: 40, description: "gasto edit confirm", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "gasto edit confirm", field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(EE1, "muda o gasto edit confirm pra 45"));
  assert.match(sent[0].text, /45/);
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(findRecentExpense(EE1, "gasto edit confirm")?.amount, 40); // ainda nao mudou, so perguntou

  // nem "sim" nem "nao": trata como ajuste do valor proposto
  await handleIncomingMessage(evolutionMessage(EE1, "46,50"));
  assert.match(sent[1].text, /46\.50/); // mesmo formato ja usado no resto das mensagens (R$X.XX)
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(findRecentExpense(EE1, "gasto edit confirm")?.amount, 40); // continua sem confirmar

  await handleIncomingMessage(evolutionMessage(EE1, "sim"));
  assert.equal(findRecentExpense(EE1, "gasto edit confirm")?.amount, 46.5);
});

test("edit_expense: responder 'nao' nao muda nada", async (t) => {
  const EE2 = "551100090096";
  seed(EE2);
  const cat = getOrCreateCategory(EE2, "Edit-nao");
  insertExpense({ fromNumber: EE2, amount: 20, description: "gasto edit nao", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "gasto edit nao", field: "amount", value: "99" }]);
  await handleIncomingMessage(evolutionMessage(EE2, "muda o gasto edit nao pra 99"));
  await handleIncomingMessage(evolutionMessage(EE2, "não, deixa"));
  assert.match(sent[1].text, /não mexi/i);
  assert.equal(findRecentExpense(EE2, "gasto edit nao")?.amount, 20);
});

test("correct_category: pede confirmacao antes de mudar, e permite ajustar a categoria antes de confirmar", async (t) => {
  const CC10 = "551100090097";
  seed(CC10);
  const original = getOrCreateCategory(CC10, "Categoria-original-confirm");
  insertExpense({ fromNumber: CC10, amount: 30, description: "gasto categoria confirm", categoryId: original.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "correct_category", category: "Lazer-confirm", query: "gasto categoria confirm" }]);
  await handleIncomingMessage(evolutionMessage(CC10, "muda a categoria do gasto categoria confirm pra lazer-confirm"));
  assert.match(sent[0].text, /Categoria-original-confirm/);
  assert.match(sent[0].text, /Lazer-confirm/);
  assert.equal(findRecentExpense(CC10, "gasto categoria confirm")?.category_id, original.id); // ainda nao mudou

  // ajuste com ate 3 palavras: resolve direto (nao chama extractCategoryFromAnswer,
  // que faria uma chamada de verdade a IA -- ver resolvePendingCategorization,
  // mesma convencao ja usada nos outros testes desse arquivo)
  await handleIncomingMessage(evolutionMessage(CC10, "Viagem-confirm"));
  assert.match(sent[1].text, /Viagem-confirm/);
  assert.equal(findRecentExpense(CC10, "gasto categoria confirm")?.category_id, original.id);

  await handleIncomingMessage(evolutionMessage(CC10, "sim"));
  const final = findRecentExpense(CC10, "gasto categoria confirm");
  assert.equal(findCategoryByName(CC10, "Viagem-confirm")?.id, final?.category_id);
});

test("correct_category: ja esta na categoria pedida, avisa sem pedir confirmacao", async (t) => {
  const CC11 = "551100090098";
  seed(CC11);
  const cat = getOrCreateCategory(CC11, "Ja-esta-confirm");
  insertExpense({ fromNumber: CC11, amount: 10, description: "gasto ja esta", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "correct_category", category: "Ja-esta-confirm", query: "gasto ja esta" }]);
  await handleIncomingMessage(evolutionMessage(CC11, "muda a categoria do gasto ja esta pra ja-esta-confirm"));
  assert.match(sent[0].text, /já está/i);
});

test("reminder: mensagem de criacao mostra o horario que vai avisar", async (t) => {
  const REM1 = "551100090100";
  seed(REM1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "tomar remedio", due_at: "2026-09-10T20:00:00-03:00" }]);
  await handleIncomingMessage(evolutionMessage(REM1, "me lembra de tomar remedio as 20h"));
  assert.match(sent[0].text, /20:00/);
});

// Pedido do usuario: relatou que criou um evento (confirmacao chegou) mas ele
// nao aparecia no calendario -- a mensagem de confirmacao nao mostrava a
// data/hora marcada, dificultando notar se a IA guardou o dia errado.
test("event: mensagem de criacao mostra a data/hora marcada", async (t) => {
  const EV1 = "551100090101";
  seed(EV1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "event", title: "consulta médica", start: "2026-09-15T14:00:00-03:00" }]);
  await handleIncomingMessage(evolutionMessage(EV1, "marca consulta médica dia 15 as 14h"));
  assert.match(sent[0].text, /15\/09\/2026/);
  assert.match(sent[0].text, /14:00/);
});

// Regressao do mesmo caso: se a IA nao achar nenhum horario na mensagem (so
// "adicionar consulta medica", sem "quando") e devolver so a data, o evento
// tem que continuar sendo criado corretamente (meia-noite como horario padrao),
// nao travar nem sumir do calendario por causa de um ISO malformado.
test("event: mensagem so com data (sem hora) ainda cria o evento corretamente", async (t) => {
  const EV2 = "551100090102";
  seed(EV2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "event", title: "consulta sem hora", start: "2026-09-20" }]);
  await handleIncomingMessage(evolutionMessage(EV2, "adicionar consulta sem hora dia 20"));
  assert.match(sent[0].text, /📅/);
  assert.doesNotMatch(sent[0].text, /erro/i);

  const matches = findUpcomingEvents(EV2, "consulta sem hora");
  assert.equal(matches.length, 1);
  assert.equal(new Date(matches[0].start).toISOString(), "2026-09-20T03:00:00.000Z"); // meia-noite BRT = 03:00 UTC
});

// Pedido do usuario: alem de gasto/categoria, editar DATA de evento e lembrete
// tambem precisa da mesma confirmacao "de X pra Y" antes de aplicar.
test("edit_event: pede confirmacao antes de remarcar, preserva a duracao do evento, e 'nao' cancela", async (t) => {
  const EV1 = "551100090101";
  seed(EV1);
  const original = nearFuture();
  const event = createEvent({ fromNumber: EV1, title: "Reuniao a remarcar", start: original, location: "Sala 1" });
  const originalDurationMs = new Date(event.end).getTime() - new Date(event.start).getTime();

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao a remarcar", new_date: "2026-09-25", new_time: "16:00" }]);
  await handleIncomingMessage(evolutionMessage(EV1, "remarca a reuniao a remarcar pro dia 25 de setembro as 16h"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(getEventById(EV1, event.id)?.start, original); // ainda nao mudou, so perguntou

  await handleIncomingMessage(evolutionMessage(EV1, "sim"));
  const updated = getEventById(EV1, event.id)!;
  assert.equal(updated.start, "2026-09-25T16:00:00-03:00");
  assert.equal(updated.location, "Sala 1"); // resto do evento nao mudou
  const newDurationMs = new Date(updated.end).getTime() - new Date(updated.start).getTime();
  assert.equal(newDurationMs, originalDurationMs); // duracao original preservada
});

// Pedido do usuario: pedir so a mudanca do DIA nao pode apagar o horario
// original (nem o contrario) -- relatado em producao: consulta as 11h remarcada
// so de dia virou sem horario nenhum.
test("edit_event: mudar so o dia mantem o horario original, e mudar so o horario mantem o dia original", async (t) => {
  const EV1B = "551100090109";
  seed(EV1B);
  const event = createEvent({ fromNumber: EV1B, title: "Consulta médica", start: "2026-11-02T11:00:00-03:00" });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "consulta médica", new_date: "2026-11-10" }]); // so o dia, sem new_time
  await handleIncomingMessage(evolutionMessage(EV1B, "muda a consulta médica pro dia 10"));
  await handleIncomingMessage(evolutionMessage(EV1B, "sim"));
  assert.equal(getEventById(EV1B, event.id)?.start, "2026-11-10T11:00:00-03:00"); // manteve as 11h

  queueReply([{ type: "edit_event", query: "consulta médica", new_time: "15:30" }]); // so o horario, sem new_date
  await handleIncomingMessage(evolutionMessage(EV1B, "muda a consulta médica pras 15:30"));
  await handleIncomingMessage(evolutionMessage(EV1B, "sim"));
  assert.equal(getEventById(EV1B, event.id)?.start, "2026-11-10T15:30:00-03:00"); // manteve o dia 10
});

test("edit_event: responder 'nao' nao muda a data", async (t) => {
  const EV2 = "551100090102";
  seed(EV2);
  const original = nearFuture();
  const event = createEvent({ fromNumber: EV2, title: "Reuniao fixa", start: original });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao fixa", new_date: "2026-10-10", new_time: "09:00" }]);
  await handleIncomingMessage(evolutionMessage(EV2, "remarca a reuniao fixa"));
  await handleIncomingMessage(evolutionMessage(EV2, "não, deixa"));
  assert.match(sent[1].text, /não mexi/i);
  assert.equal(getEventById(EV2, event.id)?.start, original);
});

test("edit_event: sem evento encontrado avisa, e mais de um pede pra especificar", async (t) => {
  const EV3 = "551100090103";
  seed(EV3);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "edit_event", query: "nao existe", new_date: "2026-10-01", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(EV3, "remarca a reuniao que nao existe"));
  assert.match(sent[0].text, /[Nn]ão encontrei/);

  createEvent({ fromNumber: EV3, title: "Duplicado A", start: nearFuture() });
  createEvent({ fromNumber: EV3, title: "Duplicado B", start: nearFuture() });
  queueReply([{ type: "edit_event", query: "duplicado", new_date: "2026-10-01", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(EV3, "remarca o duplicado"));
  assert.match(sent[1].text, /mais de um evento/i);
});

test("edit_event: ajuste em frase livre reinterpreta a data via IA (mockada) antes de confirmar, mantendo o que nao foi ajustado", async (t) => {
  const EV4 = "551100090104";
  seed(EV4);
  const event = createEvent({ fromNumber: EV4, title: "Consulta ajuste", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: "2026-10-20" })); // so o dia, no ajuste
  queueReply([{ type: "edit_event", query: "consulta ajuste", new_date: "2026-10-05", new_time: "14:00" }]);
  await handleIncomingMessage(evolutionMessage(EV4, "remarca a consulta ajuste pro dia 5 de outubro as 14h"));

  await handleIncomingMessage(evolutionMessage(EV4, "na verdade prefiro dia 20")); // nem sim nem nao
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(getEventById(EV4, event.id)?.start, event.start); // ainda nao aplicado

  await handleIncomingMessage(evolutionMessage(EV4, "sim"));
  // ajustou so o dia (20 em vez de 5); a hora 14:00 proposta antes do ajuste continua
  assert.equal(getEventById(EV4, event.id)?.start, "2026-10-20T14:00:00-03:00");
});

test("edit_event: undo volta o evento pro horario de antes", async (t) => {
  const EV5 = "551100090105";
  seed(EV5);
  const original = nearFuture();
  const event = createEvent({ fromNumber: EV5, title: "Reuniao undo", start: original });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao undo", new_date: "2026-11-01", new_time: "08:00" }]);
  await handleIncomingMessage(evolutionMessage(EV5, "remarca a reuniao undo"));
  await handleIncomingMessage(evolutionMessage(EV5, "sim"));
  assert.equal(getEventById(EV5, event.id)?.start, "2026-11-01T08:00:00-03:00");

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(EV5, "desfaz isso"));
  assert.equal(getEventById(EV5, event.id)?.start, original);
});

test("edit_reminder: pede confirmacao antes de remarcar, 'nao' cancela, e undo volta pro horario de antes", async (t) => {
  const ER1 = "551100090106";
  seed(ER1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "pagar internet", due_at: "2026-09-05T09:00:00-03:00" }]);
  await handleIncomingMessage(evolutionMessage(ER1, "me lembra de pagar internet dia 5 as 9h"));
  const reminderId = listReminders(ER1)[0].id;

  queueReply([{ type: "edit_reminder", query: "pagar internet", new_date: "2026-09-06", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(ER1, "muda o lembrete de pagar internet pro dia 6 as 10h"));
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(listReminders(ER1).find((r) => r.id === reminderId)?.due_at, "2026-09-05T09:00:00-03:00");

  await handleIncomingMessage(evolutionMessage(ER1, "não"));
  assert.match(sent[2].text, /não mexi/i);
  assert.equal(listReminders(ER1).find((r) => r.id === reminderId)?.due_at, "2026-09-05T09:00:00-03:00");

  queueReply([{ type: "edit_reminder", query: "pagar internet", new_date: "2026-09-06", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(ER1, "muda o lembrete de pagar internet pro dia 6 as 10h"));
  await handleIncomingMessage(evolutionMessage(ER1, "sim"));
  assert.equal(listReminders(ER1).find((r) => r.id === reminderId)?.due_at, "2026-09-06T10:00:00-03:00");

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(ER1, "desfaz isso"));
  assert.equal(listReminders(ER1).find((r) => r.id === reminderId)?.due_at, "2026-09-05T09:00:00-03:00");
});

// Mesmo pedido do usuario vale pra lembrete: mudar so o dia nao pode apagar o
// horario original.
test("edit_reminder: mudar so o dia mantem o horario original", async (t) => {
  const ER2 = "551100090107";
  seed(ER2);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "tomar remedio", due_at: "2026-09-10T21:00:00-03:00" }]);
  await handleIncomingMessage(evolutionMessage(ER2, "me lembra de tomar remedio dia 10 as 21h"));
  const reminderId = listReminders(ER2)[0].id;

  queueReply([{ type: "edit_reminder", query: "tomar remedio", new_date: "2026-09-12" }]); // so o dia
  await handleIncomingMessage(evolutionMessage(ER2, "muda o lembrete do remedio pro dia 12"));
  await handleIncomingMessage(evolutionMessage(ER2, "sim"));
  assert.equal(listReminders(ER2).find((r) => r.id === reminderId)?.due_at, "2026-09-12T21:00:00-03:00"); // manteve as 21h
});

// Pedido do usuario: nao so editar, tambem EXCLUIR (orcamento, gasto fixo) deve
// pedir confirmacao antes de aplicar de verdade -- delete_event ja fazia isso.
test("remove_budget: pede confirmacao antes de remover, 'nao' mantem, 'sim' remove, e undo restaura", async (t) => {
  const RB1 = "551100090110";
  seed(RB1);
  const cat = getOrCreateCategory(RB1, "Orcamento-confirm");
  setBudget(RB1, cat.id, 300);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "remove_budget", category: "Orcamento-confirm" }]);
  await handleIncomingMessage(evolutionMessage(RB1, "tira o orcamento de orcamento-confirm"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(getBudget(RB1, cat.id), 300); // ainda nao removeu, so perguntou

  await handleIncomingMessage(evolutionMessage(RB1, "não"));
  assert.match(sent[1].text, /não mexi/i);
  assert.equal(getBudget(RB1, cat.id), 300);

  queueReply([{ type: "remove_budget", category: "Orcamento-confirm" }]);
  await handleIncomingMessage(evolutionMessage(RB1, "tira o orcamento de orcamento-confirm"));
  await handleIncomingMessage(evolutionMessage(RB1, "sim"));
  assert.equal(getBudget(RB1, cat.id), null);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(RB1, "desfaz isso"));
  assert.equal(getBudget(RB1, cat.id), 300);
});

test("remove_recurring_expense: responder 'nao' mantem o gasto fixo ativo", async (t) => {
  const RR1 = "551100090111";
  seed(RR1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "academia nao", amount: 89.9, category: "Saude", day_of_month: 5 }]);
  await handleIncomingMessage(evolutionMessage(RR1, "todo dia 5 pago 89,90 de academia nao"));

  queueReply([{ type: "remove_recurring_expense", query: "academia nao" }]);
  await handleIncomingMessage(evolutionMessage(RR1, "cancela o gasto fixo da academia nao"));
  await handleIncomingMessage(evolutionMessage(RR1, "não, deixa"));
  assert.match(sent[2].text, /não mexi/i);
  assert.equal(listRecurringExpenses(RR1).length, 1);
});

test("remove_recurring_expense: undo recria o gasto fixo removido", async (t) => {
  const RR2 = "551100090112";
  seed(RR2);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "netflix undo", amount: 39.9, category: "Lazer", day_of_month: 15 }]);
  await handleIncomingMessage(evolutionMessage(RR2, "todo dia 15 pago 39,90 de netflix undo"));

  queueReply([{ type: "remove_recurring_expense", query: "netflix undo" }]);
  await handleIncomingMessage(evolutionMessage(RR2, "cancela o gasto fixo do netflix undo"));
  await handleIncomingMessage(evolutionMessage(RR2, "sim"));
  assert.equal(listRecurringExpenses(RR2).length, 0);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(RR2, "desfaz isso"));
  const restored = listRecurringExpenses(RR2);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].description, "netflix undo");
  assert.equal(restored[0].day_of_month, 15);
});

// Pedido do usuario: "exibir minha agenda de novembro" nao era entendido, porque
// type=report so tinha "proximos X dias" (sem jeito de pedir um mes especifico).
// De quebra corrigiu um vazamento real: getRemindersWithinDays nao filtrava por
// numero, entao o relatorio de "proximos dias" mostrava lembrete de QUALQUER
// numero do sistema, nao so do numero que perguntou.
test("report: agenda de um mes especifico (evento e lembrete), isolado por numero", async (t) => {
  const REP1 = "551100090120";
  const REP2 = "551100090121";
  seed(REP1, REP2);

  createEvent({ fromNumber: REP1, title: "consulta em novembro", start: "2026-11-10T14:00:00-03:00" });
  createEvent({ fromNumber: REP1, title: "consulta em dezembro", start: "2026-12-05T14:00:00-03:00" });
  createReminder(REP1, "lembrete em novembro", "2026-11-20T09:00:00-03:00");
  createEvent({ fromNumber: REP2, title: "evento de novembro do REP2", start: "2026-11-15T10:00:00-03:00" }); // nao pode vazar pra REP1

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "report", month: "2026-11" }]);
  await handleIncomingMessage(evolutionMessage(REP1, "exibir minha agenda de novembro"));

  assert.match(sent[0].text, /novembro/i);
  assert.match(sent[0].text, /consulta em novembro/);
  assert.match(sent[0].text, /lembrete em novembro/);
  assert.doesNotMatch(sent[0].text, /consulta em dezembro/);
  assert.doesNotMatch(sent[0].text, /REP2/);
});

test("report: 'proximos X dias' continua funcionando e so mostra lembrete do proprio numero", async (t) => {
  const REP3 = "551100090122";
  const REP4 = "551100090123";
  seed(REP3, REP4);

  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  createReminder(REP3, "lembrete proximo de REP3", soon);
  createReminder(REP4, "lembrete proximo de REP4", soon); // SEGURANCA: nao pode vazar pra REP3

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "report", days: 7 }]);
  await handleIncomingMessage(evolutionMessage(REP3, "o que eu tenho agendado nos proximos 7 dias"));

  assert.match(sent[0].text, /lembrete proximo de REP3/);
  assert.doesNotMatch(sent[0].text, /lembrete proximo de REP4/);
});

// Reproducao exata do caso relatado em producao: evento marcado por engano a
// mais de 60 dias no futuro (consulta medica pra 02/11, criada em 28/08 --
// 66 dias) nao era encontrado pra editar ("nao encontrei nenhum evento
// parecido... nos proximos sessenta dias"), travando justamente a correcao
// do proprio erro que a IA cometeu.
test("edit_event: encontra e remarca evento criado a mais de 60 dias no futuro", async (t) => {
  const EE10 = "551100090130";
  seed(EE10);
  const farFuture = new Date(Date.now() + 66 * 24 * 60 * 60 * 1000).toISOString();
  const event = createEvent({ fromNumber: EE10, title: "consulta médica", start: farFuture });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "consulta médica", new_date: "2026-09-20", new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(EE10, "muda a consulta médica pro dia 20 de setembro as 10h"));
  assert.doesNotMatch(sent[0].text, /[Nn]ão encontrei/);
  assert.match(sent[0].text, /[Cc]onfirma/);

  await handleIncomingMessage(evolutionMessage(EE10, "sim"));
  const updated = getEventById(EE10, event.id);
  assert.equal(new Date(updated!.start).toISOString(), "2026-09-20T13:00:00.000Z"); // 10h BRT = 13h UTC
});
