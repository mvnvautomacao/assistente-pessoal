// Card 17 (RN03 a RN06): frases soltas de funcionalidade ("trocar categoria", "apagar gasto", "mudar data", "categoria")
// levam ao fluxo guiado certo, sem a IA e sem virar "gasto novo".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded, getExpenseById, getOrCreateCategory, getOrCreatePaymentMethod, insertExpense } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createEvent } from "../../src/events/service";
import { createReminder } from "../../src/reminders/service";
import { createBillAlert } from "../../src/bills/service";
import { createRecurringExpense } from "../../src/expenses/recurring";
import { insertIncome } from "../../src/incomes/service";
import { getPendingFieldMenu } from "../../src/fieldMenu/pending";
import { getPendingLooseSuggest } from "../../src/intents/pendingSuggest";
import { getPendingEditExpense } from "../../src/expenses/pendingEditExpense";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-17T12:00:00-03:00");
const TODAY = "2026-10-17";

let seq = 0;
function user(): string {
  const n = `55110009200${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  getOrCreatePaymentMethod(n, "Pix");
  getOrCreatePaymentMethod(n, "Crédito");
  return n;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

function add(n: string, description: string, date = TODAY, amount = 38, category = "Mercado") {
  return insertExpense({ fromNumber: n, amount, description, categoryId: getOrCreateCategory(n, category).id, paymentMethodId: null, date });
}

test("Card 17 (defeito 1): 'trocar categoria' lista os gastos, o numero pergunta direto a categoria, prévia 1/2/3 e so grava no 1 -- sem a IA", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = add(n, "Feira");
  const list = await say(app, n, "trocar categoria");
  assert.match(list, /^Seus últimos gastos:\n1\. Feira — R\$ 38,00 · 17\/10\n\nQual deles você quer mudar a categoria\? Responde com o número ou \*cancelar\*\.$/);
  assert.ok(!list.includes("um gasto") && !list.includes("valor"), list);
  const question = await say(app, n, "1");
  assert.match(question, /^Qual categoria\?\n(\d\. .+\n)+Responde com o número ou escreve o nome/);
  assert.equal(getPendingFieldMenu(n)?.stage, "ask_value");
  const preview = await say(app, n, "Casa");
  assert.equal(preview.split("\n")[0], "✏️ Feira — R$ 38,00 · 17/10");
  assert.match(preview, /Categoria: Mercado → Casa/);
  assert.match(preview, /1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar/);
  assert.notEqual(getExpenseById(n, exp.id)?.category_id, null);
  await say(app, n, "1");
  assert.match(app.last(), /^✏️ "Feira" atualizado: categoria Casa/);
  assert.equal(app.calls.length, 0, "nenhuma chamada a IA");
});

test("Card 17: variacoes de 'trocar categoria' abrem a mesma lista", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  for (const text of ["mudar categoria", "alterar a categoria", "quero trocar a categoria", "Trocar categoria.", "trocar categoria 😅"]) {
    const list = await say(app, n, text);
    assert.match(list, /^Seus últimos gastos:\n1\. Feira/, text);
    assert.match(list, /mudar a categoria/, text);
    await say(app, n, "cancelar");
  }
  assert.equal(app.calls.length, 0);
});

test("Card 17: 'mudar valor' e 'trocar forma de pagamento' perguntam direto o campo depois do numero", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = add(n, "Feira");
  assert.match(await say(app, n, "mudar valor"), /Qual deles você quer mudar o valor\?/);
  assert.match(await say(app, n, "1"), /^Qual é o valor certo\? \(ex: 45 ou 45,90\)/);
  assert.match(await say(app, n, "45"), /Valor: R\$ 38,00 → R\$ 45,00/);
  await say(app, n, "1");
  assert.equal(getExpenseById(n, exp.id)?.amount, 45);

  assert.match(await say(app, n, "trocar forma de pagamento"), /Qual deles você quer mudar a forma de pagamento\?/);
  assert.match(await say(app, n, "1"), /^Qual forma de pagamento\?\n1\. /);
  assert.match(await say(app, n, "Crédito"), /Pagamento: .* → Crédito/);
  await say(app, n, "1");
  assert.ok(getExpenseById(n, exp.id)?.payment_method_id);
  assert.equal(app.calls.length, 0);
});

test("Card 17: 'editar gasto' e 'apagar gasto' -- lista de 10 e, depois do numero, o menu de campos / a confirmacao 1/3", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const exp = add(n, "Feira");
  assert.match(await say(app, n, "editar gasto"), /^Seus últimos gastos:\n1\. Feira/);
  assert.match(await say(app, n, "1"), /^✏️ Feira — R\$ 38,00 · 17\/10\nO que você quer mudar\?/);
  await say(app, n, "cancelar");

  const apagar = await say(app, n, "apagar gasto");
  assert.match(apagar, /^Seus últimos gastos:\n1\. Feira[\s\S]*Qual deles você quer apagar\?/);
  const confirm = await say(app, n, "1");
  assert.match(confirm, /1 .*Apagar/);
  assert.match(confirm, /3 ❌ Cancelar/);
  assert.ok(getExpenseById(n, exp.id), "nada apagado antes do 1");
  await say(app, n, "3");
  assert.ok(getExpenseById(n, exp.id));
  assert.equal(app.calls.length, 0);
});

test("Card 17: 'mudar data' pergunta de quê; a escolha segue o fluxo (gasto: pergunta direto a data)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  assert.equal(await say(app, n, "mudar data"), "Data de quê?\n1 Gasto   2 Evento   3 Lembrete");
  assert.match(await say(app, n, "1"), /^Seus últimos gastos:\n1\. Feira[\s\S]*mudar a data/);
  assert.match(await say(app, n, "1"), /^Qual é a data certa\?/);
  await say(app, n, "cancelar");

  await say(app, n, "alterar o horário");
  assert.match(await say(app, n, "3"), /Você não tem nenhum lembrete pendente pra editar\./);
  assert.equal(app.calls.length, 0);
});

test("Card 17: 'categoria' sozinha mostra as 3 sugestoes; o numero abre a opcao; 'cancelar' encerra", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  const text = await say(app, n, "categoria");
  assert.equal(text, "Não tenho certeza do que você quer 🤔 Seria:\n1 Trocar a categoria de um gasto\n2 Ver minhas categorias\n3 Criar uma categoria\nResponde o número, ou diz o que você precisa.");
  assert.match(await say(app, n, "2"), /^🏷️ Suas categorias:/);

  await say(app, n, "categoria");
  assert.match(await say(app, n, "1"), /^Seus últimos gastos:\n1\. Feira[\s\S]*mudar a categoria/);
  await say(app, n, "cancelar");

  await say(app, n, "categoria");
  assert.match(await say(app, n, "3"), /^Me diz o nome da nova categoria/);
  await say(app, n, "categoria");
  assert.equal(await say(app, n, "9"), "Não entendi 🤔 Responde com um número de 1 a 3, ou diz o que você precisa.");
  assert.match(await say(app, n, "cancelar"), /^Beleza, cancelei o que estava pendente/);
  assert.equal(getPendingLooseSuggest(n), null);
  assert.equal(app.calls.length, 0);
});

test("Card 17: as sugestoes expiram em 10 minutos com o aviso padrao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  await say(app, n, "categoria");
  app.advance(11 * 60 * 1000);
  const text = await say(app, n, "2");
  assert.match(text, /^⌛ A lista de opções expirou/);
});

test("Card 17: sugestao sem resposta e substituida por outra frase -- ela segue o fluxo normal (IA)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  await say(app, n, "categoria");
  const reply = await say(app, n, "gastei 30 de uber", { type: "expense", amount: 30, description: "uber", date: TODAY, category: "Transporte" });
  assert.match(reply, /forma de pagamento desse gasto de R\$30\.00 \(uber\)/);
  assert.equal(app.calls.length, 1);
});

test("Card 17: editar / apagar evento, lembrete, conta fixa, gasto fixo e entrada abrem a lista do tipo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createEvent({ fromNumber: n, title: "Dentista", start: "2026-10-20T14:00:00-03:00", end: "2026-10-20T15:00:00-03:00" });
  createReminder(n, "Remédio", "2026-10-18T08:00:00-03:00");
  createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 7 });
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 100, categoryId: null, paymentMethodId: null, dayOfMonth: 10 });
  insertIncome({ fromNumber: n, amount: 3000, description: "Salário", date: TODAY });

  const table: [string, RegExp][] = [
    ["editar evento", /^Seus próximos eventos:\n1\. Dentista/],
    ["editar lembrete", /^Seus lembretes:\n1\. Remédio/],
    ["editar conta fixa", /^Suas contas fixas \(avisos\):\n1\. Água — todo dia 5\n2\. Luz/],
    ["editar gasto fixo", /^Seus gastos fixos:\n1\. Internet/],
    ["editar entrada", /^Suas últimas entradas:\n1\. Salário/],
    ["apagar evento", /^Seus próximos eventos:\n1\. Dentista[\s\S]*cancelar\?/],
    ["apagar lembrete", /^Seus lembretes:\n1\. Remédio[\s\S]*apagar\?/],
    ["apagar entrada", /^Suas últimas entradas:\n1\. Salário[\s\S]*apagar\?/],
    ["apagar gasto fixo", /^Seus gastos fixos:\n1\. Internet[\s\S]*apagar\?/],
    ["remover conta fixa", /^Suas contas fixas \(avisos\):\n1\. Água[\s\S]*apagar\?/],
  ];
  for (const [text, expected] of table) {
    assert.match(await say(app, n, text), expected, text);
    await say(app, n, "cancelar");
  }
  assert.equal(app.calls.length, 0);

  // depois do numero: a confirmacao de sempre (nada e apagado antes do 1)
  await say(app, n, "apagar lembrete");
  assert.match(await say(app, n, "1"), /Apagar este lembrete\?[\s\S]*3 ❌ Cancelar/);
  await say(app, n, "3");
  await say(app, n, "apagar gasto fixo");
  assert.match(await say(app, n, "1"), /Parar de lançar este gasto fixo\?/);
  await say(app, n, "3");
  await say(app, n, "remover conta fixa");
  assert.match(await say(app, n, "2"), /Parar o alerta de "Luz"\?/);
});

test("Card 17: tipo sem nada cadastrado responde que nao ha o que editar / apagar", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  assert.equal(await say(app, n, "trocar categoria"), "Você ainda não tem gastos pra editar.");
  assert.equal(await say(app, n, "editar gasto"), "Você ainda não tem nenhum gasto registrado pra editar.");
  assert.equal(await say(app, n, "apagar gasto"), "Você ainda não tem nenhum gasto registrado pra apagar.");
  assert.equal(await say(app, n, "apagar lembrete"), "Você não tem nenhum lembrete pendente pra apagar.");
  assert.equal(await say(app, n, "apagar gasto fixo"), "Você não tem nenhum gasto fixo pra apagar.");
  assert.equal(await say(app, n, "remover conta fixa"), "Você não tem nenhuma conta fixa cadastrada pra apagar.");
});

test("Card 17: 'ver meus gastos' mostra as ultimas compras (10) e 'minha agenda' a agenda", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  for (let i = 1; i <= 12; i++) add(n, `Gasto ${String(i).padStart(2, "0")}`, `2026-10-${String(i).padStart(2, "0")}`);
  createReminder(n, "Pagar boleto", "2026-10-18T14:00:00-03:00");
  const gastos = await say(app, n, "ver meus gastos");
  assert.match(gastos, /^🧾 Últimos 10 gastos/);
  assert.ok(gastos.includes("Gasto 12") && !gastos.includes("Gasto 01"));
  const agenda = await say(app, n, "minha agenda");
  assert.match(agenda, /^📅 Agenda — próximos 7 dias\n\nAmanhã · dom 18\/10\n• ⏰ 14:00 Pagar boleto/);
  assert.equal(app.calls.length, 0);
});

test("Card 17: frases completas ou com dados seguem a IA como antes", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  await say(app, n, "troca a categoria do último gasto pra lazer", { type: "edit_expense", changes: [{ field: "category", value: "Lazer" }] });
  assert.equal(app.calls.length, 1);
  assert.match(app.last(), /Categoria: Mercado → Lazer/);
  await say(app, n, "3");
  await say(app, n, "50 no mercado", { type: "expense", amount: 50, description: "mercado", category: "Mercado", payment_method: "Pix", date: TODAY });
  assert.equal(app.calls.length, 2);
  await say(app, n, "apagar tudo", { type: "unknown" });
  assert.equal(app.calls.length, 3, "nunca apaga em massa por frase solta");
});

test("Card 17 (RN05): verbo de editar sem dados nunca vira 'gasto novo' -- a IA classificando como gasto cai nas sugestoes", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const text = await say(app, n, "trocar pagamento do pix", { type: "unknown", likely_intent: "expense" });
  assert.equal(text, "Não tenho certeza do que você quer 🤔 Seria:\n1 Editar um gasto\n2 Apagar um gasto\n3 Ver meus últimos gastos\nResponde o número, ou diz o que você precisa.");
  assert.ok(!text.includes("Beleza, um gasto"));
  add(n, "Feira");
  assert.match(await say(app, n, "1"), /^Seus últimos gastos:\n1\. Feira/);
  await say(app, n, "cancelar");
  // palavra sem verbo continua pedindo os dados do gasto
  assert.match(await say(app, n, "gasto", { type: "unknown", likely_intent: "expense" }), /^Beleza, um gasto!/);
  // com valor ou verbo de compra segue o fluxo normal
  assert.match(await say(app, n, "mudei de ideia comprei pao", { type: "unknown", likely_intent: "expense", description: "pao" }), /valor|quanto/i);
});

test("Card 17: com pendencia aberta -- verbo+substantivo substitui a pendencia (como 'editar'); palavra solta nao sequestra a resposta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  await say(app, n, "muda o valor da feira pra 50", { type: "edit_expense", query: "feira", changes: [{ field: "amount", value: "50" }] });
  assert.ok(getPendingEditExpense(n), "previa aberta");
  // palavra solta: continua sendo resposta da previa (nao abre sugestoes)
  const solta = await say(app, n, "categoria");
  assert.ok(!solta.startsWith("Não tenho certeza"), solta);
  assert.ok(getPendingEditExpense(n), "previa continua aberta");
  // verbo + substantivo: a previa e substituida
  const list = await say(app, n, "apagar gasto");
  assert.match(list, /^Seus últimos gastos:\n1\. Feira/);
  assert.equal(getPendingEditExpense(n), null);
});

test("Card 17: durante a pergunta de um campo de texto a mensagem e o valor, nao uma frase solta", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  add(n, "Feira");
  await say(app, n, "editar gasto");
  await say(app, n, "1");
  await say(app, n, "2"); // Nome
  const preview = await say(app, n, "apagar gasto");
  assert.match(preview, /Nome: Feira → apagar gasto/, "o texto e o novo nome");
});

test("Card 17: isolamento -- a lista nunca traz gastos de outro numero", async (t) => {
  const app = bootApp(t, NOW);
  const a = user();
  const b = user();
  add(a, "Do A");
  add(b, "SEGREDO DO B");
  const list = await say(app, a, "trocar categoria");
  assert.ok(list.includes("Do A") && !list.includes("SEGREDO"));
});
