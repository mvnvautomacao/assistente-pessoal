// Card 11: busca de evento, lembrete, gasto fixo e alerta sem acento/caixa (D-06) e numeros por
// extenso ("um", "dois", "tres") nas confirmacoes (D-04). Ver docs/auditoria-cards-1-a-7.md.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import * as aiInterpret from "../../src/ai/interpret";
import { handleIncomingMessage } from "../../src/router";
import { Interpretation } from "../../src/ai/interpret";
import { ensureUserSeeded, getOrCreatePaymentMethod, setDefaultPaymentMethod } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { resetRateLimitForTests } from "../../src/access/rateLimit";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";
import { spDateString, addDaysToDateString } from "../../src/timeSP";
import * as eventsService from "../../src/events/service";
import * as remindersService from "../../src/reminders/service";
import { createBillAlert, getBillAlertById } from "../../src/bills/service";
import { createRecurringExpense, getRecurringExpenseById } from "../../src/expenses/recurring";
import { setPending } from "../../src/pending/store";
import { NOT_UNDERSTOOD_TEXT } from "../../src/confirmation/preview";
import { hhmm } from "../../src/events/editPlan";

function evolutionMessage(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `bne-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

type Sent = { to: string; text: string };

function withMocks(t: TestContext) {
  resetRateLimitForTests();
  resetOwnerAlertForTests();
  const sent: Sent[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  const queue: Interpretation[][] = [];
  t.mock.method(aiInterpret, "interpretText", async () => queue.shift() ?? []);
  return { sent, queueReply: (actions: Interpretation[]) => queue.push(actions) };
}

function seed(...numbers: string[]) {
  for (const n of numbers) {
    ensureUserSeeded(n);
    allowNumber(n);
    setDefaultPaymentMethod(n, getOrCreatePaymentMethod(n, "Pix").id);
  }
}

const last = (sent: Sent[]) => sent[sent.length - 1].text;
const futureAt = (daysAhead: number, hour: number) => `${addDaysToDateString(spDateString(), daysAhead)}T${String(hour).padStart(2, "0")}:00:00-03:00`;

// ---- D-06: busca sem acento e sem diferenciar caixa -----------------------------------------------------

test("D-06 lembrete: 'muda o lembrete do remedio...' acha 'Remédio da pressão' e '1' (Um.) confirma", async (t) => {
  const N = "551100093101";
  seed(N);
  const id = remindersService.createReminder(N, "Remédio da pressão", futureAt(2, 8));
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_reminder", query: "remedio", new_time: "09:30" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o lembrete do remedio pra 9h30"));
  assert.match(last(sent), /Remédio da pressão/);
  assert.match(last(sent), /1 ✅ Confirmar/);
  await handleIncomingMessage(evolutionMessage(N, "Um."));
  assert.equal(hhmm(remindersService.getReminderById(N, id)!.due_at), "09:30");
});

test("D-06 evento: 'cancela a consulta medica' e 'CONSULTA MÉDICA' acham 'Consulta médica'; 'tres' mantem, 'um' cancela", async (t) => {
  const N = "551100093102";
  seed(N);
  const event = eventsService.createEvent({ fromNumber: N, title: "Consulta médica", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);

  queueReply([{ type: "delete_event", query: "consulta medica" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a consulta medica"));
  assert.match(last(sent), /🗑️ Cancelar este evento\?/);
  assert.match(last(sent), /Consulta médica/);
  await handleIncomingMessage(evolutionMessage(N, "três"));
  assert.equal(last(sent), 'Beleza, não mexi em nada — "Consulta médica" continua na agenda.');
  assert.ok(eventsService.getEventById(N, event.id));

  queueReply([{ type: "delete_event", query: "CONSULTA MÉDICA" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a CONSULTA MÉDICA"));
  assert.match(last(sent), /🗑️ Cancelar este evento\?/);
  await handleIncomingMessage(evolutionMessage(N, "dois")); // so existem 1 e 3
  assert.equal(last(sent), "Não entendi 🤔 Responde *1* pra cancelar o evento ou *3* pra manter.\nSe quer fazer outra coisa, responde *3* e me manda o pedido de novo.");
  await handleIncomingMessage(evolutionMessage(N, "um"));
  assert.match(last(sent), /🗑️ Evento "Consulta médica" removido da agenda\./);
  assert.equal(eventsService.getEventById(N, event.id), undefined);
});

test("D-06 evento: titulo sem acento acha consulta com acento, e 'reuniao cliente' acha 'Reunião com o cliente X'", async (t) => {
  const N = "551100093103";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "consulta medica", start: futureAt(4, 14), end: futureAt(4, 15) });
  eventsService.createEvent({ fromNumber: N, title: "Reunião com o cliente X", start: futureAt(5, 10), end: futureAt(5, 11) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "médica" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a médica"));
  assert.match(last(sent), /consulta medica/);
  await handleIncomingMessage(evolutionMessage(N, "3"));
  queueReply([{ type: "delete_event", query: "reuniao cliente" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a reuniao cliente"));
  assert.match(last(sent), /Reunião com o cliente X/);
  await handleIncomingMessage(evolutionMessage(N, "3"));
});

test("D-06 evento: busca com '%' nao acha tudo (nao e curinga) -- responde que nao achou", async (t) => {
  const N = "551100093104";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "Evento qualquer", start: futureAt(4, 14), end: futureAt(4, 15) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "%" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela o %"));
  assert.equal(last(sent), 'Não encontrei nenhum evento parecido com "%" (em andamento ou futuro).');
});

test("D-06 alerta de conta: 'cancela o alerta da agua' acha 'Água' (1/3 com 'um')", async (t) => {
  const N = "551100093105";
  seed(N);
  const alert = createBillAlert({ fromNumber: N, name: "Água", dayOfMonth: 10 });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "remove_bill_alert", query: "agua" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela o alerta da agua"));
  assert.match(last(sent), /🛑 Parar o alerta de "Água"\?/);
  assert.equal(getBillAlertById(N, alert.id)?.active, 1);
  await handleIncomingMessage(evolutionMessage(N, "um"));
  assert.equal(getBillAlertById(N, alert.id)?.active, 0);
});

test("D-06 gasto fixo: 'parar academica' acha 'Mensalidade acadêmica' (1/3 com 'tres' cancela)", async (t) => {
  const N = "551100093106";
  seed(N);
  const fixed = createRecurringExpense({ fromNumber: N, description: "Mensalidade acadêmica", amount: 300, categoryId: null, paymentMethodId: null, dayOfMonth: 5 });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "remove_recurring_expense", query: "academica" }]);
  await handleIncomingMessage(evolutionMessage(N, "parar academica"));
  assert.match(last(sent), /Mensalidade acadêmica/);
  assert.match(last(sent), /1 🛑 Parar de lançar/);
  await handleIncomingMessage(evolutionMessage(N, "Três."));
  assert.equal(getRecurringExpenseById(N, fixed.id)?.active, 1, "cancelou, continua ativo");
  queueReply([{ type: "remove_recurring_expense", query: "ACADÊMICA" }]);
  await handleIncomingMessage(evolutionMessage(N, "parar ACADÊMICA"));
  await handleIncomingMessage(evolutionMessage(N, "um"));
  assert.equal(getRecurringExpenseById(N, fixed.id)?.active, 0);
});

test("D-06 isolamento: o mesmo titulo em outro numero nao aparece", async (t) => {
  const N = "551100093107";
  const OTHER = "551100093108";
  seed(N, OTHER);
  eventsService.createEvent({ fromNumber: OTHER, title: "Consulta médica do outro", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "consulta medica" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a consulta medica"));
  assert.equal(last(sent), 'Não encontrei nenhum evento parecido com "consulta medica" (em andamento ou futuro).');
});

// ---- D-04: numeros por extenso nas confirmacoes ---------------------------------------------------------

test("D-04 previa de edicao: Um./um/UM/opção um confirmam; dois abre a correcao; tres/número três cancelam", async (t) => {
  const N = "551100093201";
  seed(N);
  const event = eventsService.createEvent({ fromNumber: N, title: "Evento numeros", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);
  const ask = async (title: string) => {
    queueReply([{ type: "edit_event", query: "evento numeros", new_title: title }]);
    await handleIncomingMessage(evolutionMessage(N, `renomeia o evento numeros pra ${title}`));
    assert.match(last(sent), /1 ✅ Confirmar/);
  };

  for (const [i, reply] of ["Um.", "um", "UM", "opção um"].entries()) {
    resetRateLimitForTests();
    await ask(`Titulo ${i}`);
    await handleIncomingMessage(evolutionMessage(N, reply));
    assert.equal(eventsService.getEventById(N, event.id)?.title, `Titulo ${i}`, `"${reply}" confirma`);
    queueReply([{ type: "edit_event", query: `titulo ${i}`, new_title: "Evento numeros" }]);
    await handleIncomingMessage(evolutionMessage(N, `volta o titulo ${i}`));
    await handleIncomingMessage(evolutionMessage(N, "1"));
    assert.equal(eventsService.getEventById(N, event.id)?.title, "Evento numeros");
  }

  for (const reply of ["dois", "duas"]) {
    resetRateLimitForTests();
    await ask("Titulo corrigir");
    await handleIncomingMessage(evolutionMessage(N, reply));
    assert.match(last(sent), /Ou responde \*cancelar\*/, `"${reply}" abre a correcao`);
    await handleIncomingMessage(evolutionMessage(N, "cancelar"));
  }

  for (const reply of ["três", "tres", "número três"]) {
    resetRateLimitForTests();
    await ask("Titulo cancelado");
    await handleIncomingMessage(evolutionMessage(N, reply));
    assert.equal(last(sent), "Beleza, não mexi em nada.", `"${reply}" cancela`);
    assert.equal(eventsService.getEventById(N, event.id)?.title, "Evento numeros");
  }
});

test("D-04 'um pouco', 'dois dias' e 'tres vezes' continuam texto livre (nunca confirmam nem cancelam)", async (t) => {
  const N = "551100093202";
  seed(N);
  const event = eventsService.createEvent({ fromNumber: N, title: "Evento texto livre", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento texto livre", new_title: "Outro nome" }]);
  await handleIncomingMessage(evolutionMessage(N, "renomeia o evento texto livre pra Outro nome"));
  for (const reply of ["um pouco", "dois dias", "três vezes"]) {
    await handleIncomingMessage(evolutionMessage(N, reply));
    assert.equal(last(sent), NOT_UNDERSTOOD_TEXT, `"${reply}"`);
  }
  assert.equal(eventsService.getEventById(N, event.id)?.title, "Evento texto livre", "nada foi aplicado");
  await handleIncomingMessage(evolutionMessage(N, "Um"));
  assert.equal(eventsService.getEventById(N, event.id)?.title, "Outro nome", "a pendencia continuava aberta");
});

test("D-04 'qual voce quer corrigir' (Card 3): 'um'/'dois' escolhem a mudanca pelo extenso", async (t) => {
  const N = "551100093203";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "Evento duas mudancas", start: futureAt(3, 14), end: futureAt(3, 15) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "edit_event", query: "evento duas mudancas", new_title: "Titulo novo", new_location: "Sala 2" }]);
  await handleIncomingMessage(evolutionMessage(N, "muda o titulo e o local do evento duas mudancas"));
  await handleIncomingMessage(evolutionMessage(N, "dois"));
  assert.match(last(sent), /Qual você quer corrigir\?/);
  await handleIncomingMessage(evolutionMessage(N, "dois")); // o segundo item da lista (Local)
  assert.match(last(sent), /Qual é o local\?/);
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
});

test("D-04 lista de escolha e menu de campos: extenso continua valendo com a tabela unica", async (t) => {
  const N = "551100093204";
  seed(N);
  eventsService.createEvent({ fromNumber: N, title: "Aula yoga A", start: futureAt(2, 10), end: futureAt(2, 11) });
  eventsService.createEvent({ fromNumber: N, title: "Aula yoga B", start: futureAt(3, 10), end: futureAt(3, 11) });
  const { sent, queueReply } = withMocks(t);
  queueReply([{ type: "delete_event", query: "aula yoga" }]);
  await handleIncomingMessage(evolutionMessage(N, "cancela a aula yoga"));
  assert.match(last(sent), /1\. Aula yoga A/);
  await handleIncomingMessage(evolutionMessage(N, "dois"));
  assert.match(last(sent), /🗑️ Cancelar este evento\?/);
  assert.match(last(sent), /Aula yoga B/);
  await handleIncomingMessage(evolutionMessage(N, "3"));

  await handleIncomingMessage(evolutionMessage(N, "editar"));
  await handleIncomingMessage(evolutionMessage(N, "quatro")); // "Evento" no menu de tipos
  assert.match(last(sent), /1\. Aula yoga A/);
  await handleIncomingMessage(evolutionMessage(N, "uma"));
  assert.match(last(sent), /O que você quer mudar\?/);
  await handleIncomingMessage(evolutionMessage(N, "um e dois")); // Dia e hora + Título
  assert.match(last(sent), /\?/);
  await handleIncomingMessage(evolutionMessage(N, "cancelar"));
});

test("D-04 confirmacao vencida: 'Um.' recebe o aviso de expiracao, igual a previa ativa", async (t) => {
  const N = "551100093205";
  seed(N);
  const { sent } = withMocks(t);
  const now = Date.now();
  setPending(N, "edit_event", { payload: {}, label: "Consulta", ttlMs: 10 * 60 * 1000, version: 1, now: now - 20 * 60 * 1000 });
  await handleIncomingMessage(evolutionMessage(N, "Um."));
  assert.match(last(sent), /A confirmação de "Consulta" expirou/);
});
