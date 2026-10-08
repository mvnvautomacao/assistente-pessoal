import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import * as aiTranscribe from "../../src/ai/transcribe";
import * as expensesService from "../../src/expenses/service";
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
  learnKeyword,
  getReportSubscribers,
  getNoExpenseReminderSettings,
  getNextPendingCategorization,
  backdatePendingCategorizationForTests,
  getOrCreatePaymentMethod,
  setDefaultPaymentMethod,
  getDefaultPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  findPaymentMethodByName,
} from "../../src/expenses/service";
import { backdatePendingExpensePaymentMethodForTests } from "../../src/expenses/pendingPaymentMethod";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { blockNumber } from "../../src/access/blocklist";
import { resetRateLimitForTests } from "../../src/access/rateLimit";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";
import { getRecentBlockedAttempts, getRecentActivity } from "../../src/activity/service";
import { config } from "../../src/config";
import { setBudget, getBudget } from "../../src/expenses/budgets";
import { setPaymentMethodLimit } from "../../src/expenses/balance";
import { insertIncome } from "../../src/incomes/service";
import { spDateString, addDaysToDateString } from "../../src/timeSP";
import { createEvent, getEventById, findUpcomingEvents, listEventReminderMinutes, addEventExtraReminder, deleteEvent } from "../../src/events/service";
import { listReminders, createReminder, findPendingRemindersByText, getReminderById } from "../../src/reminders/service";
import { listRecurringExpenses, createRecurringExpense, getRecurringExpenseById } from "../../src/expenses/recurring";
import { listBillAlerts, getBillAlertById, createBillAlert } from "../../src/bills/service";
import { setPendingBillCheckin } from "../../src/bills/pendingCheckin";

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

