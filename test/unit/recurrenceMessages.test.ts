import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCELLED_TEXT,
  CHOOSE_TYPE_NOT_UNDERSTOOD,
  DUPLICATE_NOT_UNDERSTOOD,
  MULTIPLE_CREATIONS_NOTICE,
  THIS_MONTH_NOT_UNDERSTOOD,
  alertCreatedText,
  chooseTypeQuestion,
  correctionChoices,
  correctionValueQuestion,
  duplicateQuestion,
  fillQuestion,
  previewText,
  recurringCreatedText,
  scheduleLabel,
  thisMonthQuestion,
  withProblem,
} from "../../src/recurrence/messages";
import { PREVIEW_OPTIONS } from "../../src/confirmation/preview";
import { PENDING_EXIT_HINT } from "../../src/pending/newRequest";

const TODAY = "2026-10-15";

test("scheduleLabel: dia do mes ou intervalo", () => {
  assert.equal(scheduleLabel({ dayOfMonth: 10 }), "todo dia 10");
  assert.equal(scheduleLabel({ intervalDays: 45 }), "a cada 45 dias");
  assert.equal(scheduleLabel({ intervalDays: 1 }), "a cada 1 dia");
});

test("fillQuestion: as perguntas da especificacao (RN06) terminam com 'Ou responde *cancelar*.'", () => {
  assert.equal(fillQuestion("recurring_expense", "description", {}), "Qual é o gasto fixo? Pode mandar tudo junto, ex: *internet 100 dia 10*. Ou responde *cancelar*.");
  assert.equal(
    fillQuestion("recurring_expense", "description", { amount: 15, dayOfMonth: 10 }),
    "Qual é o nome desse gasto fixo de R$ 15,00 (todo dia 10)? (ex: internet, academia) Ou responde *cancelar*."
  );
  assert.match(fillQuestion("recurring_expense", "description", { amount: 15 }), /^Qual é o nome desse gasto fixo de R\$ 15,00\? \(ex: internet, academia\)/);
  assert.match(fillQuestion("recurring_expense", "description", { dayOfMonth: 10 }), /^Qual é o nome desse gasto fixo \(todo dia 10\)\?/);
  assert.match(fillQuestion("recurring_expense", "amount", { description: "Internet", dayOfMonth: 10 }), /^Qual é o valor de Internet \(todo dia 10\)\? \(ex: 100 ou 99,90\)/);
  assert.match(fillQuestion("recurring_expense", "schedule", { description: "Internet", amount: 1 }), /^Em que dia do mês devo lançar Internet\? \(1 a 31\)/);
  assert.match(fillQuestion("bill_alert", "schedule", { description: "Ração" }), /^Quando devo te avisar de Ração\? Pode ser um dia do mês \(ex: \*dia 10\*\) ou um intervalo \(ex: \*a cada 45 dias\*\)\./);
  assert.match(fillQuestion("bill_alert", "description", {}), /^Qual é a conta ou o compromisso que eu devo te avisar\?/);
  assert.match(fillQuestion("bill_alert", "description", { intervalDays: 45 }), /^Qual é o nome desse alerta \(a cada 45 dias\)\?/);
  for (const field of ["description", "amount", "schedule"] as const) {
    assert.ok(fillQuestion("recurring_expense", field, {}).endsWith("Ou responde *cancelar*."), field);
  }
  assert.equal(withProblem("O dia precisa ser de 1 a 31.", "Pergunta?"), "O dia precisa ser de 1 a 31.\nPergunta?");
  assert.equal(withProblem(undefined, "Pergunta?"), "Pergunta?");
});

test("chooseTypeQuestion (RN04): 1 lanca sozinho, 2 so avisa, 3 cancela", () => {
  assert.equal(
    chooseTypeQuestion({ description: "Internet", dayOfMonth: 10 }),
    "Como você quer cadastrar *Internet* (todo dia 10)?\n1 🔁 Lançar o gasto sozinho todo mês (preciso do valor)\n2 📌 Só me avisar no dia\n3 ❌ Cancelar"
  );
  for (const text of [CHOOSE_TYPE_NOT_UNDERSTOOD, DUPLICATE_NOT_UNDERSTOOD, THIS_MONTH_NOT_UNDERSTOOD]) assert.ok(text.endsWith(PENDING_EXIT_HINT));
});

