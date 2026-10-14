// Card 13: cadastro de gasto fixo e alerta de conta pelo WhatsApp -- mensagens completas, incompletas e
// ambiguas, previa 1/2/3, duplicata, mes corrente, reinicio, expiracao e desfazer. Nada e gravado antes do "1".
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import cron from "node-cron";
import * as whatsappClient from "../../src/whatsapp/client";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createRecurringExpense, listRecurringExpenses, getRecurringExpenseById } from "../../src/expenses/recurring";
import { createBillAlert, listBillAlerts } from "../../src/bills/service";
import { startRecurringExpenseScheduler } from "../../src/expenses/recurringScheduler";
import { addDaysToDateString, spDateString } from "../../src/timeSP";
import { db } from "../../src/db";
import { CANCELLED_TEXT } from "../../src/recurrence/messages";
import { NOT_UNDERSTOOD_TEXT, formatShortDate } from "../../src/confirmation/preview";
import { PENDING_EXIT_HINT } from "../../src/pending/newRequest";

const at = (iso: string) => new Date(iso).getTime();
const EARLY = at("2026-10-05T12:00:00-03:00"); // antes de qualquer dia 10: nada "passou"
const LATE = at("2026-10-15T12:00:00-03:00"); // depois do dia 10

function seed(...numbers: string[]) {
  for (const n of numbers) {
    ensureUserSeeded(n);
    allowNumber(n);
    setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  }
}

const pendingKinds = (n: string) =>
  (db.prepare(`SELECT kind FROM pending_state WHERE from_number = ? AND kind <> 'undo' ORDER BY kind`).all(n) as { kind: string }[]).map((r) => r.kind);
const expensesLike = (n: string, text: string) => db.prepare(`SELECT * FROM expenses WHERE from_number = ? AND description LIKE ?`).all(n, `%${text}%`) as { id: number; amount: number; date: string }[];

const unknownRec = (extra: Partial<Extract<Interpretation, { type: "unknown" }>> = {}): Interpretation => ({ type: "unknown", likely_intent: "recurring_expense", ...extra });
const completeRec = (extra: { description?: string; amount?: number; day_of_month?: number; category?: string } = {}): Interpretation => ({
  type: "set_recurring_expense",
  description: extra.description ?? "internet",
  amount: extra.amount ?? 100,
  category: extra.category ?? "Moradia",
  day_of_month: extra.day_of_month ?? 10,
});

const ASK_FIRST = "Qual é o gasto fixo? Pode mandar tudo junto, ex: *internet 100 dia 10*. Ou responde *cancelar*.";

// manda a mensagem de cadastro (a IA devolve "action") e devolve a resposta
async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

test("Card 13: 'Cadastrar gasto fixo' (e 'Cadatrar', com erro) pergunta o gasto fixo e NAO grava nada", async (t) => {
  const N = "551100095001";
  seed(N);
  const app = bootApp(t, EARLY);
  for (const text of ["Cadastrar gasto fixo", "Cadatrar gasto fixo"]) {
    assert.equal(await say(app, N, text, unknownRec()), ASK_FIRST, text);
    assert.deepEqual(pendingKinds(N), ["create_recurrence"]);
    assert.equal(listRecurringExpenses(N).length, 0);
    await say(app, N, "cancelar");
    assert.equal(app.last(), CANCELLED_TEXT);
  }
});