// mesma ideia da imagem: base64 inline, conteudo fake (quem "ouve" o audio nos
// testes e sempre o mock de transcribeAudio).
function evolutionAudioMessage(from: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `test-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "audioMessage" as const,
    message: { base64: "ZmFrZS1hdWRpby1kYXRh" },
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

// Data-calendario (sem hora) uns dias no futuro -- pra testes de evento, que
// usam findUpcomingEvents (so traz start >= agora), nao pararem de passar
// sozinhos conforme os dias passam. Achado real da auditoria: datas fixas tipo
// "2026-09-10" ficavam no passado depois de um tempo e quebravam o teste.
const nearFutureDateString = () => addDaysToDateString(spDateString(), 10);

// pre-seeda categorias/formas padrao (pra nenhum teste receber a mensagem de
// boas-vindas misturada com a resposta que o teste espera), autoriza o numero
// na allowlist (senao toda mensagem seria ignorada em silencio, ver
// access/allowlist.ts) E ja deixa uma forma de pagamento padrao definida --
// simula um usuario que ja passou pela primeira pergunta (ver
// autoResolvePaymentMethod em router.ts), pra testes sem relacao nenhuma com
// forma de pagamento nao precisarem responder essa pergunta toda hora. Testes
// que testam essa pergunta em si usam um numero proprio, sem passar por seed().
function seed(...numbers: string[]) {
  numbers.forEach((n) => {
    ensureUserSeeded(n);
    allowNumber(n);
    const pix = getOrCreatePaymentMethod(n, "Pix");
    setDefaultPaymentMethod(n, pix.id);
  });
}

// Mesma coisa, mas SEM forma de pagamento padrao -- usado pelos poucos testes
// que testam a propria pergunta "qual foi a forma de pagamento?" (fica
// ambigua de proposito: o usuario comeca com as 4 formas padrao e nenhuma
// definida como principal, ver autoResolvePaymentMethod em router.ts).
function seedNoDefaultPayment(...numbers: string[]) {
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

// Mais de um gasto COMPLETO na mesma mensagem (ex: "gastei 50 no mercado e 30
// de uber") vira uma unica confirmacao em lote, em vez de uma por gasto -- ver
// tryCreateExpenseBatch em router.ts.
test("expense: dois gastos completos na mesma mensagem viram uma unica confirmacao em lote", async (t) => {
  const BE1 = "551100090701";
  seed(BE1);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "compras da semana", date: "2026-01-10" },
    { type: "expense", amount: 30, category: "Transporte", description: "uber", date: "2026-01-10" },
  ]);
  await handleIncomingMessage(evolutionMessage(BE1, "gastei 50 no mercado e 30 de uber"));

  assert.equal(sent.length, 1); // uma so mensagem, nao duas
  assert.match(sent[0].text, /2 gastos registrados/);
  assert.match(sent[0].text, /1\..*50.*Mercado.*compras da semana/);
  assert.match(sent[0].text, /2\..*30.*Transporte.*uber/);
  assert.equal(searchExpenses(BE1, "compras da semana").length, 1);
  assert.equal(searchExpenses(BE1, "uber").length, 1);
});

// Mesmo achado da auditoria, dessa vez no lote: forca o 2o insertExpense do
// lote a falhar e confirma que NENHUM dos gastos do lote sobra gravado.
test("expense: falha no meio da criacao do lote nao deixa gasto nenhum gravado (transacao)", async (t) => {
  const BE9 = "551100090709";
  seed(BE9);
  const { sent, queueReply } = withMocks(t);
  let calls = 0;
  const original = expensesService.insertExpense;
  t.mock.method(expensesService, "insertExpense", (...args: Parameters<typeof original>) => {
    calls++;
    if (calls === 2) throw new Error("falha simulada no banco");
    return original(...args);
  });
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "lote transacao 1", date: "2026-01-10" },
    { type: "expense", amount: 30, category: "Transporte", description: "lote transacao 2", date: "2026-01-10" },
  ]);
  await handleIncomingMessage(evolutionMessage(BE9, "gastei 50 no mercado e 30 de uber"));

  assert.match(sent[0].text, /[Dd]eu erro/);
  assert.equal(searchExpenses(BE9, "lote transacao 1").length, 0);
  assert.equal(searchExpenses(BE9, "lote transacao 2").length, 0);
});

test("expense: lote permite editar so um dos gastos, sem mexer no outro", async (t) => {
  const BE2 = "551100090702";
  seed(BE2);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "mercado lote edit", date: "2026-01-10" },
    { type: "expense", amount: 30, category: "Transporte", description: "uber lote edit", date: "2026-01-10" },
  ]);
  await handleIncomingMessage(evolutionMessage(BE2, "gastei 50 no mercado e 30 de uber"));

  // "o 2" se refere ao segundo item do lote (uber), igual list_expenses
  queueReply([{ type: "edit_expense", list_ref: 2, field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(BE2, "muda o valor do 2 pra 45"));
  await handleIncomingMessage(evolutionMessage(BE2, "sim"));

  const mercado = findRecentExpense(BE2, "mercado lote edit");
  const uber = findRecentExpense(BE2, "uber lote edit");
  assert.equal(mercado?.amount, 50); // nao mudou
  assert.equal(uber?.amount, 45); // so esse mudou
});

test("expense: desfazer o lote remove os dois gastos de uma vez", async (t) => {
  const BE3 = "551100090703";
  seed(BE3);
  const { queueReply } = withMocks(t);
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "mercado lote undo", date: "2026-01-10" },
    { type: "expense", amount: 30, category: "Transporte", description: "uber lote undo", date: "2026-01-10" },
  ]);
  await handleIncomingMessage(evolutionMessage(BE3, "gastei 50 no mercado e 30 de uber"));
  assert.equal(searchExpenses(BE3, "mercado lote undo").length, 1);
  assert.equal(searchExpenses(BE3, "uber lote undo").length, 1);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(BE3, "desfaz isso"));
  assert.equal(searchExpenses(BE3, "mercado lote undo").length, 0);
  assert.equal(searchExpenses(BE3, "uber lote undo").length, 0);
});

test("expense: se um dos gastos do lote nao tem categoria resolvivel, nenhum vira lote -- cada um segue o fluxo normal", async (t) => {
  const BE4 = "551100090704";
  seed(BE4);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "mercado sem lote", date: "2026-01-10" },
    { type: "expense", amount: 30, category: "CategoriaInventadaSemLote", description: "algo sem lote", date: "2026-01-10" },
  ]);
  await handleIncomingMessage(evolutionMessage(BE4, "gastei 50 no mercado e 30 em algo estranho"));

  assert.equal(sent.length, 2); // uma confirmacao pro mercado, uma pergunta de categoria pro outro
  assert.match(sent[0].text, /✅/);
  assert.match(sent[1].text, /[Qq]ual categoria/);
  assert.equal(searchExpenses(BE4, "mercado sem lote").length, 1);
  assert.equal(searchExpenses(BE4, "algo sem lote").length, 0); // ainda pendente
});

// Pedido explicito do usuario: toda compra registrada resolve a forma de
// pagamento -- se ficar ambigua (nem mencionada, nem tem padrao definido, e
// sobra mais de 1 opcao), pergunta ANTES de salvar, combinando na mesma
// mensagem a oferta de deixar como padrao pras proximas vezes.
test("gasto completo com forma de pagamento ambigua: pergunta antes de salvar, combinando com a oferta de virar padrao numa mensagem so", async (t) => {
  const PM1 = "551100090901";
  seedNoDefaultPayment(PM1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 45, category: "Mercado", description: "compras pagamento pendente", date: "2026-01-20" }]);
  await handleIncomingMessage(evolutionMessage(PM1, "45 no mercado"));

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /forma de pagamento/i);
  assert.match(sent[0].text, /padrão/i); // oferta de virar padrao, na MESMA mensagem
  assert.equal(searchExpenses(PM1, "compras pagamento pendente").length, 0); // nao salvou ainda

  await handleIncomingMessage(evolutionMessage(PM1, "Dinheiro"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /✅/);
  // confirmacao sempre com os 5 campos: valor, descricao, categoria, data, forma de pagamento
  assert.match(sent[1].text, /45/);
  assert.match(sent[1].text, /compras pagamento pendente/);
  assert.match(sent[1].text, /Mercado/);
  assert.match(sent[1].text, /20\/01\/2026/);
  assert.match(sent[1].text, /Dinheiro/);

  const expense = findRecentExpense(PM1, "compras pagamento pendente");
  assert.equal(expense?.amount, 45);
  assert.equal(getDefaultPaymentMethod(PM1)?.name, "Dinheiro"); // resposta virou padrao automaticamente
});

test("com forma de pagamento padrao ja definida, usa ela em silencio sem perguntar de novo", async (t) => {
  const PM2 = "551100090902";
  seed(PM2); // seed() ja deixa "Pix" como padrao
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 33, category: "Mercado", description: "compras com padrao", date: "2026-01-20" }]);
  await handleIncomingMessage(evolutionMessage(PM2, "33 no mercado"));

  assert.equal(sent.length, 1); // nenhuma pergunta, direto a confirmacao
  assert.match(sent[0].text, /✅/);
  assert.match(sent[0].text, /Pix/);
});

test("com exatamente 1 forma de pagamento cadastrada (sem padrao definido), usa ela sozinha e ja marca como padrao", async (t) => {
  const PM3 = "551100090903";
  seedNoDefaultPayment(PM3);
  // remove 3 das 4 formas padrao, sobrando so 1 -- deixa de proposito ambiguo
  // ATE sobrar uma unica opcao (ver autoResolvePaymentMethod)
  const methods = listPaymentMethods(PM3);
  for (const m of methods.slice(1)) deletePaymentMethod(PM3, m.id);
  assert.equal(listPaymentMethods(PM3).length, 1);
  assert.equal(getDefaultPaymentMethod(PM3), null);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 18, category: "Mercado", description: "compra com unica forma", date: "2026-01-20" }]);
  await handleIncomingMessage(evolutionMessage(PM3, "18 no mercado"));

  assert.equal(sent.length, 1); // nenhuma pergunta, ja usou a unica forma que tinha
  assert.match(sent[0].text, /✅/);
  const soMethod = methods[0];
  assert.match(sent[0].text, new RegExp(soMethod.name));
  assert.equal(getDefaultPaymentMethod(PM3)?.id, soMethod.id); // ja aproveitou e marcou como padrao
});

test("lote com forma de pagamento ambigua: desiste do lote, pergunta so o primeiro (o segundo fica na fila) e o padrao definido ja resolve o segundo sozinho", async (t) => {
  const PM4 = "551100090904";
  seedNoDefaultPayment(PM4);
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "expense", amount: 50, category: "Mercado", description: "lote pagamento 1", date: "2026-01-20" },
    { type: "expense", amount: 30, category: "Transporte", description: "lote pagamento 2", date: "2026-01-20" },
  ]);
  await handleIncomingMessage(evolutionMessage(PM4, "gastei 50 no mercado e 30 de uber"));

  // nao vira lote (forma de pagamento ambigua pros dois) -- so pergunta o
  // primeiro; o segundo fica esperando na fila, sem perguntar ainda (ver
  // pendingPaymentMethod.ts) pra nao ter 2 perguntas no ar ao mesmo tempo
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /forma de pagamento/i);
  assert.equal(searchExpenses(PM4, "lote pagamento 1").length, 0);
  assert.equal(searchExpenses(PM4, "lote pagamento 2").length, 0);

  await handleIncomingMessage(evolutionMessage(PM4, "Dinheiro"));
  // resolveu o primeiro E, como isso ja definiu "Dinheiro" como padrao, o
  // segundo da fila resolve sozinho tambem -- sem precisar perguntar de novo
  assert.equal(sent.length, 3);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /lote pagamento 1/);
  assert.match(sent[2].text, /✅/);
  assert.match(sent[2].text, /lote pagamento 2/);
  assert.match(sent[2].text, /Dinheiro/);

  assert.equal(searchExpenses(PM4, "lote pagamento 1").length, 1);
  assert.equal(searchExpenses(PM4, "lote pagamento 2").length, 1);
});

// Pedido explicito do usuario: se passar 30s sem resposta a "qual foi a forma
// de pagamento?", considera as informacoes ja exibidas como aceitas -- registra
// o gasto assim mesmo (sem forma de pagamento definida) em vez de deixar a
// pergunta pendente pra sempre.
test("forma de pagamento pendente expira depois de 30s: registra sem definir e avisa, sem travar a mensagem seguinte", async (t) => {
  const PM5 = "551100090905";
  seedNoDefaultPayment(PM5);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 60, category: "Mercado", description: "gasto pagamento expira", date: "2026-01-21" }]);
  await handleIncomingMessage(evolutionMessage(PM5, "60 no mercado"));
  assert.match(sent[0].text, /forma de pagamento/i);
  assert.equal(searchExpenses(PM5, "gasto pagamento expira").length, 0);

  backdatePendingExpensePaymentMethodForTests(PM5, 31 * 1000);

  // mensagem seguinte NAO e resposta de forma de pagamento -- e um gasto novo
  // e completo, que so deveria ser tratado normalmente se a pendencia
  // expirada ja tiver sido resolvida sozinha antes
  queueReply([{ type: "expense", amount: 15, category: "Transporte", description: "uber depois do timeout pagamento", date: "2026-01-21" }]);
  await handleIncomingMessage(evolutionMessage(PM5, "15 de uber"));

  assert.equal(sent.length, 3); // pergunta original, aviso de timeout, e o gasto novo precisa perguntar de novo (ainda ambiguo)
  assert.match(sent[1].text, /⏱️/);
  assert.match(sent[1].text, /gasto pagamento expira/);
  assert.match(sent[1].text, /não definida/);
  assert.match(sent[2].text, /forma de pagamento/i); // o gasto novo tambem fica ambiguo (nenhum padrao foi definido pelo timeout)

  const expirado = findRecentExpense(PM5, "gasto pagamento expira");
  assert.equal(expirado?.amount, 60);
  assert.equal(expirado?.payment_method_id, null);
  assert.equal(getDefaultPaymentMethod(PM5), null); // timeout nao define padrao nenhum
});

test("forma de pagamento pendente ainda DENTRO do prazo continua tratando a resposta normalmente (nao expira cedo demais)", async (t) => {
  const PM6 = "551100090906";
  seedNoDefaultPayment(PM6);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 25, category: "Mercado", description: "gasto pagamento dentro do prazo", date: "2026-01-21" }]);
  await handleIncomingMessage(evolutionMessage(PM6, "25 no mercado"));

  backdatePendingExpensePaymentMethodForTests(PM6, 5 * 1000); // 5s < 30s, nao expirou

  await handleIncomingMessage(evolutionMessage(PM6, "Pix"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /Pix/);
  const expense = findRecentExpense(PM6, "gasto pagamento dentro do prazo");
  assert.equal(expense?.amount, 25);
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

// Regressao da auditoria: sem TTL, uma pendencia de categoria nunca expirava
// -- se o cliente ignorasse "qual categoria e isso?", TODA mensagem futura
// dele (um gasto novo, um "oi", qualquer coisa) seria tratada como resposta
// de categoria pra sempre. Ver PENDING_CATEGORIZATION_TTL_MS em router.ts.
test("categorizacao pendente expira depois de 30s: salva sozinho com a categoria sugerida e avisa, sem travar a mensagem seguinte", async (t) => {
  const T1 = "551100090801";
  seed(T1);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "expense", amount: 40, category: "CategoriaExpirada", description: "gasto que expira", date: "2026-01-14" }]);
  await handleIncomingMessage(evolutionMessage(T1, "40 em algo raro"));
  assert.match(sent[0].text, /[Qq]ual categoria/);

  const pendingBeforeExpiry = getNextPendingCategorization(T1);
  assert.ok(pendingBeforeExpiry, "devia ter uma pendencia na fila");
  backdatePendingCategorizationForTests(pendingBeforeExpiry!.id, 31 * 1000);

  // mensagem seguinte NAO e resposta de categoria -- e um gasto novo e
  // completo, que so deveria ser tratado normalmente se a pendencia expirada
  // ja tiver sido resolvida sozinha antes de olhar essa mensagem
  queueReply([{ type: "expense", amount: 12, category: "Transporte", description: "uber depois do timeout", date: "2026-01-14" }]);
  await handleIncomingMessage(evolutionMessage(T1, "12 de uber"));

  assert.equal(sent.length, 3); // pergunta original, aviso de timeout, confirmacao do gasto novo
  assert.match(sent[1].text, /⏱️/);
  assert.match(sent[1].text, /CategoriaExpirada/);
  assert.match(sent[1].text, /gasto que expira/);
  assert.match(sent[2].text, /✅/);
  assert.match(sent[2].text, /uber depois do timeout/);

  const expirado = findRecentExpense(T1, "gasto que expira");
  assert.equal(expirado?.amount, 40);
  assert.equal(findCategoryByName(T1, "CategoriaExpirada")?.id, expirado?.category_id);

  assert.equal(getNextPendingCategorization(T1), null); // fila limpa, nao ficou travada
});

test("categorizacao pendente expirada sem NENHUMA categoria sugerida cai em 'Outros'", async (t) => {
  const T2 = "551100090802";
  seed(T2);
  const { sent, queueReply } = withMocks(t);

  // sem "category" nenhuma na interpretacao -- caso de gasto sem nenhuma pista
  queueReply([{ type: "expense", amount: 8, description: "gasto sem pista nenhuma", date: "2026-01-14" }]);
  await handleIncomingMessage(evolutionMessage(T2, "8 reais"));
  assert.match(sent[0].text, /[Qq]ual categoria/);

  const pending = getNextPendingCategorization(T2)!;
  backdatePendingCategorizationForTests(pending.id, 31 * 1000);

  queueReply([{ type: "list_categories" }]);
  await handleIncomingMessage(evolutionMessage(T2, "quais categorias eu tenho"));

  const expense = findRecentExpense(T2, "gasto sem pista nenhuma");
  assert.equal(findCategoryByName(T2, "Outros")?.id, expense?.category_id);
});

test("categorizacao pendente ainda DENTRO do prazo continua tratando a resposta normalmente (nao expira cedo demais)", async (t) => {
  const T3 = "551100090803";
  seed(T3);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "expense", amount: 22, category: "CategoriaAindaValida", description: "gasto dentro do prazo", date: "2026-01-14" }]);
  await handleIncomingMessage(evolutionMessage(T3, "22 em algo raro"));

  const pending = getNextPendingCategorization(T3)!;
  backdatePendingCategorizationForTests(pending.id, 5 * 1000); // 5s < 30s, nao expirou

  await handleIncomingMessage(evolutionMessage(T3, "Saúde"));
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Saúde/);
  const expense = findRecentExpense(T3, "gasto dentro do prazo");
  assert.equal(findCategoryByName(T3, "Saúde")?.id, expense?.category_id);
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
  assert.match(sent[1].text, /atualizado: categoria Lazer-correct/);
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

  // RN07: lista expirada -- nao aplica o "1" a nenhuma lista nova; oferece os ultimos gastos
  assert.match(sent[sent.length - 1].text, /Essa lista já expirou/);
  const stillOriginal = findRecentExpense(A, "item vai expirar");
  assert.equal(stillOriginal?.amount, 5); // nao foi editado, a referencia tinha expirado
  await handleIncomingMessage(evolutionMessage(A, "cancelar")); // A e compartilhado: nao deixa a escolha aberta pro proximo teste
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
  const d = nearFutureDateString();
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "event", title: "revisão do carro", date: d }]);
  await handleIncomingMessage(evolutionMessage(EVU1, "quarta feira agendar revisão do carro"));
  assert.match(sent[0].text, /revis[ãa]o do carro/i);
  assert.match(sent[0].text, /hora/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newTime: "10:00" }));
  await handleIncomingMessage(evolutionMessage(EVU1, "10h"));
  const [event] = findUpcomingEvents(EVU1, "revis");
  assert.ok(event);
  assert.equal(event.start, `${d}T10:00:00-03:00`);
  assert.match(sent[1].text, /criado/i);
});

test("unknown (evento parcial): so sabe o titulo -- pergunta dia E hora juntos, preservando o titulo, e cria ao responder os dois", async (t) => {
  const EVU2 = "551100090207";
  seed(EVU2);
  const d = nearFutureDateString();
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "unknown", likely_intent: "event", title: "médico dr gustavo ted" }]);
  await handleIncomingMessage(evolutionMessage(EVU2, "agendar o médico dr gustavo ted"));
  assert.match(sent[0].text, /gustavo ted/i);
  assert.match(sent[0].text, /dia/i);
  assert.match(sent[0].text, /hor[áa]rio/i);

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: d, newTime: "14:00" }));
  await handleIncomingMessage(evolutionMessage(EVU2, "quarta as 14h"));
  const [event] = findUpcomingEvents(EVU2, "gustavo");
  assert.ok(event);
  assert.equal(event.start, `${d}T14:00:00-03:00`);
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

// Regressao real reportada pelo usuario: "somente editar essa forma de
// pagamento para POX" foi engolido como resposta a uma pendencia de gasto
// parcial completamente diferente (valor 50, faltando a descricao),
// virando um gasto fantasma com a frase inteira como descricao. Comando
// EXPLICITO (frase longa com verbo de editar) agora descarta a pendencia e
// cai na classificacao normal, em vez de ser tratado como resposta.
test("comando explicito (editar/mudar...) vence pendencia de gasto parcial, em vez de ser engolido como a descricao que faltava", async (t) => {
  const EXU9 = "551100090960";
  seed(EXU9);
  const cat = getOrCreateCategory(EXU9, "Compras");
  insertExpense({ fromNumber: EXU9, amount: 2000, description: "Telefone novo", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  // deixa pendente "falta a descricao" de um gasto parcial qualquer (nao tem
  // nenhuma relacao com o pedido real que vem a seguir)
  queueReply([{ type: "unknown", likely_intent: "expense", amount: 50, category: "Mercado" }]);
  await handleIncomingMessage(evolutionMessage(EXU9, "gastei 50 reais"));
  assert.match(sent[0].text, /que foi/i);

  // em vez de responder "o que foi", manda um comando EXPLICITO sobre outra coisa
  queueReply([{ type: "edit_expense", query: "Telefone novo", field: "payment_method", value: "pix" }]);
  await handleIncomingMessage(evolutionMessage(EXU9, "somente editar essa forma de pagamento para pix"));

  // NAO criou gasto fantasma de R$50 com a frase inteira como descricao
  assert.equal(findRecentExpense(EXU9, "editar essa forma de pagamento"), null);
  // tratou como pedido de edicao de verdade, pedindo confirmacao
  assert.match(sent[1].text, /[Cc]onfirma/);

  await handleIncomingMessage(evolutionMessage(EXU9, "sim"));
  const pix = getOrCreatePaymentMethod(EXU9, "pix");
  assert.equal(findRecentExpense(EXU9, "Telefone novo")?.payment_method_id, pix.id);

  // a pendencia antiga (gasto parcial de R$50) foi descartada -- uma resposta
  // curta normal nao deveria mais completar ela
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(EXU9, "foi no mercado"));
  assert.equal(findRecentExpense(EXU9, "mercado"), null);
});

test("unknown (fila de completude): duas mensagens incompletas na mesma vez -- pergunta uma de cada vez, na ordem", async (t) => {
  const EVU3 = "551100090204";
  seed(EVU3);
  const d = nearFutureDateString();
  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "unknown", likely_intent: "event", title: "revisão do carro", date: d },
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

  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newDate: addDaysToDateString(d, 1), newTime: "14:00" }));
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

// Achado da auditoria: a insercao das N parcelas rodava fora de transacao --
// se o banco falhasse no meio do loop, algumas parcelas ficavam gravadas e
// outras nao. Forca a 2a chamada de insertExpense a falhar e confirma que
// NENHUMA parcela sobra gravada (tudo ou nada, ver withTransaction em db.ts).
test("compra parcelada: falha no meio da criacao das parcelas nao deixa parcela nenhuma gravada (transacao)", async (t) => {
  const IN9 = "551100090309";
  seed(IN9);
  const { sent, queueReply } = withMocks(t);
  let calls = 0;
  const original = expensesService.insertExpense;
  t.mock.method(expensesService, "insertExpense", (...args: Parameters<typeof original>) => {
    calls++;
    if (calls === 2) throw new Error("falha simulada no banco");
    return original(...args);
  });
  queueReply([{ type: "installment_expense", description: "Notebook", category: "Compras", total_amount: 900, installments: 3 }]);
  await handleIncomingMessage(evolutionMessage(IN9, "comprei um notebook de 900 parcelado em 3x"));

  assert.match(sent[0].text, /[Dd]eu erro/);
  assert.equal(searchExpenses(IN9, "Notebook").length, 0); // nenhuma parcela sobrou gravada
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

// A leitura de uma foto de comprovante/nota fiscal traz valor total, data,
// local e uma UNICA categoria (inferida pelo estabelecimento/tipo geral dos
// itens, nunca item por item -- ver interpretReceiptImage/READ_RECEIPT_TOOL em
// src/ai/interpret.ts) -- forma de pagamento e parcelamento nunca vem da foto.
// Categoria/forma de pagamento sao perguntadas por texto so quando faltarem.
test("imagem de comprovante: categoria identificada pela foto pula a pergunta de categoria, so falta forma de pagamento", async (t) => {
  const RC1 = "551100090401";
  seedNoDefaultPayment(RC1);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Posto Ipiranga",
    date: "2026-09-01",
    totalAmount: 150,
    category: "Veículo",
  }));
  await handleIncomingMessage(evolutionImageMessage(RC1));
  assert.match(sent[0].text, /forma de pagamento/i);
  assert.equal(searchExpenses(RC1, "Posto Ipiranga").length, 0);

  await handleIncomingMessage(evolutionMessage(RC1, "Pix"));
  assert.match(sent[1].text, /Li assim/);
  assert.match(sent[1].text, /150/);
  assert.match(sent[1].text, /Veículo/);

  await handleIncomingMessage(evolutionMessage(RC1, "sim"));
  const items = searchExpenses(RC1, "Posto Ipiranga");
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 150);
  assert.match(sent[2].text, /✅/);
});

test("imagem de comprovante: IA nao identificou categoria nenhuma -- pergunta antes de confirmar", async (t) => {
  const RC1B = "551100090400";
  seedNoDefaultPayment(RC1B);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Estabelecimento Genérico",
    date: "2026-09-01",
    totalAmount: 42,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC1B));
  assert.match(sent[0].text, /[Cc]ategoria/);

  await handleIncomingMessage(evolutionMessage(RC1B, "Compras"));
  assert.match(sent[1].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(RC1B, "Pix"));
  await handleIncomingMessage(evolutionMessage(RC1B, "sim"));
  assert.equal(searchExpenses(RC1B, "Estabelecimento Genérico").length, 1);
});

test("imagem de comprovante: local com palavra-chave de categoria ja aprendida pula a pergunta de categoria", async (t) => {
  const RC2 = "551100090402";
  seedNoDefaultPayment(RC2);
  const category = getOrCreateCategory(RC2, "Compras");
  learnKeyword(RC2, "loja xpto", category.id);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Loja XPTO Bem Estranha",
    date: "2026-09-01",
    totalAmount: 80,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC2));
  assert.match(sent[0].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(RC2, "Débito"));
  assert.match(sent[1].text, /Li assim/);
  assert.match(sent[1].text, /Compras/);

  await handleIncomingMessage(evolutionMessage(RC2, "sim"));
  assert.equal(searchExpenses(RC2, "Loja XPTO Bem Estranha").length, 1);
});

test("imagem de comprovante: responder 'não sei' na forma de pagamento segue sem definir", async (t) => {
  const RC3 = "551100090403";
  seedNoDefaultPayment(RC3);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Restaurante do Zé",
    date: "2026-09-01",
    totalAmount: 60,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC3));
  await handleIncomingMessage(evolutionMessage(RC3, "Mercado"));
  assert.match(sent[1].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(RC3, "não sei"));
  assert.match(sent[2].text, /Li assim/);

  await handleIncomingMessage(evolutionMessage(RC3, "sim"));
  assert.equal(searchExpenses(RC3, "Restaurante do Zé").length, 1);
});

test("imagem de comprovante: responder 'nao' cancela sem registrar nada", async (t) => {
  const RC4 = "551100090404";
  seedNoDefaultPayment(RC4);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Farmacia Central",
    date: "2026-09-01",
    totalAmount: 35.9,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC4));
  await handleIncomingMessage(evolutionMessage(RC4, "Saúde"));
  await handleIncomingMessage(evolutionMessage(RC4, "Dinheiro"));
  await handleIncomingMessage(evolutionMessage(RC4, "não"));
  assert.match(sent[3].text, /não registrei nada/i);
  assert.equal(searchExpenses(RC4, "Farmacia Central").length, 0);
});

test("imagem de comprovante: correcao em texto livre antes de confirmar ajusta o valor lido", async (t) => {
  const RC5 = "551100090405";
  seedNoDefaultPayment(RC5);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Supermercado Extra",
    date: "2026-09-01",
    totalAmount: 100,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC5));
  await handleIncomingMessage(evolutionMessage(RC5, "Mercado"));
  await handleIncomingMessage(evolutionMessage(RC5, "Pix"));

  t.mock.method(aiInterpret, "extractReceiptCorrectionFromAnswer", async () => ({ amount: 120 }));
  await handleIncomingMessage(evolutionMessage(RC5, "na verdade foi 120"));
  assert.match(sent[3].text, /120/);

  await handleIncomingMessage(evolutionMessage(RC5, "sim"));
  const items = searchExpenses(RC5, "Supermercado Extra");
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 120);
});

// Regressao: um cliente relatou que o bot tentou "interpretar os gastos" de
// uma nota fiscal (varios itens/valores na mesma imagem) em vez de tratar
// como um unico gasto -- causa raiz era o campo de parcelamento lido da
// imagem, removido de proposito (ver comentario em READ_RECEIPT_TOOL).
// Confirma que uma foto NUNCA cria mais de um gasto, so o valor total.
test("imagem de comprovante: nunca cria mais de um gasto a partir de uma foto (so o valor total)", async (t) => {
  const RC6 = "551100090406";
  seedNoDefaultPayment(RC6);
  withMocks(t);
  t.mock.method(aiInterpret, "interpretReceiptImage", async () => ({
    isReceipt: true,
    description: "Loja de Eletronicos",
    date: "2026-09-01",
    totalAmount: 600,
  }));
  await handleIncomingMessage(evolutionImageMessage(RC6));
  await handleIncomingMessage(evolutionMessage(RC6, "Compras"));
  await handleIncomingMessage(evolutionMessage(RC6, "Cartão de crédito"));
  await handleIncomingMessage(evolutionMessage(RC6, "sim"));
  const items = searchExpenses(RC6, "Loja de Eletronicos");
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 600);
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

// Mesma classe de bug da imagem (achado da auditoria): erro na transcricao de
// audio (Groq fora do ar, por exemplo) nao pode sumir em silencio total --
// tinha SO um console.error generico no webhook.ts, sem log no /admin nem
// resposta pro cliente.
test("audio: erro na transcricao responde algo pro usuario, nao fica em silencio", async (t) => {
  const AU1 = "551100090501";
  seed(AU1);
  const { sent } = withMocks(t);
  t.mock.method(aiTranscribe, "transcribeAudio", async () => {
    throw new Error("falha simulada na transcricao");
  });
  await handleIncomingMessage(evolutionAudioMessage(AU1));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /[Dd]eu erro/);
  assert.ok(getRecentActivity(20).find((a) => a.from_number === AU1 && a.type === "error"));
});

// Mesma classe de bug, dessa vez na classificacao do texto em si (Anthropic
// fora do ar): antes tambem sumia em silencio, so com console.error.
test("texto: erro ao interpretar a mensagem responde algo pro usuario, nao fica em silencio", async (t) => {
  const TX1 = "551100090502";
  seed(TX1);
  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "interpretText", async () => {
    throw new Error("falha simulada na classificacao");
  });
  await handleIncomingMessage(evolutionMessage(TX1, "50 no mercado"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /[Dd]eu erro/);
  assert.ok(getRecentActivity(20).find((a) => a.from_number === TX1 && a.type === "error"));
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

  // usuario novo, sem forma de pagamento padrao ainda: alem das boas-vindas,
  // a primeira compra tambem pergunta a forma de pagamento (ver
  // autoResolvePaymentMethod) antes de confirmar
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /assistente pessoal/i);
  assert.ok(sent[0].text.includes("https://marcusvnv.com.br/dashboard")); // link do painel junto das boas-vindas
  assert.match(sent[1].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(NEW_NUMBER, "Pix"));
  assert.equal(sent.length, 3);
  assert.match(sent[2].text, /✅/); // a confirmacao normal do gasto acontece so depois de resolvida a forma de pagamento

  queueReply([{ type: "expense", amount: 30, category: "Mercado", description: "segunda compra", date: "2026-01-15" }]);
  await handleIncomingMessage(evolutionMessage(NEW_NUMBER, "30 no mercado"));
  assert.equal(sent.length, 4); // nao mandou boas-vindas nem pergunta de pagamento de novo (Pix ja e o padrao), so a confirmacao
  assert.match(sent[3].text, /✅/);
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

// Alerta de conta fixa: diferente de gasto fixo, NUNCA lanca um gasto sozinho --
// so pergunta "ja pagou?" todo mes no dia configurado (ver bills/scheduler.ts).
test("set_bill_alert: cadastra o alerta e confirma com o dia do mes", async (t) => {
  const BA1 = "551100090301";
  seed(BA1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Conta de água", day_of_month: 5 }]);
  await handleIncomingMessage(evolutionMessage(BA1, "me lembra de pagar a conta de água todo dia 5"));

  assert.match(sent[0].text, /📌/);
  assert.match(sent[0].text, /dia 5/);
  const bills = listBillAlerts(BA1);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].name, "Conta de água");
  assert.equal(bills[0].day_of_month, 5);
});

test("set_bill_alert: dia do mes invalido nao cadastra nada", async (t) => {
  const BA2 = "551100090302";
  seed(BA2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Conta esquisita", day_of_month: 32 }]);
  await handleIncomingMessage(evolutionMessage(BA2, "me lembra da conta esquisita todo dia 32"));

  assert.match(sent[0].text, /entre 1 e 31/);
  assert.equal(listBillAlerts(BA2).length, 0);
});

// Recorrencia por INTERVALO (ex: "comprar ração a cada 45 dias"), alternativa
// ao dia fixo do mes -- mesma pergunta "ja fez?", mas contando em dias corridos
// a partir de hoje em vez de um dia de calendario.
test("set_bill_alert: intervalo em dias (\"a cada N dias\") cadastra o alerta", async (t) => {
  const BA11 = "551100090311";
  seed(BA11);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Ração do cachorro", interval_days: 45 }]);
  await handleIncomingMessage(evolutionMessage(BA11, "me lembra de comprar ração a cada 45 dias"));

  assert.match(sent[0].text, /a cada 45 dias/);
  const bills = listBillAlerts(BA11);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].recurrence_type, "interval");
  assert.equal(bills[0].interval_days, 45);
});

test("set_bill_alert: sem dia do mes e sem intervalo pede pra esclarecer a recorrencia", async (t) => {
  const BA12 = "551100090312";
  seed(BA12);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Alguma coisa vaga" }]);
  await handleIncomingMessage(evolutionMessage(BA12, "me lembra de fazer alguma coisa"));

  assert.match(sent[0].text, /recorrência/i);
  assert.equal(listBillAlerts(BA12).length, 0);
});

test("bill checkin: alerta por intervalo confirmado avisa 'daqui a N dias', nao 'mes que vem'", async (t) => {
  const BA13 = "551100090313";
  seed(BA13);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Ração checkin", interval_days: 45 }]);
  await handleIncomingMessage(evolutionMessage(BA13, "me lembra de comprar ração a cada 45 dias"));
  const bill = listBillAlerts(BA13)[0];

  setPendingBillCheckin(BA13, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });
  await handleIncomingMessage(evolutionMessage(BA13, "já comprei"));
  assert.match(sent[1].text, /daqui a 45 dias/);

  const updated = getBillAlertById(BA13, bill.id)!;
  assert.equal(updated.confirmed_month, null); // alerta por intervalo nunca usa confirmed_month
  // confirmado no mesmo dia em que foi criado (teste roda tudo "hoje"): o novo
  // vencimento e hoje+45 de novo, igual foi na criacao -- o que importa aqui e
  // que reconta a partir de HOJE (a confirmacao), nao que fique estritamente
  // maior que o valor anterior.
  assert.equal(updated.next_due_date, addDaysToDateString(spDateString(), 45));
});

test("list_bill_alerts: lista os alertas cadastrados, isolado por numero", async (t) => {
  const BA3 = "551100090303";
  const BA4 = "551100090304";
  seed(BA3, BA4);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "set_bill_alert", description: "Conta de luz", day_of_month: 10 }]);
  await handleIncomingMessage(evolutionMessage(BA3, "cadastra um alerta da luz todo dia 10"));

  queueReply([{ type: "list_bill_alerts" }]);
  await handleIncomingMessage(evolutionMessage(BA4, "quais alertas de conta eu tenho"));
  assert.match(sent[1].text, /ainda não tem nenhum alerta/i);

  queueReply([{ type: "list_bill_alerts" }]);
  await handleIncomingMessage(evolutionMessage(BA3, "quais alertas de conta eu tenho"));
  assert.match(sent[2].text, /Conta de luz/);
});

test("remove_bill_alert: desativa o alerta encontrado por texto", async (t) => {
  const BA5 = "551100090305";
  seed(BA5);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Internet fixa", day_of_month: 20 }]);
  await handleIncomingMessage(evolutionMessage(BA5, "me lembra da internet fixa todo dia 20"));

  queueReply([{ type: "remove_bill_alert", query: "internet" }]);
  await handleIncomingMessage(evolutionMessage(BA5, "cancela o alerta da internet"));
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(listBillAlerts(BA5).length, 1); // ainda nao removido, so perguntou

  await handleIncomingMessage(evolutionMessage(BA5, "sim"));
  assert.match(sent[2].text, /removido/);
  assert.equal(listBillAlerts(BA5).length, 0);
});

test("remove_bill_alert: responder 'nao' mantem o alerta ativo", async (t) => {
  const BA6 = "551100090306";
  seed(BA6);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Gás encanado", day_of_month: 8 }]);
  await handleIncomingMessage(evolutionMessage(BA6, "me lembra do gás encanado todo dia 8"));

  queueReply([{ type: "remove_bill_alert", query: "gás" }]);
  await handleIncomingMessage(evolutionMessage(BA6, "cancela o alerta do gás"));
  await handleIncomingMessage(evolutionMessage(BA6, "não, deixa"));
  assert.match(sent[2].text, /não mexi/i);
  assert.equal(listBillAlerts(BA6).length, 1);
});

test("remove_bill_alert: undo recria o alerta removido", async (t) => {
  const BA7 = "551100090307";
  seed(BA7);
  const { queueReply } = withMocks(t);
  queueReply([{ type: "set_bill_alert", description: "Condomínio undo", day_of_month: 12 }]);
  await handleIncomingMessage(evolutionMessage(BA7, "me lembra do condomínio undo todo dia 12"));

  queueReply([{ type: "remove_bill_alert", query: "condomínio undo" }]);
  await handleIncomingMessage(evolutionMessage(BA7, "cancela o alerta do condomínio undo"));
  await handleIncomingMessage(evolutionMessage(BA7, "sim"));
  assert.equal(listBillAlerts(BA7).length, 0);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(BA7, "desfaz isso"));
  const restored = listBillAlerts(BA7);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, "Condomínio undo");
  assert.equal(restored[0].day_of_month, 12);
});

// A pergunta mensal em si (disparada pelo scheduler) e simulada aqui direto via
// setPendingBillCheckin, sem precisar esperar o cron -- o scheduler so decide
// QUANDO perguntar (getDueBillAlerts, coberto nos testes de src/bills/service),
// a resposta do usuario e sempre tratada pelo router (resolveBillCheckinAnswer).
test("bill checkin: responder que ja pagou fecha o ciclo do mes, sem lancar gasto nenhum", async (t) => {
  const BA8 = "551100090308";
  seed(BA8);
  const { sent } = withMocks(t);
  const bill = createBillAlert({ fromNumber: BA8, name: "Conta de água checkin", dayOfMonth: 5 });
  setPendingBillCheckin(BA8, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });

  await handleIncomingMessage(evolutionMessage(BA8, "já paguei"));
  assert.match(sent[0].text, /mês que vem/i);
  const updated = getBillAlertById(BA8, bill.id)!;
  assert.equal(updated.confirmed_month, today().slice(0, 7));
  assert.equal(updated.snoozed_until, null);
});

test("bill checkin: responder 'amanha' adia a pergunta pro dia seguinte", async (t) => {
  const BA9 = "551100090309";
  seed(BA9);
  const { sent } = withMocks(t);
  const bill = createBillAlert({ fromNumber: BA9, name: "Conta de luz checkin", dayOfMonth: 10 });
  setPendingBillCheckin(BA9, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });

  await handleIncomingMessage(evolutionMessage(BA9, "ainda não, lembra amanhã"));
  assert.match(sent[0].text, /amanhã/i);
  const updated = getBillAlertById(BA9, bill.id)!;
  assert.equal(updated.confirmed_month, null);
  assert.ok(updated.snoozed_until);
});

test("bill checkin: resposta nao reconhecida pergunta de novo, sem mudar nada", async (t) => {
  const BA10 = "551100090310";
  seed(BA10);
  const { sent } = withMocks(t);
  const bill = createBillAlert({ fromNumber: BA10, name: "Conta confusa", dayOfMonth: 15 });
  setPendingBillCheckin(BA10, { billAlertId: bill.id, name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days });

  await handleIncomingMessage(evolutionMessage(BA10, "sei lá, talvez"));
  assert.match(sent[0].text, /[Nn]ão entendi/);
  const updated = getBillAlertById(BA10, bill.id)!;
  assert.equal(updated.confirmed_month, null);
  assert.equal(updated.snoozed_until, null);
});

test("set_report_day: dia especifico ativa o relatorio semanal nesse dia", async (t) => {
  const SR1 = "551100090501";
  seed(SR1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_report_day", day_of_week: "sexta" }]);
  await handleIncomingMessage(evolutionMessage(SR1, "quero receber o relatório toda sexta"));
  assert.match(sent[0].text, /sexta/);
  const sub = getReportSubscribers().find((s) => s.from_number === SR1);
  assert.equal(sub?.report_day_of_week, 5);
});

// Regressao: relatado pelo usuario -- o relatorio semanal simplesmente nunca
// chegava. Causa: um pedido generico sem citar um dia especifico (ex: "ativa
// o relatorio semanal") classificava certo como set_report_day, mas SEM
// 'day_of_week' preenchido -- o codigo respondia "nao entendi o dia" e
// desistia, nunca chamando setReportDayOfWeek nem pedindo o dia de novo.
// Confirmado contra a API real que a IA de fato omite 'day_of_week' nesse
// caso. Agora um pedido generico ativa com segunda-feira como padrao.
test("set_report_day: pedido generico sem citar o dia usa sexta como padrao, em vez de nao ativar nada", async (t) => {
  const SR2 = "551100090502";
  seed(SR2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_report_day" }]);
  await handleIncomingMessage(evolutionMessage(SR2, "ativa o relatório semanal"));
  assert.match(sent[0].text, /sexta/i);
  assert.doesNotMatch(sent[0].text, /[Nn]ão entendi/);
  const sub = getReportSubscribers().find((s) => s.from_number === SR2);
  assert.equal(sub?.report_day_of_week, 5);
});

test("set_no_expense_reminder: desativa o aviso de gasto pendente", async (t) => {
  const NE1 = "551100090601";
  seed(NE1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_no_expense_reminder", enabled: false }]);
  await handleIncomingMessage(evolutionMessage(NE1, "desativa o aviso de gasto pendente"));
  assert.match(sent[0].text, /não vou mais te avisar/i);
  assert.equal(getNoExpenseReminderSettings(NE1).enabled, false);
});

test("set_no_expense_reminder: mudar o horario ja reativa o aviso sozinho, mesmo sem pedir enabled=true", async (t) => {
  const NE2 = "551100090602";
  seed(NE2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_no_expense_reminder", enabled: false }]);
  await handleIncomingMessage(evolutionMessage(NE2, "desativa o aviso de gasto pendente"));
  assert.equal(getNoExpenseReminderSettings(NE2).enabled, false);

  queueReply([{ type: "set_no_expense_reminder", time: "20:00" }]);
  await handleIncomingMessage(evolutionMessage(NE2, "muda o horario do aviso pra 20h"));
  assert.match(sent[sent.length - 1].text, /20:00/);
  const settings = getNoExpenseReminderSettings(NE2);
  assert.equal(settings.enabled, true);
  assert.equal(settings.time, "20:00");
});

test("set_no_expense_reminder: horario invalido pede pra tentar de novo, sem mudar nada", async (t) => {
  const NE3 = "551100090603";
  seed(NE3);
  const before = getNoExpenseReminderSettings(NE3);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_no_expense_reminder", time: "25:99" }]);
  await handleIncomingMessage(evolutionMessage(NE3, "muda o aviso pra 25:99"));
  assert.match(sent[0].text, /[Nn]ão entendi o horário/);
  assert.deepEqual(getNoExpenseReminderSettings(NE3), before);
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

  // Regressao: relatado em producao -- numero preso em cooldown por engano
  // parecia bug silencioso, sem NENHUM rastro no /admin de que a mensagem
  // tinha sido recebida e ignorada por causa do rate limit.
  const loggedDuringCooldown = getRecentActivity(200).find(
    (entry) => entry.from_number === RL && entry.type === "rate_limited" && entry.summary.includes("cooldown")
  );
  assert.ok(loggedDuringCooldown, "mensagem ignorada durante o cooldown devia deixar rastro no /admin");
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
  const d = nearFutureDateString();
  const { queueReply } = withMocks(t);
  // 15h sem "-03:00" no final, exatamente como o bug relatado
  queueReply([{ type: "event", title: "atender Carol", start: `${d}T15:00:00` }]);
  await handleIncomingMessage(evolutionMessage(TZ1, "atender carol as quinze horas"));

  const matches = findUpcomingEvents(TZ1, "atender Carol");
  assert.equal(matches.length, 1);
  // 15h em Brasilia = 18h UTC, nao importa o fuso da maquina rodando o teste
  assert.equal(new Date(matches[0].start).toISOString(), `${d}T18:00:00.000Z`);
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
  assert.match(sent[1].text, /46,50/); // previa nova, ja no formato brasileiro (R$ 46,50)
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.equal(findRecentExpense(EE1, "gasto edit confirm")?.amount, 40); // continua sem confirmar

  await handleIncomingMessage(evolutionMessage(EE1, "sim"));
  assert.equal(findRecentExpense(EE1, "gasto edit confirm")?.amount, 46.5);
});

// Regressao: usuario reportou que pedir pra mudar o NOME/descricao de um
// gasto nao funcionava. O codigo em si sempre suportou field="description"
// (parseEditFieldValue), o problema era a IA nunca classificar esse pedido
// como edit_expense com esse campo por falta de exemplo no prompt (corrigido
// em interpret.ts). Esse teste garante que, uma vez classificado certo, o
// fluxo completo (pergunta -> confirma -> aplica) funciona igual aos outros campos.
test("edit_expense: editar a descricao/nome de um gasto (bug reportado -- so faltava a IA reconhecer o pedido)", async (t) => {
  const EED = "551100090870";
  seed(EED);
  const cat = getOrCreateCategory(EED, "Edit-nome");
  insertExpense({ fromNumber: EED, amount: 40, description: "Mercado", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Mercado", field: "description", value: "Feira" }]);
  await handleIncomingMessage(evolutionMessage(EED, "muda o nome do gasto do mercado pra Feira"));
  assert.match(sent[0].text, /Feira/);
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(findRecentExpense(EED, "Mercado")?.description, "Mercado"); // ainda nao mudou

  await handleIncomingMessage(evolutionMessage(EED, "sim"));
  assert.equal(findRecentExpense(EED, "Feira")?.description, "Feira");
  assert.equal(findRecentExpense(EED, "Feira")?.amount, 40); // resto do gasto preservado
});

// Card 3 (RN05): valor absurdo e recusado ANTES da previa -- nao chega a pedir
// confirmacao nem a gravar nada (antes o erro so aparecia depois do "sim").
test("edit_expense: valor absurdamente alto e recusado antes da confirmacao, sem mexer no gasto", async (t) => {
  const EEV = "551100090097";
  seed(EEV);
  const cat = getOrCreateCategory(EEV, "Edit-valor-absurdo");
  insertExpense({ fromNumber: EEV, amount: 40, description: "gasto edit absurdo", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "gasto edit absurdo", changes: [{ field: "amount", value: "2000000" }] }]);
  await handleIncomingMessage(evolutionMessage(EEV, "muda o gasto edit absurdo pra 2000000"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /muito alto \(limite R\$ 1\.000\.000,00\)/);
  assert.equal(findRecentExpense(EEV, "gasto edit absurdo")?.amount, 40); // nao mudou

  // e nao ficou nada pendente: o "sim" seguinte nao confirma coisa nenhuma
  queueReply([{ type: "unknown" }]);
  await handleIncomingMessage(evolutionMessage(EEV, "sim"));
  assert.equal(findRecentExpense(EEV, "gasto edit absurdo")?.amount, 40);
});

// Pedido do usuario: excluir categoria pelo WhatsApp (nao existia), com
// confirmacao antes, gastos ficando sem categoria e desfaz recriando ela.
test("delete_category: pede confirmacao, so apaga com sim, gastos ficam sem categoria e desfaz restaura", async (t) => {
  const DC1 = "551100090801";
  seed(DC1);
  const cat = getOrCreateCategory(DC1, "Categoria a apagar");
  insertExpense({ fromNumber: DC1, amount: 20, description: "gasto da cat apagar", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_category", category: "Categoria a apagar" }]);
  await handleIncomingMessage(evolutionMessage(DC1, "exclui a categoria Categoria a apagar"));
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.ok(findCategoryByName(DC1, "Categoria a apagar")); // ainda existe, so perguntou

  await handleIncomingMessage(evolutionMessage(DC1, "sim"));
  assert.match(sent[1].text, /apagada/);
  assert.equal(findCategoryByName(DC1, "Categoria a apagar"), null);
  assert.equal(findRecentExpense(DC1, "gasto da cat apagar")?.category_id, null); // gasto nao foi apagado

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(DC1, "desfaz isso"));
  const restored = findCategoryByName(DC1, "Categoria a apagar");
  assert.ok(restored);
  assert.equal(findRecentExpense(DC1, "gasto da cat apagar")?.category_id, restored!.id);
});

test("delete_category: responder nao cancela, e categoria inexistente avisa", async (t) => {
  const DC2 = "551100090802";
  seed(DC2);
  getOrCreateCategory(DC2, "Fica intacta");
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_category", category: "Fica intacta" }]);
  await handleIncomingMessage(evolutionMessage(DC2, "apaga a categoria Fica intacta"));
  await handleIncomingMessage(evolutionMessage(DC2, "nao"));
  assert.match(sent[1].text, /não mexi/);
  assert.ok(findCategoryByName(DC2, "Fica intacta"));

  queueReply([{ type: "delete_category", category: "CategoriaQueNaoExisteXYZ" }]);
  await handleIncomingMessage(evolutionMessage(DC2, "apaga a categoria CategoriaQueNaoExisteXYZ"));
  assert.match(sent[2].text, /Não achei/);
});

// Achado da auditoria: renameCategory ja existia (so usado pelo dashboard) --
// nao tinha NENHUM jeito de renomear categoria pelo WhatsApp. Aplica na hora,
// sem confirmacao (mesmo padrao de edit_bill_alert: risco baixo, reversivel
// so renomeando de volta), e preserva os gastos ja vinculados.
test("rename_category: renomeia na hora (sem confirmacao), preserva os gastos vinculados, e categoria inexistente avisa", async (t) => {
  const RC1 = "551100090880";
  seed(RC1);
  const cat = getOrCreateCategory(RC1, "Mercado renomear");
  insertExpense({ fromNumber: RC1, amount: 30, description: "compra do mes", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "rename_category", category: "Mercado renomear", new_name: "Supermercado" }]);
  await handleIncomingMessage(evolutionMessage(RC1, "renomeia a categoria Mercado renomear pra Supermercado"));
  assert.match(sent[0].text, /Supermercado/);
  assert.equal(findCategoryByName(RC1, "Mercado renomear"), null);
  assert.ok(findCategoryByName(RC1, "Supermercado"));
  assert.equal(findRecentExpense(RC1, "compra do mes")?.category_id, cat.id); // gasto continua vinculado (mesmo id)

  queueReply([{ type: "rename_category", category: "NaoExisteXYZ", new_name: "Qualquer" }]);
  await handleIncomingMessage(evolutionMessage(RC1, "renomeia a categoria NaoExisteXYZ pra Qualquer"));
  assert.match(sent[1].text, /Não achei/);
});

test("rename_payment_method: renomeia na hora (sem confirmacao), e forma de pagamento inexistente avisa", async (t) => {
  const RC2 = "551100090881";
  seed(RC2);
  getOrCreatePaymentMethod(RC2, "Nubank");

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "rename_payment_method", payment_method: "Nubank", new_name: "Cartão Roxo" }]);
  await handleIncomingMessage(evolutionMessage(RC2, "renomeia o cartao nubank pra Cartão Roxo"));
  assert.match(sent[0].text, /Cartão Roxo/);
  assert.equal(findPaymentMethodByName(RC2, "Nubank"), null);
  assert.ok(findPaymentMethodByName(RC2, "Cartão Roxo"));

  queueReply([{ type: "rename_payment_method", payment_method: "NaoExisteXYZ", new_name: "Qualquer" }]);
  await handleIncomingMessage(evolutionMessage(RC2, "renomeia a forma de pagamento NaoExisteXYZ pra Qualquer"));
  assert.match(sent[1].text, /Não achei/);
});

// Pedido do usuario: gasto de R$0 dava a mensagem generica de erro; agora
// explica que o valor precisa ser maior que zero, ANTES de perguntar categoria.
test("gasto com valor zero ou negativo responde o motivo (valor precisa ser maior que zero) e nao registra", async (t) => {
  const ZV = "551100090803";
  seed(ZV);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 0, category: "Mercado", description: "compra de valor zero", date: today() }]);
  await handleIncomingMessage(evolutionMessage(ZV, "gastei 0 no mercado"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /maior que R[$] 0,00/);
  assert.doesNotMatch(sent[0].text, /Deu erro/);
  assert.equal(searchExpenses(ZV, "compra de valor zero").length, 0);

  queueReply([{ type: "expense", amount: -5, category: "CategoriaNovaValorNegativo", description: "compra negativa", date: today() }]);
  await handleIncomingMessage(evolutionMessage(ZV, "gastei -5"));
  assert.match(sent[1].text, /maior que R[$] 0,00/); // nem chega a perguntar categoria
});

// Pedido do usuario: "gastos de segunda a quinta, detalhado" e em seguida
// "qual o total?" -- o intervalo de dias nao era entendido e o total da lista
// mostrada nao existia. Agora lista o intervalo (com total) e responde a soma.
test("list_expenses com intervalo de dias mostra detalhado com total, e 'qual o total' soma a lista mostrada", async (t) => {
  const LT = "551100090810";
  seed(LT);
  const cat = getOrCreateCategory(LT, "Lista-total");
  const d1 = addDaysToDateString(today(), -6);
  const d2 = addDaysToDateString(today(), -5);
  const fora = addDaysToDateString(today(), -1);
  insertExpense({ fromNumber: LT, amount: 10, description: "intervalo um", categoryId: cat.id, paymentMethodId: null, date: d1 });
  insertExpense({ fromNumber: LT, amount: 32.5, description: "intervalo dois", categoryId: cat.id, paymentMethodId: null, date: d2 });
  insertExpense({ fromNumber: LT, amount: 999, description: "fora do intervalo", categoryId: cat.id, paymentMethodId: null, date: fora });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "list_expenses", date_start: d1, date_end: d2 }]);
  await handleIncomingMessage(evolutionMessage(LT, "gastos de segunda a quinta detalhado"));
  assert.equal(sent.length, 1); // direto detalhado, sem perguntar "resumo ou detalhado"
  assert.match(sent[0].text, /intervalo um/);
  assert.match(sent[0].text, /intervalo dois/);
  assert.doesNotMatch(sent[0].text, /fora do intervalo/);
  assert.match(sent[0].text, /Total: R[$]42.50/);

  queueReply([{ type: "total_last_list" }]);
  await handleIncomingMessage(evolutionMessage(LT, "qual o total?"));
  assert.match(sent[1].text, /R[$]42.50/);
  assert.match(sent[1].text, /2 gasto/);
});

test("total_last_list sem nenhuma lista recente orienta em vez de inventar um valor", async (t) => {
  const LT2 = "551100090811";
  seed(LT2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "total_last_list" }]);
  await handleIncomingMessage(evolutionMessage(LT2, "qual o total?"));
  assert.match(sent[0].text, /lista de gastos recente/);
});

// Pedido do usuario: editar alerta de conta fixa tambem pelo WhatsApp.
test("edit_bill_alert: muda dia do mes, troca pra intervalo e renomeia; alerta inexistente avisa", async (t) => {
  const EB = "551100090820";
  seed(EB);
  const bill = createBillAlert({ fromNumber: EB, name: "Agua editar wpp", dayOfMonth: 5 });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "edit_bill_alert", query: "agua editar", day_of_month: 8 }]);
  await handleIncomingMessage(evolutionMessage(EB, "muda o alerta da agua pro dia 8"));
  assert.match(sent[0].text, /todo dia 8/);
  assert.equal(getBillAlertById(EB, bill.id)!.day_of_month, 8);

  queueReply([{ type: "edit_bill_alert", query: "agua editar", interval_days: 30, new_name: "Agua a cada 30" }]);
  await handleIncomingMessage(evolutionMessage(EB, "o alerta da agua agora e a cada 30 dias e renomeia"));
  const updated = getBillAlertById(EB, bill.id)!;
  assert.equal(updated.recurrence_type, "interval");
  assert.equal(updated.interval_days, 30);
  assert.equal(updated.name, "Agua a cada 30");

  queueReply([{ type: "edit_bill_alert", query: "alerta que nao existe zzz", day_of_month: 3 }]);
  await handleIncomingMessage(evolutionMessage(EB, "muda o alerta zzz pro dia 3"));
  assert.match(sent[2].text, /Não achei/);

  queueReply([{ type: "edit_bill_alert", query: "Agua a cada 30", day_of_month: 40 }]);
  await handleIncomingMessage(evolutionMessage(EB, "muda pro dia 40"));
  assert.match(sent[3].text, /1 a 31/);
});

test("balance: cartao nao abate do saldo, so mostra o gasto no cartao e o limite disponivel quando informado", async (t) => {
  const BL = "551100090830";
  seed(BL);
  const pix = getOrCreatePaymentMethod(BL, "Pix");
  const card = getOrCreatePaymentMethod(BL, "Cartão teste saldo");
  insertIncome({ fromNumber: BL, amount: 1000, description: "entrada saldo", date: today() });
  insertExpense({ fromNumber: BL, amount: 100, description: "pix saldo", categoryId: null, paymentMethodId: pix.id, date: today() });
  insertExpense({ fromNumber: BL, amount: 300, description: "cartao saldo", categoryId: null, paymentMethodId: card.id, date: today() });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "balance", period: "month" }]);
  await handleIncomingMessage(evolutionMessage(BL, "qual meu saldo"));
  assert.match(sent[0].text, /Saldo: R[$]900\.00/);
  assert.match(sent[0].text, /No cartão: R[$]300\.00/);
  assert.doesNotMatch(sent[0].text, /limite disponível/);

  setPaymentMethodLimit(BL, card.id, 1000);
  queueReply([{ type: "balance", period: "month" }]);
  await handleIncomingMessage(evolutionMessage(BL, "qual meu saldo"));
  assert.match(sent[1].text, /limite disponível R[$]700\.00 de R[$]1000\.00/);
});

// Pedido do usuario: nao tinha como mandar o bot PARAR -- qualquer texto
// virava resposta da pergunta pendente. "cancelar" descarta tudo que estava
// esperando resposta, sem registrar nada.
test("cancelar: descarta a pergunta de categoria pendente em vez de usar 'cancelar' como nome de categoria", async (t) => {
  const CN1 = "551100090840";
  seed(CN1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 33, category: "CategoriaCancelarXYZ", description: "gasto a cancelar", date: today() }]);
  await handleIncomingMessage(evolutionMessage(CN1, "33 em algo"));
  assert.match(sent[0].text, /[Qq]ual categoria/);
  assert.match(sent[0].text, /cancelar/); // dica de como desistir

  await handleIncomingMessage(evolutionMessage(CN1, "cancelar"));
  assert.match(sent[1].text, /cancelei/);
  assert.equal(findCategoryByName(CN1, "cancelar"), null); // nao virou categoria
  assert.equal(searchExpenses(CN1, "gasto a cancelar").length, 0);
  assert.equal(getNextPendingCategorization(CN1), null);

  // liberou: a proxima mensagem e interpretada normalmente
  queueReply([{ type: "list_categories" }]);
  await handleIncomingMessage(evolutionMessage(CN1, "quais categorias eu tenho"));
  assert.equal(sent.length, 3);
});

test("cancelar: descarta a pergunta de forma de pagamento pendente, e 'para' sem nada pendente segue pro fluxo normal", async (t) => {
  const CN2 = "551100090841";
  seedNoDefaultPayment(CN2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 18, category: "Mercado", description: "gasto pagamento a cancelar", date: today() }]);
  await handleIncomingMessage(evolutionMessage(CN2, "18 no mercado"));
  assert.match(sent[0].text, /forma de pagamento/i);

  await handleIncomingMessage(evolutionMessage(CN2, "para"));
  assert.match(sent[1].text, /cancelei/);
  assert.equal(searchExpenses(CN2, "gasto pagamento a cancelar").length, 0);

  // sem nada pendente, "para" nao e comando: vai pra IA como qualquer mensagem
  queueReply([{ type: "unknown" }]);
  await handleIncomingMessage(evolutionMessage(CN2, "para"));
  assert.doesNotMatch(sent[2].text, /cancelei/);
});

// Pedido do usuario: "excluir a ultima compra registrada" nao era entendido.
test("delete_expense: apaga o ultimo gasto com confirmacao, e 'desfaz isso' recria", async (t) => {
  const DE1 = "551100090842";
  seed(DE1);
  const cat = getOrCreateCategory(DE1, "Apagar-teste");
  insertExpense({ fromNumber: DE1, amount: 10, description: "gasto antigo apagar", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: DE1, amount: 77, description: "ultimo gasto apagar", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "delete_expense" }]);
  await handleIncomingMessage(evolutionMessage(DE1, "excluir a ultima compra registrada"));
  assert.match(sent[0].text, /ultimo gasto apagar/);
  assert.match(sent[0].text, /[Cc]onfirma/);
  assert.equal(searchExpenses(DE1, "ultimo gasto apagar").length, 1); // so perguntou

  await handleIncomingMessage(evolutionMessage(DE1, "sim"));
  assert.match(sent[1].text, /apagado/);
  assert.equal(searchExpenses(DE1, "ultimo gasto apagar").length, 0);
  assert.equal(searchExpenses(DE1, "gasto antigo apagar").length, 1); // so o ultimo saiu

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(DE1, "desfaz isso"));
  const back = searchExpenses(DE1, "ultimo gasto apagar");
  assert.equal(back.length, 1);
  assert.equal(back[0].amount, 77);
});

test("delete_expense: 'nao' cancela, por texto acha o gasto certo, e sem gasto nenhum avisa", async (t) => {
  const DE2 = "551100090843";
  seed(DE2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_expense" }]);
  await handleIncomingMessage(evolutionMessage(DE2, "apaga o ultimo gasto"));
  assert.match(sent[0].text, /Não achei nenhum gasto/);

  insertExpense({ fromNumber: DE2, amount: 5, description: "padaria apagar texto", categoryId: null, paymentMethodId: null, date: today() });
  queueReply([{ type: "delete_expense", query: "padaria" }]);
  await handleIncomingMessage(evolutionMessage(DE2, "apaga o gasto da padaria"));
  assert.match(sent[1].text, /padaria apagar texto/);
  await handleIncomingMessage(evolutionMessage(DE2, "nao"));
  assert.match(sent[2].text, /não apaguei/);
  assert.equal(searchExpenses(DE2, "padaria apagar texto").length, 1);
});

// Relato do usuario: "excluir um gasto" (sem dizer qual) nao mostrava opcao
// nenhuma, e "cancelar" sem nada pendente caia no "e gasto, evento ou lembrete?".
test("delete_expense sem dizer qual: confirma o ultimo e, se for 'nao', lista os ultimos pra escolher pelo numero", async (t) => {
  const DE3 = "551100090844";
  seed(DE3);
  insertExpense({ fromNumber: DE3, amount: 11, description: "escolher um", categoryId: null, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: DE3, amount: 22, description: "escolher dois", categoryId: null, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: DE3, amount: 33, description: "escolher tres", categoryId: null, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "delete_expense" }]);
  await handleIncomingMessage(evolutionMessage(DE3, "excluir um gasto"));
  assert.match(sent[0].text, /escolher tres/); // sugere o mais recente
  assert.match(sent[0].text, /te mostro os últimos/);

  await handleIncomingMessage(evolutionMessage(DE3, "nao"));
  assert.match(sent[1].text, /Qual desses/);
  assert.match(sent[1].text, /1\..*escolher tres/);
  assert.match(sent[1].text, /3\..*escolher um/);

  await handleIncomingMessage(evolutionMessage(DE3, "3"));
  assert.match(sent[2].text, /apagado/);
  assert.equal(searchExpenses(DE3, "escolher um").length, 0);
  assert.equal(searchExpenses(DE3, "escolher dois").length, 1);
  assert.equal(searchExpenses(DE3, "escolher tres").length, 1);
});

test("delete_expense: numero invalido na escolha pergunta de novo, e 'cancelar' sai", async (t) => {
  const DE4 = "551100090845";
  seed(DE4);
  insertExpense({ fromNumber: DE4, amount: 1, description: "escolha invalida", categoryId: null, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_expense" }]);
  await handleIncomingMessage(evolutionMessage(DE4, "apagar um gasto"));
  await handleIncomingMessage(evolutionMessage(DE4, "nao"));
  await handleIncomingMessage(evolutionMessage(DE4, "9"));
  assert.match(sent[2].text, /Não entendi/);
  await handleIncomingMessage(evolutionMessage(DE4, "cancelar"));
  assert.match(sent[3].text, /cancelei/);
  assert.equal(searchExpenses(DE4, "escolha invalida").length, 1);
});

test("'cancelar' sem nada pendente responde que nao ha nada a cancelar (nao cai no 'e gasto, evento ou lembrete?')", async (t) => {
  const CN3 = "551100090846";
  seed(CN3);
  const { sent } = withMocks(t);
  await handleIncomingMessage(evolutionMessage(CN3, "cancelar"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /nada pendente/);
  assert.match(sent[0].text, /desfaz isso/);
  assert.doesNotMatch(sent[0].text, /lembrete/);
});

// Pedido do usuario: apagar uma compra parcelada apaga TODAS as parcelas.
test("delete_expense de compra parcelada apaga todas as parcelas, sem tocar em outra compra de mesmo nome, e desfaz recria todas", async (t) => {
  const IP1 = "551100090850";
  seed(IP1);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "installment_expense", description: "Geladeira parc", category: "Compras", total_amount: 900, installments: 3 }]);
  await handleIncomingMessage(evolutionMessage(IP1, "comprei uma geladeira de 900 em 3x"));
  // outra compra com o MESMO nome, em outro mes -- nao pode ser levada junto
  queueReply([{ type: "installment_expense", description: "Geladeira parc", category: "Compras", total_amount: 200, installments: 2, date: addDaysToDateString(today(), -200) }]);
  await handleIncomingMessage(evolutionMessage(IP1, "comprei outra geladeira de 200 em 2x"));
  assert.equal(searchExpenses(IP1, "Geladeira parc").length, 5);

  // "a ultima compra" e uma parcela da SEGUNDA compra (a mais recente inserida)
  queueReply([{ type: "delete_expense", query: "parcela 2/3" }]);
  await handleIncomingMessage(evolutionMessage(IP1, "apaga a geladeira parcela 2/3"));
  assert.match(sent[sent.length - 1].text, /compra parcelada/);
  assert.match(sent[sent.length - 1].text, /3x/);
  assert.match(sent[sent.length - 1].text, /TODAS/);

  await handleIncomingMessage(evolutionMessage(IP1, "sim"));
  assert.match(sent[sent.length - 1].text, /3 parcelas/);
  const restantes = searchExpenses(IP1, "Geladeira parc");
  assert.equal(restantes.length, 2); // so a compra de 2x ficou
  assert.ok(restantes.every((e) => /\/2\)$/.test(e.description)));

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(IP1, "desfaz isso"));
  assert.equal(searchExpenses(IP1, "Geladeira parc").length, 5);
  const totalTres = searchExpenses(IP1, "Geladeira parc").filter((e) => /\/3\)$/.test(e.description)).reduce((s, e) => s + e.amount, 0);
  assert.equal(Math.round(totalTres * 100) / 100, 900);
});

test("delete_expense: gasto simples continua apagando so ele mesmo (nao e parcela)", async (t) => {
  const IP2 = "551100090851";
  seed(IP2);
  insertExpense({ fromNumber: IP2, amount: 9, description: "coisa avulsa (parcela x)", categoryId: null, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_expense", query: "avulsa" }]);
  await handleIncomingMessage(evolutionMessage(IP2, "apaga o gasto avulsa"));
  assert.doesNotMatch(sent[0].text, /parcelada/);
  await handleIncomingMessage(evolutionMessage(IP2, "sim"));
  assert.equal(searchExpenses(IP2, "avulsa").length, 0);
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

  // categoria e campo de TEXTO: texto livre nunca vira o novo valor (so depois da opcao 2)
  await handleIncomingMessage(evolutionMessage(CC10, "Viagem-confirm"));
  assert.match(sent[1].text, /Não entendi/);
  assert.equal(findRecentExpense(CC10, "gasto categoria confirm")?.category_id, original.id);

  // opcao 2 (corrigir): pergunta a categoria; ate 3 palavras resolve direto (nao chama
  // extractCategoryFromAnswer, que faria uma chamada de verdade a IA)
  await handleIncomingMessage(evolutionMessage(CC10, "2"));
  assert.match(sent[2].text, /nova categoria/);
  await handleIncomingMessage(evolutionMessage(CC10, "Viagem-confirm"));
  assert.match(sent[3].text, /Viagem-confirm/);
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
  const d = nearFutureDateString();
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "event", title: "consulta sem hora", start: d }]);
  await handleIncomingMessage(evolutionMessage(EV2, "adicionar consulta sem hora dia 20"));
  assert.match(sent[0].text, /📅/);
  assert.doesNotMatch(sent[0].text, /erro/i);

  const matches = findUpcomingEvents(EV2, "consulta sem hora");
  assert.equal(matches.length, 1);
  assert.equal(new Date(matches[0].start).toISOString(), `${d}T03:00:00.000Z`); // meia-noite BRT = 03:00 UTC
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
  assert.match(sent[1].text, /Achei 2 eventos com "duplicado"/);
  assert.match(sent[1].text, /1\. Duplicado A/);
  assert.match(sent[1].text, /2\. Duplicado B/);
  assert.match(sent[1].text, /Qual deles você quer remarcar\?/);
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

// Achado da auditoria: edit_event so mudava data/hora -- renomear o evento ou
// mudar a antecedencia do aviso (padrao 60 min) so era possivel apagando e
// recriando. Agora da pra editar os dois, juntos ou separados, sem mexer na
// data/hora se o usuario nao pediu.
test("edit_event: agora tambem edita titulo e antecedencia do aviso, sem exigir mudar data/hora", async (t) => {
  const EV6 = "551100090871";
  seed(EV6);
  const start = nearFuture();
  const event = createEvent({ fromNumber: EV6, title: "Dentista", start });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "dentista", new_title: "Dentista Dr. Paulo" }]);
  await handleIncomingMessage(evolutionMessage(EV6, "muda o nome do evento dentista pra Dentista Dr. Paulo"));
  assert.match(sent[0].text, /Dentista Dr\. Paulo/);
  await handleIncomingMessage(evolutionMessage(EV6, "sim"));
  let updated = getEventById(EV6, event.id)!;
  assert.equal(updated.title, "Dentista Dr. Paulo");
  assert.equal(updated.start, start); // data/hora intocada
  assert.equal(updated.reminder_minutes, 60); // antecedencia intocada

  queueReply([{ type: "edit_event", query: "dentista", new_reminder_minutes: 30 }]);
  await handleIncomingMessage(evolutionMessage(EV6, "me avisa 30 minutos antes do dentista em vez de 60"));
  await handleIncomingMessage(evolutionMessage(EV6, "sim"));
  updated = getEventById(EV6, event.id)!;
  assert.equal(updated.reminder_minutes, 30);
  assert.equal(updated.title, "Dentista Dr. Paulo"); // titulo da edicao anterior preservado
});

test("edit_event: resposta livre a uma edicao de titulo/antecedencia (sem data/hora envolvida) nao tenta reinterpretar como data", async (t) => {
  const EV7 = "551100090872";
  seed(EV7);
  const event = createEvent({ fromNumber: EV7, title: "Consulta", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "consulta", new_title: "Consulta Dra. Ana" }]);
  await handleIncomingMessage(evolutionMessage(EV7, "renomeia a consulta pra Consulta Dra. Ana"));

  await handleIncomingMessage(evolutionMessage(EV7, "talvez, deixa eu ver")); // nem "sim" puro nem "nao"
  assert.match(sent[1].text, /[Nn]ão entendi/);
  assert.equal(getEventById(EV7, event.id)?.title, "Consulta"); // ainda nao aplicado
});

test("edit_event: undo de edicao de titulo/antecedencia desfaz tudo, nao so a data", async (t) => {
  const EV8 = "551100090873";
  seed(EV8);
  const start = nearFuture();
  const event = createEvent({ fromNumber: EV8, title: "Reuniao renomear", start });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao renomear", new_title: "Reuniao com o cliente", new_reminder_minutes: 15 }]);
  await handleIncomingMessage(evolutionMessage(EV8, "renomeia a reuniao renomear pra Reuniao com o cliente e avisa 15 min antes"));
  await handleIncomingMessage(evolutionMessage(EV8, "sim"));
  assert.equal(getEventById(EV8, event.id)?.title, "Reuniao com o cliente");
  assert.equal(getEventById(EV8, event.id)?.reminder_minutes, 15);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(EV8, "desfaz isso"));
  const restored = getEventById(EV8, event.id)!;
  assert.equal(restored.title, "Reuniao renomear");
  assert.equal(restored.reminder_minutes, 60);
  assert.equal(restored.start, start);
});

// Regressao direta do que foi relatado em producao: usuario tentou mudar a
// antecedencia de 60 pra 120 minutos e disse que "nao foi possivel". O
// mecanismo em si (updateEvent/resolveEditEventConfirmation) e indiferente ao
// valor -- esse teste prova que 120 funciona exatamente igual a 30 (ja testado
// acima), e que converter "1 dia antes" pra 1440 minutos tambem funciona.
test("edit_event: muda a antecedencia pra 120 minutos (relatado como 'nao funcionou') e tambem aceita antecedencia em dias", async (t) => {
  const EV9 = "551100090876";
  seed(EV9);
  const event = createEvent({ fromNumber: EV9, title: "Compra de pao", start: nearFuture(), reminderMinutes: 60 });

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "compra de pao", new_reminder_minutes: 120 }]);
  await handleIncomingMessage(evolutionMessage(EV9, "me avisa 120 minutos antes da compra de pao em vez de 60"));
  await handleIncomingMessage(evolutionMessage(EV9, "sim"));
  assert.equal(getEventById(EV9, event.id)?.reminder_minutes, 120);

  queueReply([{ type: "edit_event", query: "compra de pao", new_reminder_minutes: 1440 }]); // "1 dia antes"
  await handleIncomingMessage(evolutionMessage(EV9, "quero ser avisado 1 dia antes da compra de pao"));
  await handleIncomingMessage(evolutionMessage(EV9, "sim"));
  assert.equal(getEventById(EV9, event.id)?.reminder_minutes, 1440);
});

// Achado da auditoria: o whitelist de confirmacao ("sim"/"s"/"confirmo"/...)
// nao reconhecia afirmativas comuns em portugues, o que podia fazer uma edicao
// parecer "nao funcionar" se o usuario respondesse com uma delas.
test("edit_event: confirmacao reconhece mais afirmativas comuns ('claro', 'perfeito', 'com certeza')", async (t) => {
  const EV10 = "551100090877";
  seed(EV10);
  const event = createEvent({ fromNumber: EV10, title: "Revisao do carro", start: nearFuture(), reminderMinutes: 60 });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "revisao do carro", new_reminder_minutes: 180 }]);
  await handleIncomingMessage(evolutionMessage(EV10, "me avisa 3 horas antes da revisao do carro"));
  await handleIncomingMessage(evolutionMessage(EV10, "claro"));
  assert.doesNotMatch(sent[sent.length - 1].text, /[Nn]ão entendi/);
  assert.equal(getEventById(EV10, event.id)?.reminder_minutes, 180);
});

// Pedido do usuario: ate 3 avisos por evento (principal + 2 extras), em
// qualquer combinacao de minutos/horas/dias, sem perder os que ja existiam.
test("add_event_reminder: adiciona avisos extras (maximo 3 no total), sem duplicar nem substituir os existentes", async (t) => {
  const AE1 = "551100090878";
  seed(AE1);
  const event = createEvent({ fromNumber: AE1, title: "Consulta com a Alice", start: nearFuture(), reminderMinutes: 60 });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "add_event_reminder", query: "consulta com a alice", minutes_before: 1440 }]);
  await handleIncomingMessage(evolutionMessage(AE1, "quero ser avisado tambem 1 dia antes da consulta com a Alice"));
  assert.match(sent[0].text, /1 dia/);
  assert.match(sent[0].text, /1 hora/);

  queueReply([{ type: "add_event_reminder", query: "consulta com a alice", minutes_before: 120 }]);
  await handleIncomingMessage(evolutionMessage(AE1, "adiciona mais um alerta de 2 horas antes pra consulta com a Alice"));
  assert.match(sent[1].text, /2 horas/);
  assert.deepEqual(listEventReminderMinutes(AE1, event.id), [1440, 120, 60]);

  // 4o alerta: ja esta no maximo (3)
  queueReply([{ type: "add_event_reminder", query: "consulta com a alice", minutes_before: 30 }]);
  await handleIncomingMessage(evolutionMessage(AE1, "adiciona mais um alerta de 30 minutos antes pra consulta com a Alice"));
  assert.match(sent[2].text, /máximo/i);
  assert.equal(listEventReminderMinutes(AE1, event.id).length, 3);

  // duplicado (60 ja existe)
  queueReply([{ type: "add_event_reminder", query: "consulta com a alice", minutes_before: 60 }]);
  await handleIncomingMessage(evolutionMessage(AE1, "me avisa 60 minutos antes da consulta com a Alice tambem"));
  assert.match(sent[3].text, /já tem/i);
});

test("remove_event_reminder: remove so o aviso pedido, mantendo os outros, e nao deixa remover o ultimo restante", async (t) => {
  const RE1 = "551100090879";
  seed(RE1);
  const event = createEvent({ fromNumber: RE1, title: "Exame da Alice", start: nearFuture(), reminderMinutes: 60 });
  addEventExtraReminder(RE1, event.id, 1440);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "remove_event_reminder", query: "exame da alice", minutes_before: 1440 }]);
  await handleIncomingMessage(evolutionMessage(RE1, "tira o aviso de 1 dia antes do exame da Alice"));
  assert.match(sent[0].text, /1 hora/);
  assert.doesNotMatch(sent[0].text, /1 dia/);
  assert.deepEqual(listEventReminderMinutes(RE1, event.id), [60]);

  queueReply([{ type: "remove_event_reminder", query: "exame da alice", minutes_before: 60 }]);
  await handleIncomingMessage(evolutionMessage(RE1, "tira o aviso de 1 hora antes do exame da Alice"));
  assert.match(sent[1].text, /pelo menos 1/);
  assert.deepEqual(listEventReminderMinutes(RE1, event.id), [60]); // nao removeu

  queueReply([{ type: "remove_event_reminder", query: "exame da alice", minutes_before: 999 }]);
  await handleIncomingMessage(evolutionMessage(RE1, "tira o aviso de 999 minutos antes do exame da Alice"));
  assert.match(sent[2].text, /não tem um aviso/);
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

// Achado da auditoria: edit_reminder so mudava data/hora -- mudar o TEXTO do
// lembrete so era possivel apagando e recriando. Undo restaura o texto original.
test("edit_reminder: agora tambem edita o texto do lembrete, com undo restaurando o texto original", async (t) => {
  const ER3 = "551100090113";
  seed(ER3);
  // due_at "cru" (com milissegundos/Z) de proposito: se a edicao reformatasse a
  // data sem o usuario ter pedido (bug real ja corrigido no edit_event acima,
  // mesmo risco aqui), esse valor exato mudaria e o teste pegaria isso.
  const dueAt = nearFuture();
  const reminderId = createReminder(ER3, "pagar boleto", dueAt);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_reminder", query: "pagar boleto", new_message: "Pagar o boleto do carro" }]);
  await handleIncomingMessage(evolutionMessage(ER3, "o lembrete de pagar boleto agora e Pagar o boleto do carro"));
  assert.match(sent[0].text, /Pagar o boleto do carro/);
  await handleIncomingMessage(evolutionMessage(ER3, "sim"));
  let reminder = listReminders(ER3).find((r) => r.id === reminderId)!;
  assert.equal(reminder.message, "Pagar o boleto do carro");
  assert.equal(reminder.due_at, dueAt); // data/hora intocada, byte a byte

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(ER3, "desfaz isso"));
  reminder = listReminders(ER3).find((r) => r.id === reminderId)!;
  assert.equal(reminder.message, "pagar boleto");
});

// Regressao: relatado em producao -- nao existia NENHUM jeito de apagar um
// lembrete por mensagem (so existia cancelar EVENTO). delete_reminder fecha
// essa lacuna, com a mesma confirmacao/undo ja usados em delete_event.
test("delete_reminder: pede confirmacao antes de apagar, 'nao' mantem, 'sim' apaga, e undo recria", async (t) => {
  const DR1 = "551100090120";
  seed(DR1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "pagar a internet", due_at: "2026-09-15T09:00:00-03:00" }]);
  await handleIncomingMessage(evolutionMessage(DR1, "me lembra de pagar a internet dia 15 as 9h"));
  const reminderId = listReminders(DR1)[0].id;

  queueReply([{ type: "delete_reminder", query: "pagar a internet" }]);
  await handleIncomingMessage(evolutionMessage(DR1, "apaga o lembrete de pagar a internet"));
  assert.match(sent[1].text, /[Cc]onfirma/);
  assert.ok(getReminderById(DR1, reminderId)); // ainda nao apagou, so perguntou

  await handleIncomingMessage(evolutionMessage(DR1, "não"));
  assert.match(sent[2].text, /não mexi/i);
  assert.ok(getReminderById(DR1, reminderId));

  queueReply([{ type: "delete_reminder", query: "pagar a internet" }]);
  await handleIncomingMessage(evolutionMessage(DR1, "apaga o lembrete de pagar a internet"));
  await handleIncomingMessage(evolutionMessage(DR1, "sim"));
  assert.equal(getReminderById(DR1, reminderId), undefined);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(DR1, "desfaz isso"));
  assert.ok(listReminders(DR1).find((r) => r.message === "pagar a internet"));
});

test("delete_reminder: nenhum lembrete encontrado avisa em vez de pedir confirmacao do nada", async (t) => {
  const DR2 = "551100090121";
  seed(DR2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_reminder", query: "nao existe" }]);
  await handleIncomingMessage(evolutionMessage(DR2, "apaga o lembrete que nao existe"));
  assert.match(sent[0].text, /[Nn]ão encontrei/);
});

// Pedido do usuario: lembrete simples nao suporta "avisa X minutos antes"
// (isso e um recurso so de evento) -- em vez de criar errado ou ignorar, o
// bot deve perguntar se quer virar evento (aviso antecipado de verdade) ou
// so quer uma explicacao de como usar a agenda.
test("reminder com 'avise X min antes': pergunta em vez de criar; 'evento' cria EVENTO com o aviso certo", async (t) => {
  const RA1 = "551100090122";
  seed(RA1);
  const d = nearFutureDateString();
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "consulta", due_at: `${d}T15:00:00-03:00`, advance_minutes: 20 }]);
  await handleIncomingMessage(evolutionMessage(RA1, "me lembra da consulta dia 20 as 15h, me avisa 20 minutos antes"));
  assert.match(sent[0].text, /evento/i);
  assert.equal(listReminders(RA1).length, 0); // nao criou lembrete nenhum ainda

  await handleIncomingMessage(evolutionMessage(RA1, "cria como evento"));
  const [event] = findUpcomingEvents(RA1, "consulta");
  assert.ok(event);
  assert.equal(event.start, `${d}T15:00:00-03:00`);
  assert.equal(event.reminder_minutes, 20);
  assert.equal(listReminders(RA1).length, 0); // nunca virou lembrete
});

test("reminder com 'avise X min antes': responder 'explica' ensina a usar a agenda, sem criar nada", async (t) => {
  const RA2 = "551100090123";
  seed(RA2);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "reminder", message: "reuniao", due_at: "2026-09-21T10:00:00-03:00", advance_minutes: 10 }]);
  await handleIncomingMessage(evolutionMessage(RA2, "cria um lembrete da reuniao dia 21 as 10h e me avisa 10 min antes"));

  await handleIncomingMessage(evolutionMessage(RA2, "explica"));
  assert.match(sent[1].text, /agenda/i);
  assert.equal(listReminders(RA2).length, 0);
  assert.equal(findUpcomingEvents(RA2, "reuniao").length, 0);
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

// Achado da auditoria: nao existia NENHUM jeito de editar um gasto fixo ja
// cadastrado -- so dava pra cancelar e criar de novo do zero. Agora da pra
// mudar qualquer campo (nome, valor, categoria, dia do mes, pagamento), com
// confirmacao antes e undo depois, igual os outros fluxos de edicao.
test("edit_recurring_expense: muda varios campos de uma vez, com confirmacao antes e undo depois", async (t) => {
  const ERC1 = "551100090874";
  seed(ERC1);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "academia edit", amount: 89.9, category: "Saude", day_of_month: 5 }]);
  await handleIncomingMessage(evolutionMessage(ERC1, "todo dia 5 pago 89,90 de academia edit"));

  queueReply([{ type: "edit_recurring_expense", query: "academia edit", new_amount: 99.9, new_day_of_month: 8 }]);
  await handleIncomingMessage(evolutionMessage(ERC1, "muda o gasto fixo da academia edit pra 99,90 e vencendo dia 8"));
  assert.match(sent[1].text, /99,90/);
  assert.match(sent[1].text, /[Cc]onfirma/);
  let recurring = listRecurringExpenses(ERC1)[0];
  assert.equal(recurring.amount, 89.9); // ainda nao mudou, so perguntou
  assert.equal(recurring.day_of_month, 5);

  await handleIncomingMessage(evolutionMessage(ERC1, "sim"));
  recurring = listRecurringExpenses(ERC1)[0];
  assert.equal(recurring.amount, 99.9);
  assert.equal(recurring.day_of_month, 8);
  assert.equal(recurring.description, "academia edit"); // nao mudou o que nao foi pedido

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(ERC1, "desfaz isso"));
  recurring = listRecurringExpenses(ERC1)[0];
  assert.equal(recurring.amount, 89.9);
  assert.equal(recurring.day_of_month, 5);
});

test("edit_recurring_expense: renomear, responder 'nao', gasto fixo inexistente, e dia do mes invalido", async (t) => {
  const ERC2 = "551100090875";
  seed(ERC2);
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "edit_recurring_expense", query: "nao existe", new_amount: 10 }]);
  await handleIncomingMessage(evolutionMessage(ERC2, "muda o gasto fixo que nao existe"));
  assert.match(sent[0].text, /[Nn]ão achei/);

  queueReply([{ type: "set_recurring_expense", description: "streaming renomear", amount: 25, category: "Lazer", day_of_month: 20 }]);
  await handleIncomingMessage(evolutionMessage(ERC2, "todo dia 20 pago 25 de streaming renomear"));

  queueReply([{ type: "edit_recurring_expense", query: "streaming renomear", new_day_of_month: 40 }]);
  await handleIncomingMessage(evolutionMessage(ERC2, "muda o gasto fixo do streaming renomear pro dia 40"));
  assert.match(sent[2].text, /entre 1 e 31/);
  assert.equal(listRecurringExpenses(ERC2)[0].day_of_month, 20); // nao mudou

  queueReply([{ type: "edit_recurring_expense", query: "streaming renomear", new_description: "Streaming Premium" }]);
  await handleIncomingMessage(evolutionMessage(ERC2, "renomeia o gasto fixo do streaming renomear pra Streaming Premium"));
  await handleIncomingMessage(evolutionMessage(ERC2, "não"));
  assert.match(sent[4].text, /não mexi/i);
  assert.equal(listRecurringExpenses(ERC2)[0].description, "streaming renomear"); // nao mudou
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

test("numero BLOQUEADO pelo admin: ignorado em silencio mesmo estando autorizado -- sem resposta, sem IA, sem alerta pro dono, sem log", async (t) => {
  const BK = "551100090990";
  allowNumber(BK);
  blockNumber(BK);
  assert.equal(isNumberAllowed(BK), false);

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "expense", amount: 999, category: "Nao Deveria", description: "nao deveria registrar", date: today() }]);
  await handleIncomingMessage(evolutionMessage(BK, "gastei 999 no mercado"));

  assert.equal(sent.length, 0); // nem pro numero, nem alerta pro dono
  assert.equal(findRecentExpense(BK), null);
  assert.ok(!getRecentBlockedAttempts(100).some((b) => b.from_number === BK));
});

// Pedido do usuario: mandar so "editar" (ou alterar/ajustar/trocar...) nao pode
// cair no "nao entendi" generico -- o bot pergunta o que editar.
test("palavra solta de edicao ('editar', 'alterar'...) pergunta o que editar, sem chamar a IA, e a resposta mostra a lista certa", async (t) => {
  const ET1 = "551100090970";
  seed(ET1);
  const cat = getOrCreateCategory(ET1, "Mercado");
  insertExpense({ fromNumber: ET1, amount: 25, description: "pao e leite", categoryId: cat.id, paymentMethodId: null, date: today() });
  createEvent({ fromNumber: ET1, title: "Consulta da Ana", start: nearFuture() });

  const { sent } = withMocks(t); // sem queueReply: se chamasse a IA, o teste mostraria no log/assert
  await handleIncomingMessage(evolutionMessage(ET1, "editar"));
  assert.match(sent[0].text, /O que você quer editar/);
  for (const opt of ["Gasto", "Categoria", "Forma de pagamento", "Evento na agenda", "Lembrete", "Alerta de conta", "Gasto fixo"]) assert.match(sent[0].text, new RegExp(opt));
  assert.match(sent[0].text, /6\. Alerta de conta \(vencimento\)\n7\. Gasto fixo \(lançado todo mês\)/);

  await handleIncomingMessage(evolutionMessage(ET1, "1")); // por numero
  assert.match(sent[1].text, /^Seus últimos gastos:\n1\. pao e leite — R\$ 25,00/);
  assert.match(sent[1].text, /Qual deles você quer editar\? Responde com o número ou \*cancelar\*\./);

  await handleIncomingMessage(evolutionMessage(ET1, "Alterar")); // outra palavra
  assert.match(sent[2].text, /O que você quer editar/);
  await handleIncomingMessage(evolutionMessage(ET1, "o evento da agenda")); // por nome
  assert.match(sent[3].text, /^Seus próximos eventos:\n1\. Consulta da Ana/);

  for (const [word, pattern] of [
    ["ajustar", /O que você quer editar/],
    ["quero trocar algo", /O que você quer editar/],
    ["Mudar!", /O que você quer editar/],
  ] as const) {
    await handleIncomingMessage(evolutionMessage(ET1, word));
    assert.match(sent[sent.length - 1].text, pattern);
    await handleIncomingMessage(evolutionMessage(ET1, "cancelar"));
  }
});

test("palavra solta de edicao: resposta que nao e nenhuma opcao pergunta de novo, e cada opcao responde com a lista do seu tipo", async (t) => {
  const ET2 = "551100090971";
  seed(ET2);
  getOrCreatePaymentMethod(ET2, "Nubank");
  const { sent } = withMocks(t);

  await handleIncomingMessage(evolutionMessage(ET2, "editar"));
  await handleIncomingMessage(evolutionMessage(ET2, "sei la")); // nao e opcao
  assert.match(sent[1].text, /Não entendi o que você quer editar/);

  await handleIncomingMessage(evolutionMessage(ET2, "forma de pagamento"));
  assert.match(sent[2].text, /Nubank/);

  const cases: [string, RegExp][] = [
    ["2", /Suas categorias/],
    ["5", /Você não tem nenhum lembrete pendente pra editar\./],
    ["6", /Seus alertas de conta \(vencimento\)/],
    ["7", /Você não tem nenhum gasto fixo pra editar\./],
    ["gasto fixo", /Você não tem nenhum gasto fixo pra editar\./],
  ];
  for (const [answer, expected] of cases) {
    await handleIncomingMessage(evolutionMessage(ET2, "editar"));
    await handleIncomingMessage(evolutionMessage(ET2, answer));
    assert.match(sent[sent.length - 1].text, expected);
  }
});

test("frase de edicao completa NAO e tratada como palavra solta (segue pra IA normal)", async (t) => {
  const ET3 = "551100090972";
  seed(ET3);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "help" }]);
  await handleIncomingMessage(evolutionMessage(ET3, "editar compras"));
  assert.doesNotMatch(sent[0].text, /O que você quer editar/);
});

// ---------------------------------------------------------------------------
// Confirmacao de edicao a prova de erro (previa antes->depois, 1/2/3, RN01-RN10)
// ---------------------------------------------------------------------------

test("confirmacao de edicao: previa 'antes -> depois' com 1/2/3, e 1/sim/Sim!/ok/pode/Sim./👍 aplicam", async (t) => {
  const CF1 = "551100091001";
  seed(CF1);
  const cat = getOrCreateCategory(CF1, "Mercado");
  const pix = getOrCreatePaymentMethod(CF1, "Pix");
  insertExpense({ fromNumber: CF1, amount: 38, description: "Mercado do mes", categoryId: cat.id, paymentMethodId: pix.id, date: "2026-10-07" });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Mercado do mes", field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(CF1, "muda o valor do mercado do mes pra 45"));
  assert.equal(
    sent[0].text,
    "✏️ Mercado do mes — R$ 38,00 · 07/10 · Pix\nValor: R$ 38,00 → R$ 45,00\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );

  const words = ["1", "sim", "Sim!", "ok", "pode", "Sim.", "👍"];
  for (let i = 0; i < words.length; i++) {
    const value = 50 + i;
    queueReply([{ type: "edit_expense", query: "Mercado do mes", field: "amount", value: String(value) }]);
    await handleIncomingMessage(evolutionMessage(CF1, `muda o valor do mercado do mes pra ${value}`));
    await handleIncomingMessage(evolutionMessage(CF1, words[i]));
    assert.equal(findRecentExpense(CF1, "Mercado do mes")?.amount, value, `"${words[i]}" devia aplicar`);
  }
});

test("confirmacao de edicao: 3/nao/n/cancela cancelam sem alterar nada", async (t) => {
  const CF2 = "551100091002";
  seed(CF2);
  const cat = getOrCreateCategory(CF2, "Mercado");
  insertExpense({ fromNumber: CF2, amount: 40, description: "Gasto cancelar edicao", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  for (const word of ["3", "não", "n", "cancela", "❌"]) {
    queueReply([{ type: "edit_expense", query: "Gasto cancelar edicao", field: "amount", value: "99" }]);
    await handleIncomingMessage(evolutionMessage(CF2, "muda o valor do gasto cancelar edicao pra 99"));
    await handleIncomingMessage(evolutionMessage(CF2, word));
    assert.equal(sent[sent.length - 1].text, "Beleza, não mexi em nada.", `"${word}"`);
    assert.equal(findRecentExpense(CF2, "Gasto cancelar edicao")?.amount, 40);
  }
});

test("confirmacao de evento: 'pode ser as 16h', 'para sexta as 16h' e 'nao, e as 16h' sao correcao, nunca sim/nao", async (t) => {
  const CF3 = "551100091003";
  seed(CF3);
  const original = nearFuture();
  const event = createEvent({ fromNumber: CF3, title: "Consulta confirmar", start: original });
  const d1 = nearFutureDateString();
  const d2 = addDaysToDateString(d1, 3);

  const { sent, queueReply } = withMocks(t);
  let extracted: { newDate?: string; newTime?: string } | null = { newTime: "16:00" };
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => extracted);

  queueReply([{ type: "edit_event", query: "consulta confirmar", new_date: d1, new_time: "14:00" }]);
  await handleIncomingMessage(evolutionMessage(CF3, "remarca a consulta confirmar pro dia tal as 14h"));
  assert.match(sent[0].text, /Quando: .* → .*14:00/);
  assert.match(sent[0].text, /1 ✅ Confirmar/);

  await handleIncomingMessage(evolutionMessage(CF3, "pode ser às 16h"));
  assert.match(sent[1].text, /→ .*16:00/);
  assert.equal(getEventById(CF3, event.id)?.start, original); // NAO aplicou

  extracted = { newDate: d2, newTime: "16:00" };
  await handleIncomingMessage(evolutionMessage(CF3, "para sexta às 16h"));
  assert.match(sent[2].text, /→ .*16:00/);
  assert.equal(getEventById(CF3, event.id)?.start, original); // NAO cancelou nem aplicou

  await handleIncomingMessage(evolutionMessage(CF3, "não, é às 16h"));
  assert.match(sent[3].text, /→ .*16:00/);
  assert.equal(getEventById(CF3, event.id)?.start, original);

  await handleIncomingMessage(evolutionMessage(CF3, "1"));
  assert.equal(getEventById(CF3, event.id)?.start, `${d2}T16:00:00-03:00`);
});

test("confirmacao de gasto: valor em formato BR ('1.500') na correcao e campo de texto nunca recebe texto livre", async (t) => {
  const CF4 = "551100091004";
  seed(CF4);
  const cat = getOrCreateCategory(CF4, "Mercado");
  insertExpense({ fromNumber: CF4, amount: 10, description: "Gasto formato br", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Gasto formato br", field: "amount", value: "20" }]);
  await handleIncomingMessage(evolutionMessage(CF4, "muda o valor do gasto formato br pra 20"));
  await handleIncomingMessage(evolutionMessage(CF4, "1.500"));
  assert.match(sent[1].text, /Valor: R\$ 10,00 → R\$ 1\.500,00/);
  await handleIncomingMessage(evolutionMessage(CF4, "sim"));
  assert.equal(findRecentExpense(CF4, "Gasto formato br")?.amount, 1500);

  // campo de TEXTO (descricao): "talvez" nao vira o novo nome
  queueReply([{ type: "edit_expense", query: "Gasto formato br", field: "description", value: "Compras" }]);
  await handleIncomingMessage(evolutionMessage(CF4, "muda o nome do gasto formato br pra Compras"));
  await handleIncomingMessage(evolutionMessage(CF4, "talvez"));
  assert.equal(sent[sent.length - 1].text, "Não entendi 🤔 Responde *1* pra confirmar, *2* pra corrigir ou *3* pra cancelar.");
  assert.equal(findRecentExpense(CF4, "Gasto formato br")?.description, "Gasto formato br");
  assert.equal(findRecentExpense(CF4, "talvez"), null);
});

test("confirmacao de gasto: opcao 2 entra em 'aguardando correcao' -- a mensagem seguinte e o valor (mesmo '3'), so 'cancelar' cancela", async (t) => {
  const CF5 = "551100091005";
  seed(CF5);
  const cat = getOrCreateCategory(CF5, "Mercado");
  insertExpense({ fromNumber: CF5, amount: 10, description: "Gasto aguardando", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Gasto aguardando", field: "amount", value: "20" }]);
  await handleIncomingMessage(evolutionMessage(CF5, "muda o valor do gasto aguardando pra 20"));
  await handleIncomingMessage(evolutionMessage(CF5, "2"));
  assert.equal(sent[1].text, "Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");

  await handleIncomingMessage(evolutionMessage(CF5, "abc")); // invalido: repete a pergunta, mantem o estado
  assert.match(sent[2].text, /Não entendi o valor "abc"\./);
  assert.match(sent[2].text, /Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(CF5, "0")); // nao positivo
  assert.match(sent[3].text, /maior que R\$ 0,00/);

  await handleIncomingMessage(evolutionMessage(CF5, "3")); // aqui "3" e o VALOR, nao cancelar
  assert.match(sent[4].text, /Valor: R\$ 10,00 → R\$ 3,00/);
  assert.match(sent[4].text, /1 ✅ Confirmar/);
  await handleIncomingMessage(evolutionMessage(CF5, "sim"));
  assert.equal(findRecentExpense(CF5, "Gasto aguardando")?.amount, 3);

  // "cancelar" durante a correcao cancela tudo
  queueReply([{ type: "edit_expense", query: "Gasto aguardando", field: "amount", value: "20" }]);
  await handleIncomingMessage(evolutionMessage(CF5, "muda o valor do gasto aguardando pra 20"));
  await handleIncomingMessage(evolutionMessage(CF5, "2"));
  await handleIncomingMessage(evolutionMessage(CF5, "cancelar"));
  assert.equal(sent[sent.length - 1].text, "Beleza, não mexi em nada.");
  assert.equal(findRecentExpense(CF5, "Gasto aguardando")?.amount, 3);
});

test("confirmacao de evento: titulo via opcao 2 ('Qual e o novo nome?') e texto de lembrete via opcao 2", async (t) => {
  const CF6 = "551100091006";
  seed(CF6);
  const event = createEvent({ fromNumber: CF6, title: "Consulta nome", start: nearFuture() });
  const reminderId = createReminder(CF6, "pagar luz", nearFuture());

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "consulta nome", new_title: "Dentista" }]);
  await handleIncomingMessage(evolutionMessage(CF6, "renomeia a consulta nome pra Dentista"));
  assert.match(sent[0].text, /Nome: Consulta nome → Dentista/);
  await handleIncomingMessage(evolutionMessage(CF6, "talvez"));
  assert.match(sent[1].text, /Não entendi 🤔/);
  await handleIncomingMessage(evolutionMessage(CF6, "2"));
  assert.equal(sent[2].text, "Qual é o novo nome? Ou responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(CF6, "Dentista da Ana"));
  assert.match(sent[3].text, /Nome: Consulta nome → Dentista da Ana/);
  await handleIncomingMessage(evolutionMessage(CF6, "1"));
  assert.equal(getEventById(CF6, event.id)?.title, "Dentista da Ana");

  queueReply([{ type: "edit_reminder", query: "pagar luz", new_message: "pagar agua" }]);
  await handleIncomingMessage(evolutionMessage(CF6, "o lembrete pagar luz agora e pagar agua"));
  assert.match(sent[sent.length - 1].text, /Texto: pagar luz → pagar agua/);
  await handleIncomingMessage(evolutionMessage(CF6, "2"));
  assert.equal(sent[sent.length - 1].text, "Qual é o novo texto? Ou responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(CF6, "pagar internet"));
  assert.match(sent[sent.length - 1].text, /Texto: pagar luz → pagar internet/);
  await handleIncomingMessage(evolutionMessage(CF6, "sim"));
  assert.equal(getReminderById(CF6, reminderId)?.message, "pagar internet");
});

test("confirmacao de gasto fixo: 1/2/3 com valor BR na correcao", async (t) => {
  const CF7 = "551100091007";
  seed(CF7);
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "set_recurring_expense", description: "academia fixo", amount: 89.9, category: "Saude", day_of_month: 5 }]);
  await handleIncomingMessage(evolutionMessage(CF7, "todo dia 5 pago 89,90 de academia fixo"));

  queueReply([{ type: "edit_recurring_expense", query: "academia fixo", new_amount: 99.9 }]);
  await handleIncomingMessage(evolutionMessage(CF7, "muda o valor do gasto fixo da academia fixo pra 99,90"));
  assert.match(sent[1].text, /✏️ academia fixo — R\$ 89,90 · todo dia 5\nValor: R\$ 89,90 → R\$ 99,90/);
  await handleIncomingMessage(evolutionMessage(CF7, "2"));
  assert.match(sent[2].text, /Qual é o valor certo/);
  await handleIncomingMessage(evolutionMessage(CF7, "1.500,50"));
  assert.match(sent[3].text, /Valor: R\$ 89,90 → R\$ 1\.500,50/);
  await handleIncomingMessage(evolutionMessage(CF7, "1"));
  assert.equal(listRecurringExpenses(CF7)[0].amount, 1500.5);

  queueReply([{ type: "edit_recurring_expense", query: "academia fixo", new_amount: 10 }]);
  await handleIncomingMessage(evolutionMessage(CF7, "muda o valor do gasto fixo da academia fixo pra 10"));
  await handleIncomingMessage(evolutionMessage(CF7, "3"));
  assert.equal(listRecurringExpenses(CF7)[0].amount, 1500.5); // cancelou
});

test("RN08: pedido novo longo com verbo de edicao descarta a edicao pendente COM aviso; se for correcao valida, mantem", async (t) => {
  const CF8 = "551100091008";
  seed(CF8);
  const cat = getOrCreateCategory(CF8, "Mercado");
  insertExpense({ fromNumber: CF8, amount: 30, description: "Gasto pedido novo", categoryId: cat.id, paymentMethodId: null, date: today() });
  createEvent({ fromNumber: CF8, title: "Reuniao rn08", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  let extracted: { newDate?: string; newTime?: string } | null = null;
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => extracted);

  // edicao de gasto (campo valor) pendente + pedido novo diferente
  queueReply([{ type: "edit_expense", query: "Gasto pedido novo", field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(CF8, "muda o valor do gasto pedido novo pra 45"));
  queueReply([{ type: "correct_category", category: "Lazer", query: "Gasto pedido novo" }]);
  await handleIncomingMessage(evolutionMessage(CF8, "muda a categoria do gasto pedido novo pra lazer por favor"));
  assert.ok(sent.some((s) => s.text === 'Cancelei a alteração de "Gasto pedido novo" e entendi seu novo pedido.'));
  assert.match(sent[sent.length - 1].text, /Categoria: Mercado → Lazer/); // o pedido novo foi processado
  assert.equal(findRecentExpense(CF8, "Gasto pedido novo")?.amount, 30);
  await handleIncomingMessage(evolutionMessage(CF8, "3")); // cancela a correcao de categoria

  // edicao de evento (data/hora) pendente + frase longa que E uma correcao de data/hora
  const d = nearFutureDateString();
  queueReply([{ type: "edit_event", query: "reuniao rn08", new_date: d, new_time: "10:00" }]);
  await handleIncomingMessage(evolutionMessage(CF8, "remarca a reuniao rn08 pro dia tal as 10h"));
  extracted = { newTime: "16:00" };
  const before = sent.length;
  await handleIncomingMessage(evolutionMessage(CF8, "muda pra sexta às 16h por favor"));
  assert.ok(!sent.slice(before).some((s) => s.text.startsWith("Cancelei a alteração")));
  assert.match(sent[sent.length - 1].text, /→ .*16:00/);
});

test("RN07: so uma confirmacao de edicao ativa por numero -- a nova substitui a anterior", async (t) => {
  const CF9 = "551100091009";
  seed(CF9);
  const cat = getOrCreateCategory(CF9, "Mercado");
  insertExpense({ fromNumber: CF9, amount: 20, description: "Gasto rn07", categoryId: cat.id, paymentMethodId: null, date: today() });
  const reminderId = createReminder(CF9, "lembrete rn07", nearFuture());

  const { queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Gasto rn07", field: "amount", value: "99" }]);
  await handleIncomingMessage(evolutionMessage(CF9, "muda o valor do gasto rn07 pra 99"));
  // pedido novo (5+ palavras com verbo de edicao): a edicao do gasto e descartada (RN08)
  // e a do lembrete vira a unica ativa (RN07)
  queueReply([{ type: "edit_reminder", query: "lembrete rn07", new_message: "lembrete novo rn07" }]);
  await handleIncomingMessage(evolutionMessage(CF9, "muda o lembrete rn07 pra lembrete novo rn07 por favor"));

  await handleIncomingMessage(evolutionMessage(CF9, "1")); // confirma a ULTIMA edicao (lembrete)
  assert.equal(getReminderById(CF9, reminderId)?.message, "lembrete novo rn07");
  assert.equal(findRecentExpense(CF9, "Gasto rn07")?.amount, 20); // a edicao do gasto foi substituida
});

test("item apagado enquanto a confirmacao esta pendente: mensagem amigavel, sem erro e sem alterar nada", async (t) => {
  const CF10 = "551100091010";
  seed(CF10);
  const cat = getOrCreateCategory(CF10, "Mercado");
  const expense = insertExpense({ fromNumber: CF10, amount: 20, description: "Gasto apagado", categoryId: cat.id, paymentMethodId: null, date: today() });
  const event = createEvent({ fromNumber: CF10, title: "Evento apagado", start: nearFuture() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "Gasto apagado", field: "amount", value: "99" }]);
  await handleIncomingMessage(evolutionMessage(CF10, "muda o valor do gasto apagado pra 99"));
  expensesService.deleteExpense(CF10, expense.id); // ex: apagado pelo painel enquanto pendente
  await handleIncomingMessage(evolutionMessage(CF10, "1"));
  assert.equal(sent[sent.length - 1].text, "Não achei mais esse item.");

  queueReply([{ type: "edit_event", query: "evento apagado", new_title: "Outro nome" }]);
  await handleIncomingMessage(evolutionMessage(CF10, "renomeia o evento apagado pra Outro nome"));
  deleteEvent(CF10, event.id);
  await handleIncomingMessage(evolutionMessage(CF10, "sim"));
  assert.equal(sent[sent.length - 1].text, "Não achei mais esse item.");
});

// ---------------------------------------------------------------------------
// Escolha do item certo por numero (evento, lembrete e gasto) -- card 2
// ---------------------------------------------------------------------------

const futureAt = (daysAhead: number, hour: number) =>
  `${addDaysToDateString(spDateString(), daysAhead)}T${String(hour).padStart(2, "0")}:00:00-03:00`;

test("escolha de alvo: 2 lembretes batem -> lista numerada; responder '2' vai direto pra previa do 2o, sem repetir o pedido", async (t) => {
  const TC1 = "551100091101";
  seed(TC1);
  const r1 = createReminder(TC1, "Remédio pressão", futureAt(1, 8));
  const r2 = createReminder(TC1, "Remédio vitamina", futureAt(2, 9));

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_reminder", query: "remédio", new_message: "Remédio novo" }]);
  await handleIncomingMessage(evolutionMessage(TC1, "muda o lembrete do remédio pra Remédio novo"));
  assert.match(sent[0].text, /^Achei 2 lembretes com "remédio":\n1\. Remédio pressão — /);
  assert.match(sent[0].text, /2\. Remédio vitamina — /);
  assert.match(sent[0].text, /Qual deles você quer editar\? Responde com o número ou \*cancelar\*\.$/);

  await handleIncomingMessage(evolutionMessage(TC1, "2")); // sem IA: nenhuma resposta enfileirada
  assert.match(sent[1].text, /✏️ Remédio vitamina\nTexto: Remédio vitamina → Remédio novo/);
  await handleIncomingMessage(evolutionMessage(TC1, "1"));
  assert.equal(getReminderById(TC1, r2)?.message, "Remédio novo");
  assert.equal(getReminderById(TC1, r1)?.message, "Remédio pressão"); // o outro nao mexeu
});

test("escolha de alvo: 3 eventos com 'consulta' -> cancelar e responder '1' segue pra confirmacao de exclusao do 1o", async (t) => {
  const TC2 = "551100091102";
  seed(TC2);
  const e1 = createEvent({ fromNumber: TC2, title: "Consulta dentista", start: futureAt(2, 14) });
  createEvent({ fromNumber: TC2, title: "Consulta médico", start: futureAt(3, 10) });
  createEvent({ fromNumber: TC2, title: "Consulta pediatra", start: futureAt(4, 16) });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "consulta" }]);
  await handleIncomingMessage(evolutionMessage(TC2, "cancela a consulta"));
  assert.match(sent[0].text, /Achei 3 eventos com "consulta":/);
  assert.match(sent[0].text, /Qual deles você quer cancelar\?/);

  await handleIncomingMessage(evolutionMessage(TC2, "1"));
  assert.match(sent[1].text, /Encontrei "Consulta dentista" em .*Confirma que quer cancelar/);
  assert.ok(getEventById(TC2, e1.id)); // so perguntou
  await handleIncomingMessage(evolutionMessage(TC2, "sim"));
  assert.equal(getEventById(TC2, e1.id), undefined);
});

test("escolha de alvo: 2 gastos com 'mercado' -> lista com valor/data/pagamento; escolher o 1 mostra a previa do gasto escolhido", async (t) => {
  const TC3 = "551100091103";
  seed(TC3);
  const cat = getOrCreateCategory(TC3, "Mercado");
  const pix = getOrCreatePaymentMethod(TC3, "Pix");
  insertExpense({ fromNumber: TC3, amount: 112.4, description: "Mercado", categoryId: cat.id, paymentMethodId: null, date: "2026-10-05" });
  const recent = insertExpense({ fromNumber: TC3, amount: 38, description: "Mercado", categoryId: cat.id, paymentMethodId: pix.id, date: "2026-10-07" });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "mercado", field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(TC3, "muda o valor do mercado pra 45"));
  assert.match(sent[0].text, /Achei 2 gastos com "mercado":\n1\. Mercado — R\$ 38,00 · 07\/10 · Pix\n2\. Mercado — R\$ 112,40 · 05\/10\n/);

  await handleIncomingMessage(evolutionMessage(TC3, "1"));
  assert.match(sent[1].text, /✏️ Mercado — R\$ 38,00 · 07\/10 · Pix\nValor: R\$ 38,00 → R\$ 45,00/);
  await handleIncomingMessage(evolutionMessage(TC3, "1"));
  assert.equal(expensesService.getExpenseById(TC3, recent.id)?.amount, 45);
});

test("escolha de alvo: com exatamente 1 candidato nenhuma lista e enviada; pedido sem o que mudar nao lista nada", async (t) => {
  const TC4 = "551100091104";
  seed(TC4);
  createEvent({ fromNumber: TC4, title: "Reuniao unica", start: futureAt(2, 10) });
  createEvent({ fromNumber: TC4, title: "Consulta A", start: futureAt(3, 10) });
  createEvent({ fromNumber: TC4, title: "Consulta B", start: futureAt(4, 10) });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "reuniao unica", new_title: "Reuniao importante" }]);
  await handleIncomingMessage(evolutionMessage(TC4, "renomeia a reuniao unica pra Reuniao importante"));
  assert.doesNotMatch(sent[0].text, /Achei/);
  assert.match(sent[0].text, /✏️ Reuniao unica\nNome: Reuniao unica → Reuniao importante/);
  await handleIncomingMessage(evolutionMessage(TC4, "3")); // cancela essa edicao

  // 2 eventos batem com "consulta" e o pedido nao diz o que mudar: lista pra escolher e depois abre o menu de campos
  queueReply([{ type: "edit_event", query: "consulta" }]);
  await handleIncomingMessage(evolutionMessage(TC4, "muda a consulta"));
  assert.match(sent[sent.length - 1].text, /Achei 2 eventos com "consulta":/);
  await handleIncomingMessage(evolutionMessage(TC4, "1"));
  assert.match(sent[sent.length - 1].text, /O que você quer mudar\?\n1 Dia e hora\n2 Título\n3 Aviso/);
  await handleIncomingMessage(evolutionMessage(TC4, "cancelar"));
});

test("escolha de alvo: refino por texto (1 acha -> segue; 2+ -> lista renumerada; 0 -> nao entendi mantendo a lista)", async (t) => {
  const TC5 = "551100091105";
  seed(TC5);
  const a = createReminder(TC5, "Remédio pressão alta", futureAt(1, 8));
  createReminder(TC5, "Remédio pressão baixa", futureAt(2, 8));
  createReminder(TC5, "Remédio gato", futureAt(3, 8));

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_reminder", query: "remédio" }]);
  await handleIncomingMessage(evolutionMessage(TC5, "apaga o lembrete do remédio"));
  assert.match(sent[0].text, /Achei 3 lembretes com "remédio":/);

  await handleIncomingMessage(evolutionMessage(TC5, "xyz")); // 0 resultados: mantem a lista
  assert.equal(sent[1].text, "Não entendi 🤔 Responde com um número de 1 a 3, ou *cancelar*.");

  await handleIncomingMessage(evolutionMessage(TC5, "a pressão")); // 2 resultados: reenvia renumerada
  assert.match(sent[2].text, /^Ainda tenho 2 opções com "pressão":\n1\. Remédio pressão alta/);
  assert.match(sent[2].text, /2\. Remédio pressão baixa/);

  await handleIncomingMessage(evolutionMessage(TC5, "alta")); // 1 resultado: segue direto pra confirmacao
  assert.match(sent[3].text, /Encontrei o lembrete "Remédio pressão alta".*Confirma que quer apagar/);
  await handleIncomingMessage(evolutionMessage(TC5, "sim"));
  assert.equal(getReminderById(TC5, a), undefined);
});

test("escolha de alvo: numero invalido mantem a lista, e cancelar/nao/3 (sem 3a opcao) cancelam sem alterar nada", async (t) => {
  const TC6 = "551100091106";
  seed(TC6);
  const e1 = createEvent({ fromNumber: TC6, title: "Evento escolha 1", start: futureAt(2, 10) });
  createEvent({ fromNumber: TC6, title: "Evento escolha 2", start: futureAt(3, 10) });

  const { sent, queueReply } = withMocks(t);
  for (const cancelWord of ["cancelar", "não", "3"]) {
    queueReply([{ type: "delete_event", query: "evento escolha" }]);
    await handleIncomingMessage(evolutionMessage(TC6, "cancela o evento escolha"));
    await handleIncomingMessage(evolutionMessage(TC6, "5")); // fora da lista
    assert.equal(sent[sent.length - 1].text, "Não entendi 🤔 Responde com um número de 1 a 2, ou *cancelar*.");
    await handleIncomingMessage(evolutionMessage(TC6, "xyz")); // nada bate
    assert.match(sent[sent.length - 1].text, /Não entendi 🤔/);
    await handleIncomingMessage(evolutionMessage(TC6, cancelWord));
    assert.equal(sent[sent.length - 1].text, "Beleza, não mexi em nada.", `"${cancelWord}"`);
    assert.ok(getEventById(TC6, e1.id));
  }
});

test("escolha de alvo: lista de gastos expirada nao reaproveita o numero -- oferece os ultimos gastos e continua a acao", async (t) => {
  const TC7 = "551100091107";
  seed(TC7);
  const cat = getOrCreateCategory(TC7, "Mercado");
  const old = insertExpense({ fromNumber: TC7, amount: 10, description: "Gasto antigo", categoryId: cat.id, paymentMethodId: null, date: "2026-10-01" });
  const recent = insertExpense({ fromNumber: TC7, amount: 20, description: "Gasto recente", categoryId: cat.id, paymentMethodId: null, date: "2026-10-02" });

  const { sent, queueReply } = withMocks(t);
  // sem nenhuma lista aberta (nunca listou / expirou): "edita o 1" nao pode adivinhar
  queueReply([{ type: "edit_expense", list_ref: 1, field: "amount", value: "99" }]);
  await handleIncomingMessage(evolutionMessage(TC7, "edita o 1 pro valor 99"));
  assert.match(sent[0].text, /^Essa lista já expirou, então não vou adivinhar pelo número\. Seus últimos gastos:\n1\. Gasto recente — R\$ 20,00/);
  assert.match(sent[0].text, /2\. Gasto antigo — R\$ 10,00/);
  assert.equal(expensesService.getExpenseById(TC7, recent.id)?.amount, 20); // nada foi aplicado ao "1"

  await handleIncomingMessage(evolutionMessage(TC7, "2")); // escolhe o gasto antigo
  assert.match(sent[1].text, /✏️ Gasto antigo — R\$ 10,00 · 01\/10\nValor: R\$ 10,00 → R\$ 99,00/);
  await handleIncomingMessage(evolutionMessage(TC7, "sim"));
  assert.equal(expensesService.getExpenseById(TC7, old.id)?.amount, 99);
  assert.equal(expensesService.getExpenseById(TC7, recent.id)?.amount, 20);
});

test("escolha de alvo: item apagado entre a lista e a resposta -> 'Esse item nao existe mais.', sem erro", async (t) => {
  const TC8 = "551100091108";
  seed(TC8);
  createEvent({ fromNumber: TC8, title: "Evento some 1", start: futureAt(2, 10) });
  const gone = createEvent({ fromNumber: TC8, title: "Evento some 2", start: futureAt(3, 10) });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "evento some" }]);
  await handleIncomingMessage(evolutionMessage(TC8, "cancela o evento some"));
  deleteEvent(TC8, gone.id); // apagado pelo painel enquanto a lista estava aberta
  await handleIncomingMessage(evolutionMessage(TC8, "2"));
  assert.equal(sent[sent.length - 1].text, "Esse item não existe mais.");
});

test("escolha de alvo: pedido novo longo com verbo de edicao descarta a escolha com aviso de uma linha e processa o novo pedido", async (t) => {
  const TC9 = "551100091109";
  seed(TC9);
  createReminder(TC9, "Remédio A", futureAt(1, 8));
  createReminder(TC9, "Remédio B", futureAt(2, 8));
  const cat = getOrCreateCategory(TC9, "Mercado");
  insertExpense({ fromNumber: TC9, amount: 30, description: "Gasto pedido novo escolha", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_reminder", query: "remédio" }]);
  await handleIncomingMessage(evolutionMessage(TC9, "apaga o lembrete do remédio"));
  assert.match(sent[0].text, /Achei 2 lembretes/);

  queueReply([{ type: "edit_expense", query: "gasto pedido novo escolha", field: "amount", value: "45" }]);
  await handleIncomingMessage(evolutionMessage(TC9, "muda o valor do gasto pedido novo escolha pra 45"));
  assert.ok(sent.some((s) => s.text === "Cancelei a escolha anterior e entendi seu novo pedido."));
  assert.match(sent[sent.length - 1].text, /Valor: R\$ 30,00 → R\$ 45,00/);
});

test("escolha de alvo: os outros fluxos do escopo (lembrete apagar, aviso extra, remover aviso, categoria, apagar gasto) tambem listam e continuam", async (t) => {
  const TC10 = "551100091110";
  seed(TC10);
  const { sent, queueReply } = withMocks(t);

  // add_event_reminder
  const ev1 = createEvent({ fromNumber: TC10, title: "Festa um", start: futureAt(2, 20), reminderMinutes: 60 });
  createEvent({ fromNumber: TC10, title: "Festa dois", start: futureAt(3, 20), reminderMinutes: 60 });
  queueReply([{ type: "add_event_reminder", query: "festa", minutes_before: 1440 }]);
  await handleIncomingMessage(evolutionMessage(TC10, "quero ser avisado tambem 1 dia antes da festa"));
  assert.match(sent[sent.length - 1].text, /Qual deles você quer adicionar o aviso\?/);
  await handleIncomingMessage(evolutionMessage(TC10, "1"));
  assert.deepEqual(listEventReminderMinutes(TC10, ev1.id), [1440, 60]);

  // remove_event_reminder
  queueReply([{ type: "remove_event_reminder", query: "festa", minutes_before: 1440 }]);
  await handleIncomingMessage(evolutionMessage(TC10, "tira o aviso de 1 dia antes da festa"));
  assert.match(sent[sent.length - 1].text, /Qual deles você quer remover o aviso\?/);
  await handleIncomingMessage(evolutionMessage(TC10, "o 1"));
  assert.deepEqual(listEventReminderMinutes(TC10, ev1.id), [60]);

  // correct_category + delete_expense (2 gastos "lanche")
  const lazer = getOrCreateCategory(TC10, "Lazer");
  insertExpense({ fromNumber: TC10, amount: 15, description: "Lanche manha", categoryId: lazer.id, paymentMethodId: null, date: today() });
  const lanche2 = insertExpense({ fromNumber: TC10, amount: 25, description: "Lanche tarde", categoryId: lazer.id, paymentMethodId: null, date: today() });
  queueReply([{ type: "correct_category", category: "Mercado", query: "lanche" }]);
  await handleIncomingMessage(evolutionMessage(TC10, "o lanche e mercado"));
  assert.match(sent[sent.length - 1].text, /Achei 2 gastos com "lanche":\n1\. Lanche tarde/);
  await handleIncomingMessage(evolutionMessage(TC10, "1"));
  assert.match(sent[sent.length - 1].text, /Categoria: Lazer → Mercado/);
  await handleIncomingMessage(evolutionMessage(TC10, "3")); // cancela a correcao

  queueReply([{ type: "delete_expense", query: "lanche" }]);
  await handleIncomingMessage(evolutionMessage(TC10, "apaga o lanche"));
  assert.match(sent[sent.length - 1].text, /Qual deles você quer apagar\?/);
  await handleIncomingMessage(evolutionMessage(TC10, "1"));
  assert.match(sent[sent.length - 1].text, /Confirma que quer apagar este gasto\? R\$25\.00 — Lanche tarde/);
  await handleIncomingMessage(evolutionMessage(TC10, "sim"));
  assert.equal(expensesService.getExpenseById(TC10, lanche2.id), null);

  // delete_reminder com 2 candidatos
  const rem = createReminder(TC10, "Pagar luz", futureAt(1, 9));
  createReminder(TC10, "Pagar agua", futureAt(2, 9));
  queueReply([{ type: "delete_reminder", query: "pagar" }]);
  await handleIncomingMessage(evolutionMessage(TC10, "apaga o lembrete de pagar"));
  assert.match(sent[sent.length - 1].text, /Qual deles você quer apagar\?/);
  await handleIncomingMessage(evolutionMessage(TC10, "1"));
  await handleIncomingMessage(evolutionMessage(TC10, "sim"));
  assert.equal(getReminderById(TC10, rem), undefined);
});

test("escolha de alvo: mais de 8 correspondencias mostra 8 e avisa que tem mais; gasto sem texto de busca usa o mais recente sem lista", async (t) => {
  const TC11 = "551100091111";
  seed(TC11);
  for (let i = 1; i <= 10; i++) createEvent({ fromNumber: TC11, title: `Aula ${i}`, start: futureAt(i, 10) });
  const cat = getOrCreateCategory(TC11, "Mercado");
  insertExpense({ fromNumber: TC11, amount: 1, description: "Primeiro gasto", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: TC11, amount: 2, description: "Ultimo gasto", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "aula" }]);
  await handleIncomingMessage(evolutionMessage(TC11, "cancela a aula"));
  const list = sent[0].text;
  assert.match(list, /Achei 10 eventos com "aula":/);
  assert.match(list, /8\. Aula 8/);
  assert.doesNotMatch(list, /9\. Aula 9/);
  assert.match(list, /Tem mais opções\. Diga o nome mais específico ou \*cancelar\*\./);
  await handleIncomingMessage(evolutionMessage(TC11, "cancelar"));

  queueReply([{ type: "edit_expense", field: "amount", value: "9" }]); // "muda o ultimo gasto pra 9": sem query nem list_ref
  await handleIncomingMessage(evolutionMessage(TC11, "muda o ultimo gasto pra 9"));
  assert.match(sent[sent.length - 1].text, /✏️ Ultimo gasto — R\$ 2,00/);
  assert.doesNotMatch(sent[sent.length - 1].text, /Achei/);
});

// ---------------------------------------------------------------------------
// Card 3: editar varios campos (e varios gastos) numa so mensagem, com validacao
// antes da confirmacao
// ---------------------------------------------------------------------------

test("card 3: varios campos de um gasto numa so confirmacao; categoria nova so nasce no '1'; desfaz volta tudo", async (t) => {
  const M1 = "551100091201";
  seed(M1);
  const alim = getOrCreateCategory(M1, "Alimentação");
  const dinheiro = getOrCreatePaymentMethod(M1, "Dinheiro");
  const pix = getOrCreatePaymentMethod(M1, "Pix");
  const exp = insertExpense({ fromNumber: M1, amount: 38, description: "Mercado multi", categoryId: alim.id, paymentMethodId: dinheiro.id, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([
    {
      type: "edit_expense",
      query: "mercado multi",
      changes: [
        { field: "amount", value: "45" },
        { field: "category", value: "Lazer multi" },
        { field: "payment_method", value: "pix" },
      ],
    },
  ]);
  await handleIncomingMessage(evolutionMessage(M1, "muda o mercado pra 45, categoria lazer multi e pix"));
  const preview = sent[0].text;
  assert.match(preview, /^✏️ Mercado multi — R\$ 38,00 · \d{2}\/\d{2} · Dinheiro\n/);
  assert.match(preview, /Valor: R\$ 38,00 → R\$ 45,00\n/);
  assert.match(preview, /Categoria: Alimentação → Lazer multi \(nova\)\n/);
  assert.match(preview, /Pagamento: Dinheiro → Pix\n/);
  assert.match(preview, /1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar$/);
  // nada gravado ainda -- nem o gasto, nem a categoria nova
  assert.equal(getExpenseById(M1, exp.id)?.amount, 38);
  assert.equal(findCategoryByName(M1, "Lazer multi"), null);

  await handleIncomingMessage(evolutionMessage(M1, "1"));
  assert.equal(sent[1].text, '✏️ "Mercado multi" atualizado: valor R$ 45,00; categoria Lazer multi; pagamento Pix.');
  const after = getExpenseById(M1, exp.id)!;
  assert.equal(after.amount, 45);
  assert.equal(after.payment_method_id, pix.id);
  assert.equal(after.category_id, findCategoryByName(M1, "Lazer multi")?.id);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(M1, "desfaz isso"));
  const undone = getExpenseById(M1, exp.id)!;
  assert.equal(undone.amount, 38);
  assert.equal(undone.category_id, alim.id);
  assert.equal(undone.payment_method_id, dinheiro.id);
});

test("card 3: cancelar a previa nao cria categoria nova nem muda o gasto", async (t) => {
  const M2 = "551100091202";
  seed(M2);
  const cat = getOrCreateCategory(M2, "Alimentação");
  const exp = insertExpense({ fromNumber: M2, amount: 10, description: "Padaria cancela", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "correct_category", category: "Categoria fantasma", query: "padaria cancela" }]);
  await handleIncomingMessage(evolutionMessage(M2, "padaria cancela é categoria fantasma"));
  assert.match(sent[0].text, /Categoria: Alimentação → Categoria fantasma \(nova\)/);
  await handleIncomingMessage(evolutionMessage(M2, "3"));
  assert.match(sent[1].text, /não mexi em nada/);
  assert.equal(findCategoryByName(M2, "Categoria fantasma"), null);
  assert.equal(getExpenseById(M2, exp.id)?.category_id, cat.id);
});

test("card 3: dois gastos na mesma mensagem = UMA confirmacao e UM desfazer", async (t) => {
  const M3 = "551100091203";
  seed(M3);
  const cat = getOrCreateCategory(M3, "Alimentação");
  const dinheiro = getOrCreatePaymentMethod(M3, "Dinheiro");
  const pix = getOrCreatePaymentMethod(M3, "Pix");
  const e1 = insertExpense({ fromNumber: M3, amount: 20, description: "Mercado lote", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });
  const e2 = insertExpense({ fromNumber: M3, amount: 30, description: "Uber lote", categoryId: cat.id, paymentMethodId: pix.id, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "edit_expense", query: "mercado lote", changes: [{ field: "payment_method", value: "Pix" }] },
    { type: "edit_expense", query: "uber lote", changes: [{ field: "payment_method", value: "Dinheiro" }] },
  ]);
  await handleIncomingMessage(evolutionMessage(M3, "o mercado foi no pix e o uber no dinheiro"));
  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].text,
    "✏️ Vou fazer 2 alterações:\n1. Mercado lote — Pagamento: Dinheiro → Pix\n2. Uber lote — Pagamento: Pix → Dinheiro\n\n1 ✅ Confirmar tudo\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );

  await handleIncomingMessage(evolutionMessage(M3, "1"));
  assert.equal(sent[1].text, "✏️ 2 gastos atualizados.");
  assert.equal(getExpenseById(M3, e1.id)?.payment_method_id, pix.id);
  assert.equal(getExpenseById(M3, e2.id)?.payment_method_id, dinheiro.id);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(M3, "desfaz isso"));
  assert.match(sent[2].text, /desfiz as alterações em 2 gasto/);
  assert.equal(getExpenseById(M3, e1.id)?.payment_method_id, dinheiro.id);
  assert.equal(getExpenseById(M3, e2.id)?.payment_method_id, pix.id);
});

test("card 3 RN09: se um gasto do lote mudou durante a confirmacao, nada e aplicado (tudo ou nada)", async (t) => {
  const M4 = "551100091204";
  seed(M4);
  const cat = getOrCreateCategory(M4, "Alimentação");
  const pix = getOrCreatePaymentMethod(M4, "Pix");
  const dinheiro = getOrCreatePaymentMethod(M4, "Dinheiro");
  const e1 = insertExpense({ fromNumber: M4, amount: 20, description: "Feira atomica", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });
  const e2 = insertExpense({ fromNumber: M4, amount: 30, description: "Onibus atomico", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "edit_expense", query: "feira atomica", changes: [{ field: "payment_method", value: "Pix" }] },
    { type: "edit_expense", query: "onibus atomico", changes: [{ field: "payment_method", value: "Pix" }] },
  ]);
  await handleIncomingMessage(evolutionMessage(M4, "feira e onibus foram no pix"));
  assert.match(sent[0].text, /Vou fazer 2 alterações/);

  // enquanto a confirmacao espera, o gasto 2 e alterado por fora
  expensesService.updateExpense(M4, e2.id, { amount: 40, description: "Onibus atomico", date: today(), categoryId: cat.id, paymentMethodId: dinheiro.id });
  await handleIncomingMessage(evolutionMessage(M4, "1"));
  assert.equal(sent[1].text, 'O gasto "Onibus atomico" mudou enquanto a gente conversava (agora está R$ 40,00). Me pede a alteração de novo.');
  assert.equal(getExpenseById(M4, e1.id)?.payment_method_id, dinheiro.id); // o 1 tambem nao foi aplicado
  assert.notEqual(getExpenseById(M4, e2.id)?.payment_method_id, pix.id);
});

test("card 3 RN07: mais de 5 gastos numa mensagem pede pra mandar 5 por vez e nao cria nada", async (t) => {
  const M5 = "551100091205";
  seed(M5);
  const cat = getOrCreateCategory(M5, "Alimentação");
  const names = ["Abacate", "Banana", "Cenoura", "Damasco", "Espinafre", "Figo"];
  for (const n of names) insertExpense({ fromNumber: M5, amount: 5, description: `${n} lote6`, categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply(names.map((n) => ({ type: "edit_expense" as const, query: `${n.toLowerCase()} lote6`, changes: [{ field: "amount" as const, value: "9" }] })));
  await handleIncomingMessage(evolutionMessage(M5, "muda os seis pra 9"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "Faço até 5 alterações por vez. Me manda as primeiras 5 e depois as outras.");
  await handleIncomingMessage(evolutionMessage(M5, "sim")); // nao ha confirmacao pendente
  assert.equal(findRecentExpense(M5, "abacate lote6")?.amount, 5);
});

test("card 3: no lote, gasto ambiguo recusa tudo e pede pra ser especifico", async (t) => {
  const M6 = "551100091206";
  seed(M6);
  const cat = getOrCreateCategory(M6, "Transporte");
  insertExpense({ fromNumber: M6, amount: 20, description: "Uber ida", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: M6, amount: 25, description: "Uber volta", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: M6, amount: 8, description: "Pedagio unico", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "edit_expense", query: "uber", changes: [{ field: "amount", value: "30" }] },
    { type: "edit_expense", query: "pedagio unico", changes: [{ field: "amount", value: "9" }] },
  ]);
  await handleIncomingMessage(evolutionMessage(M6, "uber 30 e pedagio 9"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Achei mais de um gasto parecido com "uber"/);
  assert.equal(findRecentExpense(M6, "pedagio unico")?.amount, 8);
});

test("card 3 RN05/RN06: valor e data invalidos sao recusados antes da previa", async (t) => {
  const M7 = "551100091207";
  seed(M7);
  const cat = getOrCreateCategory(M7, "Alimentação");
  const exp = insertExpense({ fromNumber: M7, amount: 12, description: "Almoco valida", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);

  const ask = async (changes: { field: "amount" | "date"; value: string }[], text: string) => {
    queueReply([{ type: "edit_expense", query: "almoco valida", changes }]);
    await handleIncomingMessage(evolutionMessage(M7, text));
    return sent[sent.length - 1].text;
  };

  assert.equal(await ask([{ field: "amount", value: "0" }], "muda pra 0"), "O valor precisa ser maior que R$ 0,00.");
  assert.equal(await ask([{ field: "amount", value: "-5" }], "muda pra -5"), "O valor precisa ser maior que R$ 0,00.");
  assert.match(await ask([{ field: "amount", value: "2000000" }], "muda pra 2000000"), /muito alto \(limite R\$ 1\.000\.000,00\)/);
  assert.equal(
    await ask([{ field: "date", value: "31/02" }], "foi dia 31/02"),
    `Essa data não parece certa (31/02/${today().slice(0, 4)}). Me manda o dia de novo, ex: 15/10 ou ontem.`
  );
  assert.match(await ask([{ field: "date", value: "01/01/2010" }], "foi em 2010"), /Essa data não parece certa \(01\/01\/2010\)/);
  assert.equal(getExpenseById(M7, exp.id)?.amount, 12);

  // dentro da janela vale: "ontem"
  const yesterday = addDaysToDateString(today(), -1);
  const preview = await ask([{ field: "date", value: "ontem" }], "foi ontem");
  assert.match(preview, new RegExp(`Data: \\d{2}/\\d{2} → ${yesterday.slice(8, 10)}/${yesterday.slice(5, 7)}`));
  await handleIncomingMessage(evolutionMessage(M7, "1"));
  assert.equal(getExpenseById(M7, exp.id)?.date, yesterday);
});

test("card 3: pedido que nao muda nada responde 'Ja esta assim' e nao deixa pendencia", async (t) => {
  const M8 = "551100091208";
  seed(M8);
  const cat = getOrCreateCategory(M8, "Lazer");
  insertExpense({ fromNumber: M8, amount: 50, description: "Cinema igual", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "cinema igual", changes: [{ field: "amount", value: "50" }, { field: "category", value: "lazer" }] }]);
  await handleIncomingMessage(evolutionMessage(M8, "cinema igual 50 lazer"));
  assert.equal(sent[0].text, "Já está assim, não mexi em nada.");
});

test("card 3 RN03: opcao 2 com varias mudancas pergunta QUAL corrigir e depois o novo valor", async (t) => {
  const M9 = "551100091209";
  seed(M9);
  const cat = getOrCreateCategory(M9, "Alimentação");
  const dinheiro = getOrCreatePaymentMethod(M9, "Dinheiro");
  const exp = insertExpense({ fromNumber: M9, amount: 38, description: "Mercado corrige", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "mercado corrige", changes: [{ field: "amount", value: "45" }, { field: "payment_method", value: "Pix" }] }]);
  await handleIncomingMessage(evolutionMessage(M9, "mercado 45 no pix"));

  await handleIncomingMessage(evolutionMessage(M9, "2"));
  assert.equal(sent[1].text, "Qual você quer corrigir?\n1 Valor\n2 Pagamento\n\nOu responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(M9, "xyz"));
  assert.match(sent[2].text, /Não entendi/);
  await handleIncomingMessage(evolutionMessage(M9, "1"));
  assert.match(sent[3].text, /Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(M9, "2000000")); // valor invalido: repete a pergunta
  assert.match(sent[4].text, /muito alto[\s\S]*Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(M9, "50"));
  assert.match(sent[5].text, /Valor: R\$ 38,00 → R\$ 50,00\nPagamento: Dinheiro → Pix/);
  await handleIncomingMessage(evolutionMessage(M9, "1"));
  assert.equal(getExpenseById(M9, exp.id)?.amount, 50);
});

test("card 3 RN10: edicao de evento na mesma mensagem fica pra depois quando ja ha confirmacao pendente", async (t) => {
  const M10 = "551100091210";
  seed(M10);
  const cat = getOrCreateCategory(M10, "Saúde");
  insertExpense({ fromNumber: M10, amount: 80, description: "Remedio rn10", categoryId: cat.id, paymentMethodId: null, date: today() });
  createEvent({ fromNumber: M10, title: "Consulta", start: `${nearFutureDateString()}T10:00:00-03:00` });

  const { sent, queueReply } = withMocks(t);
  queueReply([
    { type: "edit_expense", query: "remedio rn10", changes: [{ field: "amount", value: "90" }] },
    { type: "edit_event", query: "Consulta", new_title: "Consulta nova" },
  ]);
  await handleIncomingMessage(evolutionMessage(M10, "remedio 90 e muda a consulta pra consulta nova"));
  assert.match(sent[0].text, /Valor: R\$ 80,00 → R\$ 90,00/);
  assert.equal(sent[1].text, 'Deixei a alteração de "Consulta" pra depois: confirma a de "Remedio rn10" primeiro e me pede de novo.');
  await handleIncomingMessage(evolutionMessage(M10, "1"));
  assert.equal(findRecentExpense(M10, "remedio rn10")?.amount, 90);
});

test("card 3: formato antigo field/value continua funcionando", async (t) => {
  const M11 = "551100091211";
  seed(M11);
  const cat = getOrCreateCategory(M11, "Alimentação");
  const exp = insertExpense({ fromNumber: M11, amount: 10, description: "Legado antigo", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "legado antigo", field: "description", value: "Legado novo" }]);
  await handleIncomingMessage(evolutionMessage(M11, "renomeia o legado antigo pra legado novo"));
  assert.match(sent[0].text, /Nome: Legado antigo → Legado novo/);
  await handleIncomingMessage(evolutionMessage(M11, "1"));
  assert.equal(getExpenseById(M11, exp.id)?.description, "Legado novo");
});

// ---------------------------------------------------------------------------
// Card 4: menu guiado de campos (gasto, evento, lembrete e gasto fixo)
// ---------------------------------------------------------------------------

test("card 4 (a): editar -> Gasto -> numero -> '1 e 5' -> valor + pagamento -> previa -> 1 aplica e desfaz volta", async (t) => {
  const G1 = "551100091301";
  seed(G1);
  const cat = getOrCreateCategory(G1, "Alimentação");
  const dinheiro = getOrCreatePaymentMethod(G1, "Dinheiro");
  const pix = getOrCreatePaymentMethod(G1, "Pix");
  const padaria = insertExpense({ fromNumber: G1, amount: 12, description: "Padaria menu", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });
  insertExpense({ fromNumber: G1, amount: 38, description: "Mercado menu", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });

  const { sent, queueReply } = withMocks(t);
  await handleIncomingMessage(evolutionMessage(G1, "editar"));
  assert.match(sent[0].text, /7\. Gasto fixo \(lançado todo mês\)/);
  await handleIncomingMessage(evolutionMessage(G1, "1"));
  assert.match(sent[1].text, /^Seus últimos gastos:\n1\. Mercado menu — R\$ 38,00 · \d{2}\/\d{2} · Dinheiro\n2\. Padaria menu — R\$ 12,00/);

  await handleIncomingMessage(evolutionMessage(G1, "2"));
  assert.match(sent[2].text, /^✏️ Padaria menu — R\$ 12,00 · \d{2}\/\d{2} · Dinheiro\nO que você quer mudar\?\n1 Valor\n2 Nome\n3 Categoria\n4 Data\n5 Pagamento\n/);

  await handleIncomingMessage(evolutionMessage(G1, "1 e 5"));
  assert.equal(sent[3].text, "(1 de 2) Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");
  await handleIncomingMessage(evolutionMessage(G1, "45"));
  assert.match(sent[4].text, /^\(2 de 2\) Qual forma de pagamento\?\n1\. /);
  assert.match(sent[4].text, /\n\d\. Pix\n/);
  await handleIncomingMessage(evolutionMessage(G1, "Pix"));
  assert.match(sent[5].text, /^✏️ Padaria menu — R\$ 12,00 · \d{2}\/\d{2} · Dinheiro\nValor: R\$ 12,00 → R\$ 45,00\nPagamento: Dinheiro → Pix\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar$/);
  // nada foi gravado ate o "1"
  assert.equal(getExpenseById(G1, padaria.id)?.amount, 12);

  await handleIncomingMessage(evolutionMessage(G1, "1"));
  assert.equal(getExpenseById(G1, padaria.id)?.amount, 45);
  assert.equal(getExpenseById(G1, padaria.id)?.payment_method_id, pix.id);

  queueReply([{ type: "undo" }]);
  await handleIncomingMessage(evolutionMessage(G1, "desfaz isso"));
  assert.equal(getExpenseById(G1, padaria.id)?.amount, 12);
  assert.equal(getExpenseById(G1, padaria.id)?.payment_method_id, dinheiro.id);
});

test("card 4: escolher a opcao de pagamento pelo numero da lista", async (t) => {
  const G2 = "551100091302";
  seed(G2);
  const cat = getOrCreateCategory(G2, "Alimentação");
  const dinheiro = getOrCreatePaymentMethod(G2, "Dinheiro");
  getOrCreatePaymentMethod(G2, "Pix");
  const exp = insertExpense({ fromNumber: G2, amount: 12, description: "Lanche numero", categoryId: cat.id, paymentMethodId: dinheiro.id, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "lanche numero" }]);
  await handleIncomingMessage(evolutionMessage(G2, "edita o lanche numero"));
  assert.match(sent[0].text, /O que você quer mudar\?/);
  await handleIncomingMessage(evolutionMessage(G2, "pagamento"));
  const lines = sent[1].text.split("\n");
  const pixLine = lines.find((l) => /^\d+\. Pix$/.test(l))!;
  await handleIncomingMessage(evolutionMessage(G2, pixLine.split(".")[0]));
  assert.match(sent[2].text, /Pagamento: Dinheiro → Pix/);
  await handleIncomingMessage(evolutionMessage(G2, "1"));
  assert.equal(getExpenseById(G2, exp.id)?.payment_method_id, findPaymentMethodByName(G2, "Pix")?.id);
});

test("card 4: selecao invalida repete o menu; resposta invalida repete a pergunta; '3' e valor; cancelar nao muda nada", async (t) => {
  const G3 = "551100091303";
  seed(G3);
  const cat = getOrCreateCategory(G3, "Alimentação");
  const exp = insertExpense({ fromNumber: G3, amount: 20, description: "Almoco menu", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "almoco menu" }]);
  await handleIncomingMessage(evolutionMessage(G3, "edita o almoco menu"));

  await handleIncomingMessage(evolutionMessage(G3, "1 e 9"));
  assert.equal(sent[1].text, "Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.");
  await handleIncomingMessage(evolutionMessage(G3, "xyz"));
  assert.equal(sent[2].text, "Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.");

  await handleIncomingMessage(evolutionMessage(G3, "valor, pagamento")); // equivale a "1 e 5"
  assert.match(sent[3].text, /^\(1 de 2\) Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(G3, "abc"));
  assert.match(sent[4].text, /^Não entendi o valor "abc"\.\n\(1 de 2\) Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(G3, "2000000"));
  assert.match(sent[5].text, /muito alto[\s\S]*\(1 de 2\) Qual é o valor certo\?/);
  await handleIncomingMessage(evolutionMessage(G3, "3")); // "3" aqui e o valor R$ 3,00, nao "cancelar"
  assert.match(sent[6].text, /^\(2 de 2\) Qual forma de pagamento\?/);

  await handleIncomingMessage(evolutionMessage(G3, "cancelar"));
  assert.equal(sent[7].text, "Beleza, não mexi em nada.");
  assert.equal(getExpenseById(G3, exp.id)?.amount, 20);
  // nada ficou pendente
  queueReply([]);
  await handleIncomingMessage(evolutionMessage(G3, "1"));
  assert.equal(getExpenseById(G3, exp.id)?.amount, 20);
});

test("card 4: cancelar logo no menu de campos, e item apagado no meio do caminho", async (t) => {
  const G4 = "551100091304";
  seed(G4);
  const cat = getOrCreateCategory(G4, "Alimentação");
  insertExpense({ fromNumber: G4, amount: 20, description: "Item some menu", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "item some menu" }]);
  await handleIncomingMessage(evolutionMessage(G4, "edita o item some menu"));
  await handleIncomingMessage(evolutionMessage(G4, "cancelar"));
  assert.equal(sent[1].text, "Beleza, não mexi em nada.");

  queueReply([{ type: "edit_expense", query: "item some menu" }]);
  await handleIncomingMessage(evolutionMessage(G4, "edita o item some menu"));
  const gone = expensesService.findRecentExpense(G4, "item some menu")!;
  expensesService.deleteExpense(G4, gone.id);
  await handleIncomingMessage(evolutionMessage(G4, "1"));
  assert.equal(sent[sent.length - 1].text, "Esse item não existe mais.");
});

test("card 4 (a)+(b): evento -- lista numerada, menu de 3 campos, dia e hora + aviso, previa e aplica", async (t) => {
  const E1 = "551100091305";
  seed(E1);
  const a = createEvent({ fromNumber: E1, title: "Consulta A menu", start: futureAt(2, 10) });
  createEvent({ fromNumber: E1, title: "Consulta B menu", start: futureAt(3, 10) });

  const { sent } = withMocks(t);
  t.mock.method(aiInterpret, "extractDateTimeFromAnswer", async () => ({ newTime: "16:00" }));
  await handleIncomingMessage(evolutionMessage(E1, "editar"));
  await handleIncomingMessage(evolutionMessage(E1, "4"));
  assert.match(sent[1].text, /^Seus próximos eventos:\n1\. Consulta A menu — .*\n2\. Consulta B menu — /);
  assert.match(sent[1].text, /Qual deles você quer editar\?/);

  await handleIncomingMessage(evolutionMessage(E1, "1"));
  assert.match(sent[2].text, /^✏️ Consulta A menu — .*\nO que você quer mudar\?\n1 Dia e hora\n2 Título\n3 Aviso\n/);

  await handleIncomingMessage(evolutionMessage(E1, "dia e hora e aviso"));
  assert.match(sent[3].text, /^\(1 de 2\) Qual é a data e hora certas\?/);
  await handleIncomingMessage(evolutionMessage(E1, "16h"));
  assert.match(sent[4].text, /^\(2 de 2\) Quanto tempo antes devo avisar\?/);
  await handleIncomingMessage(evolutionMessage(E1, "40 dias")); // fora de 0 a 30 dias
  assert.match(sent[5].text, /Não entendi a antecedência "40 dias"[\s\S]*\(2 de 2\)/);
  await handleIncomingMessage(evolutionMessage(E1, "2 horas"));
  assert.match(sent[6].text, /^✏️ Consulta A menu\nQuando: .* → .*16:00\nAviso: 1 hora antes → 2 horas antes\n\n1 ✅ Confirmar/);

  await handleIncomingMessage(evolutionMessage(E1, "1"));
  const updated = getEventById(E1, a.id)!;
  assert.equal(updated.reminder_minutes, 120);
  assert.match(updated.start, /T16:00/);
});

test("card 4 (b): 'edita a consulta' com um so evento abre o menu direto; sem mudar nada de verdade avisa", async (t) => {
  const E2 = "551100091306";
  seed(E2);
  createEvent({ fromNumber: E2, title: "Dentista unico menu", start: futureAt(2, 10) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "dentista" }]);
  await handleIncomingMessage(evolutionMessage(E2, "edita o dentista"));
  assert.doesNotMatch(sent[0].text, /Achei/);
  assert.match(sent[0].text, /^✏️ Dentista unico menu — .*\nO que você quer mudar\?/);
  await handleIncomingMessage(evolutionMessage(E2, "titulo"));
  assert.match(sent[1].text, /^Qual é o novo título\?/);
  await handleIncomingMessage(evolutionMessage(E2, "Dentista unico menu")); // igual ao atual
  assert.equal(sent[2].text, "Já está assim, não mexi em nada.");
});

test("card 4: lembrete -- editar -> Lembrete -> numero -> Texto -> previa -> aplica", async (t) => {
  const R1 = "551100091307";
  seed(R1);
  const id = createReminder(R1, "Pagar luz menu", futureAt(1, 9));
  const { sent } = withMocks(t);
  await handleIncomingMessage(evolutionMessage(R1, "editar"));
  await handleIncomingMessage(evolutionMessage(R1, "5"));
  assert.match(sent[1].text, /^Seus lembretes:\n1\. Pagar luz menu — /);
  await handleIncomingMessage(evolutionMessage(R1, "1"));
  assert.match(sent[2].text, /O que você quer mudar\?\n1 Dia e hora\n2 Texto\n/);
  await handleIncomingMessage(evolutionMessage(R1, "2"));
  assert.match(sent[3].text, /^Qual é o novo texto\?/);
  await handleIncomingMessage(evolutionMessage(R1, "Pagar energia menu"));
  assert.match(sent[4].text, /Texto: Pagar luz menu → Pagar energia menu/);
  await handleIncomingMessage(evolutionMessage(R1, "1"));
  assert.equal(getReminderById(R1, id)?.message, "Pagar energia menu");
});

test("card 4: gasto fixo -- lista numerada quando 2 batem; categoria nova so e criada no '1' (e cancelar nao cria)", async (t) => {
  const F1 = "551100091308";
  seed(F1);
  const saude = getOrCreateCategory(F1, "Saúde");
  const smart = createRecurringExpense({ fromNumber: F1, description: "Academia Smart", amount: 89.9, categoryId: saude.id, paymentMethodId: null, dayOfMonth: 5 });
  createRecurringExpense({ fromNumber: F1, description: "Academia Kids", amount: 50, categoryId: saude.id, paymentMethodId: null, dayOfMonth: 10 });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_recurring_expense", query: "academia" }]);
  await handleIncomingMessage(evolutionMessage(F1, "edita o gasto fixo da academia"));
  assert.match(sent[0].text, /^Achei 2 gastos fixos com "academia":\n1\. Academia Smart — R\$ 89,90 · todo dia 5\n2\. Academia Kids — R\$ 50,00 · todo dia 10/);
  await handleIncomingMessage(evolutionMessage(F1, "1"));
  assert.match(sent[1].text, /^✏️ Academia Smart — R\$ 89,90 · todo dia 5\nO que você quer mudar\?\n1 Nome\n2 Valor\n3 Categoria\n4 Dia do mês\n5 Pagamento/);

  await handleIncomingMessage(evolutionMessage(F1, "3 e 4"));
  assert.match(sent[2].text, /^\(1 de 2\) Qual categoria\?\n1\. /);
  await handleIncomingMessage(evolutionMessage(F1, "Fitness novo menu"));
  assert.match(sent[3].text, /^\(2 de 2\) Qual é o dia do mês certo\?/);
  await handleIncomingMessage(evolutionMessage(F1, "12"));
  assert.match(sent[4].text, /Dia do mês: 5 → 12\nCategoria: Saúde → Fitness novo menu \(nova\)\n/);
  assert.equal(findCategoryByName(F1, "Fitness novo menu"), null);

  await handleIncomingMessage(evolutionMessage(F1, "3")); // cancela
  assert.equal(findCategoryByName(F1, "Fitness novo menu"), null);
  assert.equal(getRecurringExpenseById(F1, smart.id)?.day_of_month, 5);

  // mesmo fluxo pelo caminho da IA (frase pronta): so cria no "1"
  queueReply([{ type: "edit_recurring_expense", query: "academia smart", new_category: "Fitness novo menu", new_payment_method: "Cripto menu" }]);
  await handleIncomingMessage(evolutionMessage(F1, "muda a categoria da academia smart pra fitness novo menu e pagamento cripto menu"));
  assert.match(sent[sent.length - 1].text, /Categoria: Saúde → Fitness novo menu \(nova\)\nForma de pagamento: — → Cripto menu \(nova\)/);
  assert.equal(findCategoryByName(F1, "Fitness novo menu"), null);
  assert.equal(findPaymentMethodByName(F1, "Cripto menu"), null);
  await handleIncomingMessage(evolutionMessage(F1, "1"));
  const after = getRecurringExpenseById(F1, smart.id)!;
  assert.equal(after.category_id, findCategoryByName(F1, "Fitness novo menu")?.id);
  assert.equal(after.payment_method_id, findPaymentMethodByName(F1, "Cripto menu")?.id);
});

test("card 4 (c): lista de gastos aberta + 'edita o 2' sem dizer o que mudar abre o menu do gasto 2", async (t) => {
  const L1 = "551100091309";
  seed(L1);
  const cat = getOrCreateCategory(L1, "Alimentação");
  insertExpense({ fromNumber: L1, amount: 10, description: "Primeiro lista menu", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: L1, amount: 20, description: "Segundo lista menu", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "list_expenses", date: today() }]);
  await handleIncomingMessage(evolutionMessage(L1, "quais gastos eu tive hoje"));
  queueReply([{ type: "edit_expense", list_ref: 2 }]);
  await handleIncomingMessage(evolutionMessage(L1, "edita o 2"));
  // lista mostra o mais recente primeiro: o 2 e o "Primeiro lista menu"
  assert.match(sent[1].text, /^✏️ Primeiro lista menu — R\$ 10,00/);
  assert.match(sent[1].text, /O que você quer mudar\?/);
  await handleIncomingMessage(evolutionMessage(L1, "cancelar"));
});

test("card 4: pedido novo e longo com verbo de edicao descarta o menu com aviso de uma linha", async (t) => {
  const D1 = "551100091310";
  seed(D1);
  const cat = getOrCreateCategory(D1, "Alimentação");
  insertExpense({ fromNumber: D1, amount: 30, description: "Mercado descarta", categoryId: cat.id, paymentMethodId: null, date: today() });
  insertExpense({ fromNumber: D1, amount: 8, description: "Cafe descarta", categoryId: cat.id, paymentMethodId: null, date: today() });

  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_expense", query: "mercado descarta" }]);
  await handleIncomingMessage(evolutionMessage(D1, "edita o mercado descarta"));
  assert.match(sent[0].text, /O que você quer mudar\?/);

  queueReply([{ type: "edit_expense", query: "cafe descarta", changes: [{ field: "amount", value: "9" }] }]);
  await handleIncomingMessage(evolutionMessage(D1, "muda o valor do cafe descarta pra 9"));
  assert.equal(sent[1].text, 'Cancelei a alteração de "Mercado descarta" e entendi seu novo pedido.');
  assert.match(sent[2].text, /Valor: R\$ 8,00 → R\$ 9,00/);
  await handleIncomingMessage(evolutionMessage(D1, "3"));
});

test("card 4: 'editar' sem nada cadastrado, e mais de 8 itens mostra 8 e avisa que tem mais", async (t) => {
  const N1 = "551100091311";
  const N2 = "551100091312";
  seed(N1, N2);
  for (let i = 1; i <= 10; i++) createEvent({ fromNumber: N2, title: `Aula menu ${i}`, start: futureAt(i, 10) });

  const { sent } = withMocks(t);
  for (const [option, text] of [
    ["1", "Você ainda não tem nenhum gasto registrado pra editar."],
    ["4", "Você não tem nenhum evento futuro pra editar."],
    ["5", "Você não tem nenhum lembrete pendente pra editar."],
    ["7", "Você não tem nenhum gasto fixo pra editar."],
  ] as const) {
    await handleIncomingMessage(evolutionMessage(N1, "editar"));
    await handleIncomingMessage(evolutionMessage(N1, option));
    assert.equal(sent[sent.length - 1].text, text);
  }

  await handleIncomingMessage(evolutionMessage(N2, "editar"));
  await handleIncomingMessage(evolutionMessage(N2, "4"));
  const list = sent[sent.length - 1].text;
  assert.match(list, /8\. Aula menu 8/);
  assert.doesNotMatch(list, /9\. Aula menu 9/);
  assert.match(list, /Tem mais opções\. Diga o nome mais específico ou \*cancelar\*\./);
  await handleIncomingMessage(evolutionMessage(N2, "cancelar"));
});

// Incidente real (556199210718): "1 e 5" respondido na LISTA de gastos (e nao no menu
// de campos) caia em "refino" e o bot so dizia "Nao entendi".
test("lista de itens: '1 e 5' pede um item por vez e mantem a lista", async (t) => {
  const ML = "551100091401";
  seed(ML);
  const cat = getOrCreateCategory(ML, "Alimentação");
  insertExpense({ fromNumber: ML, amount: 10, description: "Item multi lista", categoryId: cat.id, paymentMethodId: null, date: today() });
  const { sent } = withMocks(t);
  await handleIncomingMessage(evolutionMessage(ML, "editar"));
  await handleIncomingMessage(evolutionMessage(ML, "1"));
  await handleIncomingMessage(evolutionMessage(ML, "1 e 5"));
  assert.equal(sent[2].text, "Escolhe um item por vez: responde só um número de 1 a 1, ou *cancelar*. Depois eu mostro o que dá pra mudar.");
  await handleIncomingMessage(evolutionMessage(ML, "1")); // a lista continua valendo
  assert.match(sent[3].text, /O que você quer mudar\?/);
  await handleIncomingMessage(evolutionMessage(ML, "cancelar"));
});