test("previa do gasto fixo (RN11): cabecalho, categoria/pagamento so quando existem, quando lanca", () => {
  assert.equal(
    previewText("recurring_expense", { description: "Internet", amount: 100, dayOfMonth: 10 }, { categoryName: "Moradia", paymentName: "Pix", todayDate: TODAY }),
    `🔁 Cadastrar gasto fixo\nInternet — R$ 100,00 · todo dia 10\nCategoria: Moradia · Pagamento: Pix\nVou lançar sozinho todo mês, às 7h do dia 10.\n\n${PREVIEW_OPTIONS}`
  );
  const bare = previewText("recurring_expense", { description: "Internet", amount: 100, dayOfMonth: 10 }, { todayDate: TODAY });
  assert.ok(!bare.includes("Categoria:") && !bare.includes("Pagamento:"));
  assert.match(previewText("recurring_expense", { description: "X", amount: 1, dayOfMonth: 31 }, { todayDate: TODAY }), /dia 31 \(nos meses mais curtos, no último dia\)\./);
  assert.match(previewText("recurring_expense", { description: "X", amount: 1, dayOfMonth: 10 }, { categoryName: "Lazer", todayDate: TODAY }), /Categoria: Lazer\nVou lançar/);
});

test("previa do alerta (RN11/RN03): proximo aviso por intervalo, valor descartado avisado, sem lancar gasto", () => {
  assert.equal(
    previewText("bill_alert", { description: "Ração", intervalDays: 45 }, { todayDate: TODAY }),
    `📌 Cadastrar alerta\nRação — a cada 45 dias (próximo aviso: 29/11)\nVou te perguntar "já fez?" nesse dia. Não lanço gasto.\n\n${PREVIEW_OPTIONS}`
  );
  assert.equal(
    previewText("bill_alert", { description: "Luz", dayOfMonth: 5 }, { todayDate: TODAY }),
    `📌 Cadastrar alerta\nLuz — todo dia 5\nVou te perguntar "já fez?" nesse dia. Não lanço gasto.\n\n${PREVIEW_OPTIONS}`
  );
  const ignored = previewText("bill_alert", { description: "Ração", intervalDays: 45, ignoredAmount: 80 }, { todayDate: TODAY });
  assert.match(ignored, /Gasto fixo só funciona por dia do mês, então vou só te avisar a cada 45 dias \(o valor não é guardado\)\./);
});

test("duplicata (RN10) e mes corrente (RN12)", () => {
  assert.equal(
    duplicateQuestion("recurring_expense", "Internet — R$ 100,00 · todo dia 10"),
    "Você já tem *Internet — R$ 100,00 · todo dia 10*. O que faço?\n1 ➕ Cadastrar outro mesmo assim\n2 ✏️ Atualizar o que já existe\n3 ❌ Cancelar"
  );
  assert.match(duplicateQuestion("bill_alert", "Luz — todo dia 5"), /^Você já tem o alerta \*Luz — todo dia 5\*\./);
  assert.equal(
    thisMonthQuestion(10, 100, "2026-10-10"),
    "O dia 10 já passou neste mês. Quer que eu lance o deste mês agora?\n1 ✅ Sim, lançar R$ 100,00 (10/10)\n2 ➡️ Não, só a partir do mês que vem\n3 ❌ Cancelar o cadastro"
  );
});

test("corrigir: campos por tipo e a pergunta de cada um", () => {
  assert.deepEqual(correctionChoices("recurring_expense").map((c) => c.label), ["Nome", "Valor", "Dia do mês", "Categoria", "Pagamento"]);
  assert.deepEqual(correctionChoices("bill_alert").map((c) => c.label), ["Nome", "Quando (dia ou intervalo)"]);
  assert.match(correctionValueQuestion("recurring_expense", "amount"), /Qual é o valor certo\?/);
  assert.match(correctionValueQuestion("recurring_expense", "schedule"), /Qual é o dia do mês certo\?/);
  assert.match(correctionValueQuestion("bill_alert", "schedule"), /Quando devo te avisar\? \(ex: \*dia 10\* ou \*a cada 45 dias\*\)/);
  for (const field of ["description", "amount", "schedule", "category", "payment"] as const) {
    assert.ok(correctionValueQuestion("recurring_expense", field).includes("*cancelar*"), field);
  }
});

test("sucesso e avisos (RN14, RN15)", () => {
  assert.equal(CANCELLED_TEXT, "Beleza, não cadastrei nada.");
  assert.equal(MULTIPLE_CREATIONS_NOTICE, "Vi mais de um cadastro; cuidei do primeiro. Manda o próximo depois.");
  assert.equal(
    recurringCreatedText({ description: "Internet", amount: 100, dayOfMonth: 10 }, "Moradia", "Pix"),
    "🔁 Gasto fixo cadastrado: R$ 100,00 em Moradia via Pix — Internet, todo dia 10. Vou lançar esse valor todo dia 10 às 7h."
  );
  assert.equal(
    recurringCreatedText({ description: "Internet", amount: 100, dayOfMonth: 10 }, "", null),
    "🔁 Gasto fixo cadastrado: R$ 100,00 — Internet, todo dia 10. Vou lançar esse valor todo dia 10 às 7h."
  );
  assert.match(alertCreatedText({ description: "Ração", intervalDays: 45 }), /^📌 Alerta cadastrado: a cada 45 dias eu te pergunto se já fez "Ração"\./);
});