test("Card 13: 'internet 100 dia 10' como resposta vai direto pra previa; '1' grava uma unica vez", async (t) => {
  const N = "551100095002";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "Cadastrar gasto fixo", unknownRec());
  app.calls.length = 0;
  const preview = await say(app, N, "internet 100 dia 10");
  assert.match(preview, /^🔁 Cadastrar gasto fixo\nInternet — R\$ 100,00 · todo dia 10\n/);
  assert.match(preview, /Vou lançar sozinho todo mês, às 7h do dia 10\.\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar$/);
  assert.deepEqual(app.calls, [], "responder o preenchimento nao chama a IA");
  assert.equal(listRecurringExpenses(N).length, 0, "nada gravado antes do 1");

  await say(app, N, "1");
  assert.match(app.last(), /^🔁 Gasto fixo cadastrado: R\$ 100,00 .*Internet, todo dia 10\. Vou lançar esse valor todo dia 10 às 7h\./);
  assert.match(app.last(), /Errou\? Responde \*desfazer\*\./);
  const rows = listRecurringExpenses(N);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Internet");
  assert.equal(rows[0].amount, 100);
  assert.equal(rows[0].day_of_month, 10);
  assert.equal(rows[0].last_run_month, null, "o cron lanca no dia 10");

  await say(app, N, "1"); // resposta repetida: nao grava de novo
  assert.equal(listRecurringExpenses(N).length, 1);
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 13: '15 reais gasto fixo dia 10' pergunta so o nome; 'academia' leva a previa", async (t) => {
  const N = "551100095003";
  seed(N);
  const app = bootApp(t, EARLY);
  assert.equal(
    await say(app, N, "15 reais gasto fixo dia 10", unknownRec({ amount: 15, day_of_month: 10 })),
    "Qual é o nome desse gasto fixo de R$ 15,00 (todo dia 10)? (ex: internet, academia) Ou responde *cancelar*."
  );
  const preview = await say(app, N, "academia");
  assert.match(preview, /^🔁 Cadastrar gasto fixo\nAcademia — R\$ 15,00 · todo dia 10\n/);
});

test("Card 13: '15 reais gasto fixo' pergunta o nome e depois o dia", async (t) => {
  const N = "551100095004";
  seed(N);
  const app = bootApp(t, EARLY);
  assert.match(await say(app, N, "15 reais gasto fixo", unknownRec({ amount: 15 })), /^Qual é o nome desse gasto fixo de R\$ 15,00\? \(ex: internet, academia\)/);
  assert.match(await say(app, N, "academia"), /^Em que dia do mês devo lançar Academia\? \(1 a 31\)/);
  assert.match(await say(app, N, "10"), /^🔁 Cadastrar gasto fixo\nAcademia — R\$ 15,00 · todo dia 10\n/);
});

test("Card 13: 'gasto fixo internet dia 10' pergunta so o valor", async (t) => {
  const N = "551100095005";
  seed(N);
  const app = bootApp(t, EARLY);
  assert.match(await say(app, N, "gasto fixo internet dia 10", unknownRec({ description: "Internet", day_of_month: 10 })), /^Qual é o valor de Internet \(todo dia 10\)\? \(ex: 100 ou 99,90\)/);
  assert.match(await say(app, N, "R$ 1.250,90"), /Internet — R\$ 1\.250,90 · todo dia 10/);
});

test("Card 13: cadastro completo ('todo dia 10 pago 50 de internet') vai direto pra previa", async (t) => {
  const N = "551100095006";
  seed(N);
  const app = bootApp(t, EARLY);
  const preview = await say(app, N, "todo dia 10 pago 50 de internet", completeRec({ amount: 50 }));
  assert.match(preview, /^🔁 Cadastrar gasto fixo\ninternet — R\$ 50,00 · todo dia 10\nCategoria: Moradia · Pagamento: Pix\n/);
  assert.equal(listRecurringExpenses(N).length, 0);
});

test("Card 13: 'conta fixa, ração a cada 45 dias' vira ALERTA por intervalo; so grava em bill_alerts depois do 1", async (t) => {
  const N = "551100095007";
  seed(N);
  const app = bootApp(t, EARLY);
  const next = formatShortDate(addDaysToDateString("2026-10-05", 45));
  const preview = await say(app, N, "conta fixa, ração a cada 45 dias", { type: "set_bill_alert", description: "Ração", interval_days: 45 });
  assert.equal(preview, `📌 Cadastrar alerta\nRação — a cada 45 dias (próximo aviso: ${next})\nVou te perguntar "já fez?" nesse dia. Não lanço gasto.\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar`);
  assert.equal(listBillAlerts(N).length, 0);
  assert.equal(listRecurringExpenses(N).length, 0);
  await say(app, N, "1");
  assert.match(app.last(), /^📌 Alerta cadastrado: a cada 45 dias/);
  const bills = listBillAlerts(N);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].recurrence_type, "interval");
  assert.equal(bills[0].interval_days, 45);
  assert.equal(listRecurringExpenses(N).length, 0, "nao virou gasto fixo");
});

