// Card 15 (RN07 a RN09, RN12): edicao guiada de conta fixa (alerta de conta): lista numerada, menu de campos,
// previa "antes -> depois" com 1/2/3, frase livre, corrigir, cancelar, expirar, desfazer e reinicio.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interpretation } from "../../src/ai/interpret";
import { bootApp, msg, BotApp } from "../helpers/botApp";
import { ensureUserSeeded } from "../../src/expenses/service";
import { allowNumber } from "../../src/access/allowlist";
import { createBillAlert, getBillAlertById, listBillAlerts } from "../../src/bills/service";
import { getPendingEditBillAlert } from "../../src/bills/pendingEdit";

const NOW = new Date("2026-10-14T12:00:00-03:00").getTime();

let seq = 0;
function user(): string {
  const n = `55110009700${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  allowNumber(n);
  return n;
}

async function say(app: BotApp, n: string, text: string, ...actions: Interpretation[]) {
  if (actions.length) app.queueReply(actions);
  app.resetLimit();
  await app.handle(msg(n, text));
  return app.last();
}

const shortDate = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

const editBill = (over: Partial<Extract<Interpretation, { type: "edit_bill_alert" }>> = {}): Interpretation => ({ type: "edit_bill_alert", query: "", ...over });

test("Card 15: 'editar conta fixa' lista os alertas numerados com o rodape e o numero abre o menu (3 campos no alerta por dia)", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  const racao = createBillAlert({ fromNumber: n, name: "Ração", intervalDays: 45 });

  const list = await say(app, n, "editar conta fixa", editBill());
  assert.equal(
    list,
    `Suas contas fixas (avisos):\n1. Água — todo dia 5\n2. Ração — a cada 45 dias · próximo aviso ${shortDate(racao.next_due_date!)}\n\nQual deles você quer editar? Responde com o número ou *cancelar*.\n\nPra gastos fixos lançados sozinhos, diga "editar gasto fixo".`
  );
  const menu = await say(app, n, "1");
  assert.equal(menu, '✏️ Água — todo dia 5\nO que você quer mudar?\n1 Nome\n2 Dia do mês\n3 Intervalo\n\nPode escolher mais de um: "1 e 3". Ou *cancelar*.');

  // alerta por intervalo: menu com o 4o campo
  await say(app, n, "cancelar");
  await say(app, n, "editar conta fixa", editBill());
  const intervalMenu = await say(app, n, "2");
  assert.match(intervalMenu, /^✏️ Ração — a cada 45 dias · próximo aviso \d\d\/\d\d\nO que você quer mudar\?\n1 Nome\n2 Dia do mês\n3 Intervalo\n4 Próximo aviso\n\nPode escolher mais de um: "1 e 4"\./);
  assert.equal(getBillAlertById(n, racao.id)?.name, "Ração");
});

test("Card 15: so um alerta -- 'editar conta fixa' vai direto pro menu; nenhum alerta avisa que nao ha o que editar", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  assert.equal(await say(app, n, "editar conta fixa", editBill()), "Você não tem nenhuma conta fixa cadastrada pra editar.");
  createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  assert.match(await say(app, n, "editar conta fixa", editBill()), /^✏️ Água — todo dia 5\nO que você quer mudar\?/);
});

test("Card 15: menu -> 'Dia do mes' -> previa 'antes -> depois'; nada grava antes do 1; confirmar grava e desfazer restaura", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "editar conta fixa", editBill());
  assert.equal(await say(app, n, "2"), "Qual é o dia do mês certo? (1 a 31) Ou responde *cancelar*.");
  assert.equal(await say(app, n, "40"), "O dia do mês precisa ser de 1 a 31.\nQual é o dia do mês certo? (1 a 31) Ou responde *cancelar*.");
  const preview = await say(app, n, "8");
  assert.equal(preview, "✏️ Água\nRecorrência: todo dia 5 → todo dia 8\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar");
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 5, "nada gravado antes do 1");
  await say(app, n, "1");
  assert.match(app.last(), /^✏️ Alerta atualizado: "Água" — todo dia 8\./);
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 8);
  await say(app, n, "desfaz isso", { type: "undo" });
  assert.match(app.last(), /^↩️ Prontinho, o alerta de "Água" voltou como estava antes\./);
  const back = getBillAlertById(n, bill.id)!;
  assert.deepEqual([back.name, back.recurrence_type, back.day_of_month], ["Água", "day_of_month", 5]);
});

test("Card 15: troca de dia do mes pra intervalo (Intervalo) e de volta; desfazer devolve o tipo e o proximo aviso", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Filtro", dayOfMonth: 10 });
  await say(app, n, "editar conta fixa", editBill());
  assert.match(await say(app, n, "3"), /^De quantos em quantos dias devo te avisar\? \(ex: 45\)/);
  assert.match(await say(app, n, "zero"), /^O intervalo precisa ser um número de dias entre 1 e 3650\.\nDe quantos em quantos dias/);
  const preview = await say(app, n, "a cada 30 dias");
  assert.equal(preview, "✏️ Filtro\nRecorrência: todo dia 10 → a cada 30 dias\nPróximo aviso: — → 13/11\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar");
  await say(app, n, "1");
  let row = getBillAlertById(n, bill.id)!;
  assert.deepEqual([row.recurrence_type, row.interval_days, row.next_due_date], ["interval", 30, "2026-11-13"]);

  await say(app, n, "desfaz isso", { type: "undo" });
  row = getBillAlertById(n, bill.id)!;
  assert.deepEqual([row.recurrence_type, row.day_of_month, row.interval_days, row.next_due_date], ["day_of_month", 10, null, null]);
});

test("Card 15: 'Proximo aviso' de alerta por intervalo aceita 'dia 20' como a proxima vez; data passada e recusada", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Ração", intervalDays: 45 });
  await say(app, n, "editar conta fixa", editBill());
  assert.equal(await say(app, n, "4"), "Quando é o próximo aviso? (ex: 15/11 ou dia 20) Ou responde *cancelar*.");
  const preview = await say(app, n, "dia 20");
  assert.match(preview, /^✏️ Ração\nPróximo aviso: \d\d\/\d\d → 20\/10\n\n1 ✅/);
  await say(app, n, "1");
  assert.equal(getBillAlertById(n, bill.id)?.next_due_date, "2026-10-20");
  assert.equal(getBillAlertById(n, bill.id)?.interval_days, 45, "o intervalo continua");

  // pela frase: data no passado
  assert.equal(await say(app, n, "o próximo aviso da ração foi dia 10/01/2026", editBill({ query: "ração", next_due_date: "2026-01-10" })), "A data precisa ser de hoje em diante.");
  // alerta por dia do mes nao tem proximo aviso
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 7 });
  assert.match(await say(app, n, "o próximo aviso da luz é 15/11", editBill({ query: "luz", next_due_date: "2026-11-15" })), /^Só os alertas por intervalo têm próximo aviso/);
});

test("Card 15: frase livre 'muda o alerta da agua pro dia 8' cai na mesma previa; 3 cancela e nao muda nada", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Conta de água", dayOfMonth: 5 });
  const preview = await say(app, n, "muda o alerta da água pro dia 8", editBill({ query: "água", day_of_month: 8 }));
  assert.match(preview, /^✏️ Conta de água\nRecorrência: todo dia 5 → todo dia 8\n\n1 ✅ Confirmar/);
  await say(app, n, "3");
  assert.equal(app.last(), "Beleza, não mexi em nada.");
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 5);
  assert.equal(getPendingEditBillAlert(n), null);
});

test("Card 15: renomear com nome ja usado mostra o aviso na previa, mas deixa confirmar", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 7 });
  const agua = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  const preview = await say(app, n, "renomeia o alerta da água pra Luz", editBill({ query: "água", new_name: "luz" }));
  assert.equal(preview, "✏️ Água\nNome: Água → luz\n⚠️ Você já tem um alerta com esse nome\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar");
  await say(app, n, "1");
  assert.equal(getBillAlertById(n, agua.id)?.name, "luz");
});

test("Card 15: pedido sem mudanca real, dia invalido e alerta que nao existe respondem sem abrir previa", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  assert.equal(await say(app, n, "muda o alerta da água pro dia 5", editBill({ query: "água", day_of_month: 5 })), "Já está assim, não mexi em nada.");
  assert.equal(await say(app, n, "muda o alerta da água pro dia 40", editBill({ query: "água", day_of_month: 40 })), "O dia do mês precisa ser um número de 1 a 31.");
  assert.equal(await say(app, n, "dia 3 e a cada 10 dias", editBill({ query: "água", day_of_month: 3, interval_days: 10 })), "Escolhe um só: dia do mês ou intervalo de dias.");
  assert.equal(await say(app, n, "muda o alerta zzz", editBill({ query: "zzz", day_of_month: 3 })), 'Não achei nenhum alerta parecido com "zzz".');
  assert.equal(getPendingEditBillAlert(n), null);
});

test("Card 15: o 2 (Corrigir) da previa com varias mudancas pergunta qual e corrige so aquele campo", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "renomeia pra Saneamento e dia 9", editBill({ query: "água", new_name: "Saneamento", day_of_month: 9 }));
  assert.equal(await say(app, n, "2"), "Qual você quer corrigir?\n1 Nome\n2 Recorrência\n\nOu responde *cancelar*.");
  assert.match(await say(app, n, "banana"), /^Não entendi 🤔\nQual você quer corrigir\?/);
  assert.match(await say(app, n, "2"), /^Quando devo te avisar\? \(ex: \*dia 10\* ou \*a cada 45 dias\*\)/);
  assert.match(await say(app, n, "talvez"), /^Não entendi o dia ou o intervalo "talvez"\.\nQuando devo te avisar\?/);
  const preview = await say(app, n, "a cada 20 dias");
  assert.match(preview, /^✏️ Água\nNome: Água → Saneamento\nRecorrência: todo dia 5 → a cada 20 dias\nPróximo aviso: — → \d\d\/\d\d\n\n1 ✅/);
  await say(app, n, "1");
  const row = getBillAlertById(n, bill.id)!;
  assert.deepEqual([row.name, row.recurrence_type, row.interval_days], ["Saneamento", "interval", 20]);
});

test("Card 15: corrigir o nome (uma mudanca so) pergunta direto; corrigir pro valor atual encerra com 'Ja esta assim'", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "renomeia o alerta da água", editBill({ query: "água", new_name: "Esgoto" }));
  assert.match(await say(app, n, "2"), /^Qual é o novo nome\?/);
  assert.match(await say(app, n, "Saneamento"), /^✏️ Água\nNome: Água → Saneamento/);
  await say(app, n, "2");
  assert.equal(await say(app, n, "Água"), "Já está assim, não mexi em nada.");
  assert.equal(getBillAlertById(n, bill.id)?.name, "Água");
  assert.equal(getPendingEditBillAlert(n), null);

  await say(app, n, "renomeia o alerta da água", editBill({ query: "água", new_name: "Esgoto" }));
  await say(app, n, "2");
  await say(app, n, "cancelar");
  assert.equal(app.last(), "Beleza, não mexi em nada.");
  assert.equal(getPendingEditBillAlert(n), null);
});

test("Card 15: a previa expira em 10 minutos sem gravar; o 1 tardio recebe o aviso de expiracao", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "muda o alerta da água pro dia 8", editBill({ query: "água", day_of_month: 8 }));
  app.advance(11 * 60 * 1000);
  await say(app, n, "1");
  assert.match(app.last(), /^⌛ A confirmação de "Água" expirou/);
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 5);
});

test("Card 15: reinicio do servidor com a previa aberta -- o 1 ainda confirma", async (t) => {
  let app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "muda o alerta da água pro dia 8", editBill({ query: "água", day_of_month: 8 }));
  app = bootApp(t); // reinicio
  await say(app, n, "1");
  assert.equal(getBillAlertById(n, bill.id)?.day_of_month, 8);
});

test("Card 15: pedido novo enquanto a previa esta aberta troca a previa; 'editar' -> 6 mostra a lista de contas fixas", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 7 });
  await say(app, n, "editar");
  assert.match(await say(app, n, "6"), /^Suas contas fixas \(avisos\):\n1\. Água — todo dia 5\n2\. Luz — todo dia 7\n\nQual deles/);
  await say(app, n, "cancelar");

  await say(app, n, "muda o alerta da água pro dia 8", editBill({ query: "água", day_of_month: 8 }));
  await say(app, n, "muda o alerta da luz pro dia 9", editBill({ query: "luz", day_of_month: 9 }));
  assert.match(app.last(), /^✏️ Luz\nRecorrência: todo dia 7 → todo dia 9/);
  await say(app, n, "1");
  assert.deepEqual(listBillAlerts(n).map((b) => [b.name, b.day_of_month]), [["Água", 5], ["Luz", 9]]);
});

test("Card 15: o alerta e apagado no meio da edicao -- o 1 avisa que nao existe mais e nao grava", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 5 });
  await say(app, n, "muda o alerta da água pro dia 8", editBill({ query: "água", day_of_month: 8 }));
  const { deactivateBillAlert } = require("../../src/bills/service");
  deactivateBillAlert(n, bill.id);
  await say(app, n, "1");
  assert.equal(app.last(), "Não achei mais esse item.");
});

test("Card 15: com varios alertas parecidos a frase livre lista os candidatos", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  createBillAlert({ fromNumber: n, name: "Conta de água", dayOfMonth: 5 });
  createBillAlert({ fromNumber: n, name: "Conta de luz", dayOfMonth: 7 });
  const list = await say(app, n, "muda a conta pro dia 9", editBill({ query: "conta", day_of_month: 9 }));
  assert.match(list, /^Achei 2 contas fixas com "conta":\n1\. Conta de água — todo dia 5\n2\. Conta de luz — todo dia 7/);
  assert.match(await say(app, n, "2"), /^✏️ Conta de luz\nRecorrência: todo dia 7 → todo dia 9/);
});

test("Card 15: lista com mais de 8 alertas mostra 8 e avisa que tem mais", async (t) => {
  const app = bootApp(t, NOW);
  const n = user();
  for (let i = 1; i <= 10; i++) createBillAlert({ fromNumber: n, name: `Conta ${i}`, dayOfMonth: i });
  const list = await say(app, n, "editar conta fixa", editBill());
  assert.match(list, /8\. Conta 8 — todo dia 8\nTem mais opções\./);
  assert.ok(!list.includes("9. Conta 9"));
});