test("Card 13: 'me lembra da luz todo dia 5' vira alerta por dia do mes", async (t) => {
  const N = "551100095008";
  seed(N);
  const app = bootApp(t, EARLY);
  assert.match(await say(app, N, "me lembra da luz todo dia 5", { type: "set_bill_alert", description: "Luz", day_of_month: 5 }), /^📌 Cadastrar alerta\nLuz — todo dia 5\n/);
  await say(app, N, "1");
  assert.equal(listBillAlerts(N)[0].day_of_month, 5);
});

test("Card 13: 'conta fixa internet dia 10' pergunta 1/2/3 e segue o caminho escolhido", async (t) => {
  const N = "551100095009";
  const N2 = "551100095010";
  seed(N, N2);
  const app = bootApp(t, EARLY);
  const question = "Como você quer cadastrar *Internet* (todo dia 10)?\n1 🔁 Lançar o gasto sozinho todo mês (preciso do valor)\n2 📌 Só me avisar no dia\n3 ❌ Cancelar";
  const unclear: Interpretation = { type: "unknown", likely_intent: "recurring_unclear", description: "Internet", day_of_month: 10 };

  assert.equal(await say(app, N, "conta fixa internet dia 10", unclear), question);
  assert.match(await say(app, N, "1"), /^Qual é o valor de Internet/);
  assert.match(await say(app, N, "100"), /^🔁 Cadastrar gasto fixo\nInternet — R\$ 100,00 · todo dia 10/);

  assert.equal(await say(app, N2, "conta fixa internet dia 10", unclear), question);
  assert.match(await say(app, N2, "2"), /^📌 Cadastrar alerta\nInternet — todo dia 10\n/);
  await say(app, N2, "1");
  assert.equal(listBillAlerts(N2).length, 1);
  assert.equal(listRecurringExpenses(N2).length, 0);

  // 3 cancela
  const N3 = "551100095011";
  seed(N3);
  await say(app, N3, "conta fixa internet dia 10", unclear);
  assert.equal(await say(app, N3, "3"), CANCELLED_TEXT);
  assert.deepEqual(pendingKinds(N3), []);
});

test("Card 13: 'ração 80 reais a cada 45 dias' cria ALERTA e avisa que o valor nao e guardado", async (t) => {
  const N = "551100095012";
  seed(N);
  const app = bootApp(t, EARLY);
  const preview = await say(app, N, "ração 80 reais a cada 45 dias", unknownRec({ description: "Ração", amount: 80, interval_days: 45 }));
  assert.match(preview, /^📌 Cadastrar alerta\nRação — a cada 45 dias/);
  assert.match(preview, /Gasto fixo só funciona por dia do mês, então vou só te avisar a cada 45 dias \(o valor não é guardado\)\./);
  await say(app, N, "1");
  assert.equal(listBillAlerts(N).length, 1);
  assert.equal(listRecurringExpenses(N).length, 0);
});

test("Card 13: '3' e 'cancelar' em qualquer etapa nao gravam nada e respondem 'Beleza, nao cadastrei nada.'", async (t) => {
  const N = "551100095013";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  assert.equal(await say(app, N, "3"), CANCELLED_TEXT);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  assert.equal(await say(app, N, "cancelar"), CANCELLED_TEXT);
  await say(app, N, "cadastrar gasto fixo", unknownRec());
  assert.equal(await say(app, N, "cancelar"), CANCELLED_TEXT);
  assert.equal(listRecurringExpenses(N).length, 0);
  assert.deepEqual(pendingKinds(N), []);
  // depois de cancelar nao sobra confirmacao: o "1" nao grava
  await say(app, N, "1");
  assert.equal(listRecurringExpenses(N).length, 0);
});

test("Card 13: opcao 2 da previa corrige valor, nome e dia, e mostra a previa de novo; alerta corrige o 'quando'", async (t) => {
  const N = "551100095014";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  assert.equal(await say(app, N, "2"), "Qual você quer corrigir?\n1 Nome\n2 Valor\n3 Dia do mês\n4 Categoria\n5 Pagamento\n\nOu responde *cancelar*.");
  assert.match(await say(app, N, "2"), /Qual é o valor certo\?/);
  assert.match(await say(app, N, "120"), /internet — R\$ 120,00 · todo dia 10/);
  await say(app, N, "2");
  await say(app, N, "um"); // numero por extenso: Nome
  assert.match(await say(app, N, "Fibra"), /Fibra — R\$ 120,00/);
  await say(app, N, "2");
  await say(app, N, "3");
  assert.match(await say(app, N, "40"), /^O dia precisa ser de 1 a 31\./); // invalido: pergunta de novo
  assert.match(await say(app, N, "15"), /Fibra — R\$ 120,00 · todo dia 15/);
  await say(app, N, "1");
  const rows = listRecurringExpenses(N);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 120);
  assert.equal(rows[0].description, "Fibra");

  const A = "551100095015";
  seed(A);
  await say(app, A, "me lembra da luz todo dia 5", { type: "set_bill_alert", description: "Luz", day_of_month: 5 });
  await say(app, A, "2");
  assert.match(await say(app, A, "2"), /^Quando devo te avisar\?/);
  assert.match(await say(app, A, "a cada 30 dias"), /^📌 Cadastrar alerta\nLuz — a cada 30 dias \(próximo aviso: 04\/11\)/);
});

test("Card 13: dia 40, valor 0 e intervalo 0 explicam e perguntam de novo, sem encerrar o fluxo", async (t) => {
  const N = "551100095016";
  seed(N);
  const app = bootApp(t, EARLY);
  const q = await say(app, N, "gasto fixo internet 100 dia 40", unknownRec({ description: "Internet", amount: 100, day_of_month: 40 }));
  assert.equal(q, "O dia precisa ser de 1 a 31.\nEm que dia do mês devo lançar Internet? (1 a 31) Ou responde *cancelar*.");
  assert.match(await say(app, N, "50"), /^O dia precisa ser de 1 a 31\.\nEm que dia do mês/);
  assert.match(await say(app, N, "10"), /^🔁 Cadastrar gasto fixo\nInternet — R\$ 100,00 · todo dia 10/);

  const V = "551100095017";
  seed(V);
  await say(app, V, "gasto fixo internet dia 10", unknownRec({ description: "Internet", day_of_month: 10 }));
  assert.match(await say(app, V, "0"), /^O valor precisa ser maior que R\$ 0,00\.\nQual é o valor de Internet/);
  assert.match(await say(app, V, "100"), /^🔁 Cadastrar gasto fixo/);

  const I = "551100095018";
  seed(I);
  await say(app, I, "me lembra da ração", { type: "set_bill_alert", description: "Ração" });
  assert.match(await say(app, I, "a cada 0 dias"), /^O intervalo precisa ser de pelo menos 1 dia\.\nQuando devo te avisar de Ração\?/);
  assert.match(await say(app, I, "a cada 45 dias"), /^📌 Cadastrar alerta\nRação — a cada 45 dias/);
  assert.equal(listRecurringExpenses(N).length + listBillAlerts(I).length, 0);
});

test("Card 13: duplicata de gasto fixo -- 1 cadastra outro, 2 atualiza o existente (previa do Card 1), 3 cancela", async (t) => {
  const N = "551100095019";
  seed(N);
  const existing = createRecurringExpense({ fromNumber: N, description: "Internet", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 10 });
  const app = bootApp(t, EARLY);
  const question = "Você já tem *Internet — R$ 100,00 · todo dia 10*. O que faço?\n1 ➕ Cadastrar outro mesmo assim\n2 ✏️ Atualizar o que já existe\n3 ❌ Cancelar";

  // 2: abre a edicao do existente com os valores novos
  assert.equal(await say(app, N, "internet 120 dia 10", completeRec({ description: "internet", amount: 120 })), question);
  assert.equal(listRecurringExpenses(N).length, 1);
  const edit = await say(app, N, "2");
  assert.match(edit, /Valor: R\$ 100,00 → R\$ 120,00/);
  assert.match(edit, /1 ✅ Confirmar/);
  await say(app, N, "1");
  assert.equal(getRecurringExpenseById(N, existing.id)?.amount, 120);
  assert.equal(listRecurringExpenses(N).length, 1, "atualizou, nao duplicou");

  // 1: cadastra outro mesmo assim
  await say(app, N, "internet 130 dia 12", completeRec({ description: "internet fibra", amount: 130, day_of_month: 12 }));
  assert.match(app.last(), /^Você já tem \*Internet — R\$ 120,00 · todo dia 10\*/, "nome parecido tambem e duplicata");
  assert.match(await say(app, N, "1"), /^🔁 Cadastrar gasto fixo\ninternet fibra — R\$ 130,00/);
  await say(app, N, "1");
  assert.equal(listRecurringExpenses(N).length, 2);

  // 3: cancela
  await say(app, N, "internet 140 dia 14", completeRec({ description: "internet", amount: 140, day_of_month: 14 }));
  assert.equal(await say(app, N, "3"), CANCELLED_TEXT);
  assert.equal(listRecurringExpenses(N).length, 2);
});

test("Card 13: duplicata acha o nome sem acento/caixa ('Água' x 'agua') e atualiza o alerta existente", async (t) => {
  const N = "551100095020";
  seed(N);
  const bill = createBillAlert({ fromNumber: N, name: "Água", dayOfMonth: 5 });
  const app = bootApp(t, EARLY);
  assert.match(await say(app, N, "me lembra da agua todo dia 8", { type: "set_bill_alert", description: "agua", day_of_month: 8 }), /^Você já tem o alerta \*Água — todo dia 5\*\./);
  assert.match(await say(app, N, "2"), /^✏️ Alerta atualizado: "Água" — todo dia 8\./);
  assert.equal(listBillAlerts(N).length, 1);
  assert.equal(listBillAlerts(N)[0].id, bill.id);
  assert.equal(listBillAlerts(N)[0].day_of_month, 8);
});

test("Card 13: mes corrente -- dia 10 ja passou (hoje dia 15): 1 lanca o deste mes, 2 so no proximo, 3 cancela", async (t) => {
  const A = "551100095021";
  const B = "551100095022";
  const C = "551100095023";
  seed(A, B, C);
  const app = bootApp(t, LATE);
  const question = "O dia 10 já passou neste mês. Quer que eu lance o deste mês agora?\n1 ✅ Sim, lançar R$ 100,00 (10/10)\n2 ➡️ Não, só a partir do mês que vem\n3 ❌ Cancelar o cadastro";

  await say(app, A, "internet 100 dia 10", completeRec());
  assert.equal(await say(app, A, "1"), question);
  assert.equal(listRecurringExpenses(A).length, 0, "ainda nao gravou");
  await say(app, A, "1");
  assert.equal(listRecurringExpenses(A).length, 1);
  assert.equal(listRecurringExpenses(A)[0].last_run_month, "2026-10");
  const launched = expensesLike(A, "internet");
  assert.equal(launched.length, 1);
  assert.equal(launched[0].date, "2026-10-10", "datado do dia do vencimento");
  assert.equal(launched[0].amount, 100);
  assert.ok(app.sent.some((m) => m.to === A && m.text.startsWith("🔁 Gasto fixo lançado: R$100.00")));

  await say(app, B, "internet 100 dia 10", completeRec());
  await say(app, B, "1");
  await say(app, B, "2");
  assert.equal(listRecurringExpenses(B).length, 1);
  assert.equal(listRecurringExpenses(B)[0].last_run_month, "2026-10", "nada lanca neste mes");
  assert.equal(expensesLike(B, "internet").length, 0);

  await say(app, C, "internet 100 dia 10", completeRec());
  await say(app, C, "1");
  assert.equal(await say(app, C, "3"), CANCELLED_TEXT);
  assert.equal(listRecurringExpenses(C).length, 0);
});

test("Card 13: mes corrente -- dia ainda nao chegou, 06:59 e 07:00 do dia, e dia 31 em mes de 30 dias", async (t) => {
  const cases: { now: string; day: number; asks: boolean; label: string }[] = [
    { now: "2026-10-08T12:00:00-03:00", day: 10, asks: false, label: "dia 8, vencimento dia 10" },
    { now: "2026-10-10T06:59:00-03:00", day: 10, asks: false, label: "06:59 do dia" },
    { now: "2026-10-10T07:00:00-03:00", day: 10, asks: true, label: "07:00 do dia" },
    { now: "2026-11-30T12:00:00-03:00", day: 31, asks: true, label: "dia 31 num mes de 30 dias, hoje 30" },
    { now: "2026-11-29T12:00:00-03:00", day: 31, asks: false, label: "dia 31 num mes de 30 dias, hoje 29" },
  ];
  const app = bootApp(t, EARLY);
  for (const [i, c] of cases.entries()) {
    const N = `55110009503${i}`;
    seed(N);
    app.setNow(at(c.now));
    await say(app, N, `internet 100 dia ${c.day}`, completeRec({ day_of_month: c.day }));
    await say(app, N, "1");
    const asked = /já passou neste mês/.test(app.last());
    assert.equal(asked, c.asks, c.label);
    assert.equal(listRecurringExpenses(N).length, c.asks ? 0 : 1, c.label);
    if (!c.asks) assert.equal(listRecurringExpenses(N)[0].last_run_month, null, `${c.label}: o cron lanca no dia`);
  }
});

test("Card 13: reinicio do servidor com a previa aberta -- o '1' ainda confirma (nada em memoria)", async (t) => {
  const N = "551100095040";
  seed(N);
  let app = bootApp(t, EARLY);
  await say(app, N, "cadastrar gasto fixo", unknownRec());
  app = bootApp(t); // reinicio no meio do preenchimento
  assert.match(await say(app, N, "internet 100 dia 10"), /^🔁 Cadastrar gasto fixo/);
  app = bootApp(t); // reinicio com a previa aberta
  await say(app, N, "1");
  assert.match(app.last(), /Gasto fixo cadastrado/);
  assert.equal(listRecurringExpenses(N).length, 1);
});

test("Card 13: 10 minutos sem resposta -- nada e gravado e o aviso de expiracao vem quando o usuario escreve", async (t) => {
  const N = "551100095041";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  const before = app.sent.length;
  app.advance(11 * 60 * 1000);
  assert.equal(app.sent.length, before, "nenhum aviso espontaneo");
  await say(app, N, "1");
  assert.match(app.last(), /A confirmação de "internet" expirou/);
  assert.equal(listRecurringExpenses(N).length, 0);
});

test("Card 13 + Card 12: pedido novo com o cadastro aberto -- consulta troca; editar/apagar mantem a previa com a dica", async (t) => {
  const N = "551100095042";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  assert.equal(await say(app, N, "apaga o gasto internet", { type: "delete_expense", query: "internet" }), `${NOT_UNDERSTOOD_TEXT.split("\n")[0]}\n${PENDING_EXIT_HINT}`);
  assert.deepEqual(pendingKinds(N), ["create_recurrence"]);
  await say(app, N, "quanto gastei esse mês", { type: "expense_report", period: "month" });
  assert.ok(app.sent.some((m) => m.text === 'Deixei a pergunta sobre "internet" de lado e entendi seu novo pedido.'));
  assert.deepEqual(pendingKinds(N), []);
  assert.equal(listRecurringExpenses(N).length, 0);
});

test("Card 13: desfazer logo depois de cadastrar desativa o gasto fixo e o alerta", async (t) => {
  const N = "551100095043";
  const A = "551100095044";
  seed(N, A);
  const app = bootApp(t, EARLY);
  await say(app, N, "todo dia 10 pago 100 de internet", completeRec());
  await say(app, N, "1");
  assert.equal(listRecurringExpenses(N).length, 1);
  await say(app, N, "desfaz isso", { type: "undo" });
  assert.match(app.last(), /↩️ Prontinho, o gasto fixo "internet" não vai mais ser lançado\./);
  assert.equal(listRecurringExpenses(N).length, 0);

  await say(app, A, "me lembra da luz todo dia 5", { type: "set_bill_alert", description: "Luz", day_of_month: 5 });
  await say(app, A, "1");
  await say(app, A, "desfaz isso", { type: "undo" });
  assert.match(app.last(), /↩️ Prontinho, o alerta de "Luz" foi removido\./);
  assert.equal(listBillAlerts(A).length, 0);
});

test("Card 13: mais de um cadastro na mesma mensagem -- cuida do primeiro e avisa", async (t) => {
  const N = "551100095045";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "internet 100 dia 10 e luz 80 dia 5", completeRec(), completeRec({ description: "luz", amount: 80, day_of_month: 5 }));
  assert.match(app.sent[app.sent.length - 2].text, /^🔁 Cadastrar gasto fixo\ninternet — R\$ 100,00/);
  assert.equal(app.last(), "Vi mais de um cadastro; cuidei do primeiro. Manda o próximo depois.");
});

test("Card 13: a pendencia de um numero nao afeta outro", async (t) => {
  const A = "551100095046";
  const B = "551100095047";
  seed(A, B);
  const app = bootApp(t, EARLY);
  await say(app, A, "todo dia 10 pago 100 de internet", completeRec());
  await say(app, B, "oi tudo bem");
  assert.deepEqual(pendingKinds(B), [], "B nao tem cadastro aberto");
  await say(app, B, "1"); // o "1" de B nao confirma o cadastro de A
  assert.equal(listRecurringExpenses(A).length, 0);
  assert.deepEqual(pendingKinds(A), ["create_recurrence"]);
  await say(app, A, "1");
  assert.equal(listRecurringExpenses(A).length, 1);
  assert.equal(listRecurringExpenses(B).length, 0);
});

test("Card 13: pergunta no meio do preenchimento ('quanto gastei?') nao vira nome -- segunda chance do Card 12", async (t) => {
  const N = "551100095048";
  seed(N);
  const app = bootApp(t, EARLY);
  await say(app, N, "cadastrar gasto fixo", unknownRec());
  await say(app, N, "quanto gastei esse mês?", { type: "expense_report", period: "month" });
  assert.ok(app.sent.some((m) => m.text.startsWith("Deixei a pergunta sobre")), app.sent.map((m) => m.text).join(" | "));
  assert.deepEqual(pendingKinds(N), []);
});

test("Card 13: o cron das 7h usa o mesmo lancamento (gasto, mes marcado, mensagem) e nao lanca duas vezes", async (t) => {
  const N = "551100095049";
  seed(N);
  const sent: { to: string; text: string }[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  let tick: (() => Promise<void>) | undefined;
  t.mock.method(cron, "schedule", (_expr: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop() {} };
  });
  const today = spDateString();
  createRecurringExpense({ fromNumber: N, description: "Cron compartilhado", amount: 77.5, categoryId: null, paymentMethodId: null, dayOfMonth: Number(today.slice(8, 10)) });
  startRecurringExpenseScheduler();
  assert.ok(tick);
  await tick!();
  const mine = sent.filter((m) => m.to === N);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, "🔁 Gasto fixo lançado: R$77.50 — Cron compartilhado");
  const launched = expensesLike(N, "Cron compartilhado");
  assert.equal(launched.length, 1);
  assert.equal(launched[0].date, today);
  assert.equal(listRecurringExpenses(N)[0].last_run_month, today.slice(0, 7));
  await tick!();
  assert.equal(expensesLike(N, "Cron compartilhado").length, 1, "marcou o mes: nao lanca de novo");
});
