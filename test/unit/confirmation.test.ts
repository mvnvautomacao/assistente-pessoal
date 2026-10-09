import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyConfirmationReply, normalizeReply, isCancelWord } from "../../src/confirmation/classify";
import { parseBrazilianAmount, parseBrazilianAmountDetailed, parseLeadTimeMinutes, parseDayOfMonthAnswer } from "../../src/confirmation/parsers";
import {
  PREVIEW_OPTIONS,
  NOT_UNDERSTOOD_TEXT,
  formatBRL,
  formatShortDate,
  formatWhen,
  formatEditPreview,
  expenseHeader,
  recurringHeader,
  correctionQuestion,
  correctionRetry,
} from "../../src/confirmation/preview";
import { EDIT_PENDING_TTL_MS } from "../../src/confirmation/constants";
import { setPendingEditExpense, getPendingEditExpense } from "../../src/expenses/pendingEditExpense";
import { setPendingEditEvent, getPendingEditEvent } from "../../src/events/pendingEditEvent";
import { setPendingEditReminder, getPendingEditReminder } from "../../src/reminders/pendingEditReminder";
import { setPendingEditRecurring, getPendingEditRecurring } from "../../src/expenses/pendingEditRecurring";

test("classifyConfirmationReply: confirmacoes (so termos de confirmacao, com ou sem pontuacao/maiuscula/emoji)", () => {
  for (const text of ["sim", "Sim!", "SIM.", "s", "1", "ok", "pode", "  claro  ", "👍", "com certeza", "pode isso mesmo", "Beleza", "fechado", "Perfeito!", "manda", "positivo", "certeza", "confirmo", "confirmar", "blz"]) {
    assert.equal(classifyConfirmationReply(text), "confirm", `"${text}"`);
  }
});

test("classifyConfirmationReply: cancelamentos (so termos de cancelamento)", () => {
  for (const text of ["3", "não", "nao", "Não.", "n", "cancela", "Cancelar", "❌", "deixa pra lá", "esquece", "negativo", "nem", "nao, deixa"]) {
    assert.equal(classifyConfirmationReply(text), "cancel", `"${text}"`);
  }
});

test("classifyConfirmationReply: corrigir (2 ou a palavra corrigir, sozinhos)", () => {
  for (const text of ["2", " 2 ", "corrigir", "Corrigir!"]) assert.equal(classifyConfirmationReply(text), "correct", `"${text}"`);
});

// RN02/RN03: frases de correcao NUNCA sao lidas como sim/nao
test("classifyConfirmationReply: texto livre -- 'pode ser as 16h', 'para sexta', 'nao, e as 16h' nao sao sim/nao", () => {
  for (const text of [
    "pode ser às 16h",
    "para sexta às 16h",
    "não, é às 16h",
    "espera",
    "para",
    "talvez",
    "45",
    "1.500",
    "R$ 3",
    "3 reais",
    "sim 3",
    "1 3",
    "2 3",
    "quero mudar o valor",
    "",
    "   ",
    "???",
  ]) {
    assert.equal(classifyConfirmationReply(text), "free_text", `"${text}"`);
  }
});

test("normalizeReply tira acento, pontuacao e emoji, e converte so os dois emojis de resposta", () => {
  assert.equal(normalizeReply("  Não,   É às 16h!! "), "nao e as 16h");
  assert.equal(normalizeReply("👍"), "sim");
  assert.equal(normalizeReply("❌"), "nao");
  assert.equal(normalizeReply("🎉"), "");
});

test("isCancelWord: so a palavra cancelar (qualquer caixa/pontuacao), nada mais", () => {
  assert.ok(isCancelWord("cancelar"));
  assert.ok(isCancelWord(" Cancelar! "));
  for (const text of ["cancela", "3", "nao", "n", "cancelar tudo"]) assert.ok(!isCancelWord(text), text);
});

test("parseBrazilianAmount: formatos brasileiros", () => {
  const ok: [string, number][] = [
    ["45", 45],
    ["45,90", 45.9],
    ["R$ 45", 45],
    ["r$45,50", 45.5],
    ["45 reais", 45],
    ["1.500", 1500],
    ["1.500,50", 1500.5],
    ["1.500.000", 1500000],
    ["1.50", 1.5],
    ["10.49", 10.49],
    ["0,5", 0.5],
  ];
  for (const [text, expected] of ok) assert.equal(parseBrazilianAmount(text), expected, text);
  for (const text of ["0", "0,00", "-3", "abc", "", "  ", "45 e pouco", "1,2,3", "R$"]) assert.equal(parseBrazilianAmount(text), null, `"${text}"`);
});

test("parseBrazilianAmountDetailed distingue valor invalido de valor nao positivo", () => {
  assert.deepEqual(parseBrazilianAmountDetailed("0"), { ok: false, reason: "not_positive" });
  assert.deepEqual(parseBrazilianAmountDetailed("-3"), { ok: false, reason: "not_positive" });
  assert.deepEqual(parseBrazilianAmountDetailed("abc"), { ok: false, reason: "invalid" });
  assert.deepEqual(parseBrazilianAmountDetailed("45,90"), { ok: true, value: 45.9 });
});

test("parseLeadTimeMinutes e parseDayOfMonthAnswer", () => {
  assert.equal(parseLeadTimeMinutes("30 minutos"), 30);
  assert.equal(parseLeadTimeMinutes("45 min"), 45);
  assert.equal(parseLeadTimeMinutes("2 horas"), 120);
  assert.equal(parseLeadTimeMinutes("1h"), 60);
  assert.equal(parseLeadTimeMinutes("1 dia"), 1440);
  assert.equal(parseLeadTimeMinutes("na hora"), 0);
  assert.equal(parseLeadTimeMinutes("31 dias"), null); // mais de 30 dias
  assert.equal(parseLeadTimeMinutes("logo"), null);

  assert.equal(parseDayOfMonthAnswer("8"), 8);
  assert.equal(parseDayOfMonthAnswer("dia 15"), 15);
  assert.equal(parseDayOfMonthAnswer("0"), null);
  assert.equal(parseDayOfMonthAnswer("32"), null);
  assert.equal(parseDayOfMonthAnswer("oito"), null);
});

test("previa de gasto: texto exato do contrato (antes -> depois + opcoes 1/2/3)", () => {
  const header = expenseHeader({ description: "Mercado", amount: 38, date: "2026-10-07", paymentMethodName: "Pix" });
  assert.equal(header, "Mercado — R$ 38,00 · 07/10 · Pix");
  assert.equal(
    formatEditPreview(header, [{ label: "Valor", from: formatBRL(38), to: formatBRL(45) }]),
    "✏️ Mercado — R$ 38,00 · 07/10 · Pix\nValor: R$ 38,00 → R$ 45,00\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );
  assert.equal(expenseHeader({ description: "Pao", amount: 5, date: "2026-01-02" }), "Pao — R$ 5,00 · 02/01"); // sem forma de pagamento
  assert.match(PREVIEW_OPTIONS, /1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar/);
});

test("previa de evento/lembrete: 'Quando' com dia da semana, fuso de Sao Paulo", () => {
  assert.equal(formatWhen("2026-10-09T14:00:00-03:00"), "sex 09/10 às 14:00");
  assert.equal(formatWhen("2026-10-10T19:00:00.000Z"), "sáb 10/10 às 16:00"); // UTC -> SP
  assert.equal(
    formatEditPreview("Consulta", [{ label: "Quando", from: formatWhen("2026-10-09T14:00:00-03:00"), to: formatWhen("2026-10-10T16:00:00-03:00") }]),
    "✏️ Consulta\nQuando: sex 09/10 às 14:00 → sáb 10/10 às 16:00\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );
});

test("formatadores: dinheiro com milhar, data curta e cabecalho de gasto fixo", () => {
  assert.equal(formatBRL(1500.5), "R$ 1.500,50");
  assert.equal(formatBRL(0.5), "R$ 0,50");
  assert.equal(formatShortDate("2026-12-25"), "25/12");
  assert.equal(recurringHeader({ description: "Academia", amount: 89.9, dayOfMonth: 5 }), "Academia — R$ 89,90 · todo dia 5");
});

test("perguntas da opcao 2 (corrigir) e mensagem de 'nao entendi'", () => {
  assert.equal(correctionQuestion("amount"), "Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");
  assert.equal(correctionQuestion("datetime"), "Qual é a data e hora certas? (ex: sexta às 16h) Ou responde *cancelar*.");
  assert.equal(correctionQuestion("text"), "Qual é o novo nome? Ou responde *cancelar*.");
  assert.equal(correctionQuestion("text", "texto"), "Qual é o novo texto? Ou responde *cancelar*.");
  assert.equal(correctionQuestion("text", "categoria"), "Qual é a nova categoria? Ou responde *cancelar*.");
  assert.equal(correctionQuestion("text", "forma de pagamento"), "Qual é a nova forma de pagamento? Ou responde *cancelar*.");
  assert.match(correctionQuestion("date"), /data certa/);
  assert.match(correctionQuestion("day"), /1 a 31/);
  assert.match(correctionQuestion("lead"), /30 minutos, 2 horas, 1 dia/);
  assert.equal(correctionRetry("Não entendi o valor.", "amount"), "Não entendi o valor.\nQual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");
  assert.equal(NOT_UNDERSTOOD_TEXT, "Não entendi 🤔 Responde *1* pra confirmar, *2* pra corrigir ou *3* pra cancelar.");
});

// RN09: TTL unico de 10 minutos, o mesmo nas quatro pendencias de edicao
test("pendencias de edicao expiram todas com o mesmo TTL de 10 minutos", () => {
  assert.equal(EDIT_PENDING_TTL_MS, 10 * 60 * 1000);
  const N = "551100150001";
  const params = { amount: 1, description: "x", date: "2026-10-01", categoryId: null, paymentMethodId: null };
  setPendingEditExpense(N, {
    items: [{ expenseId: 1, description: "x", headerText: "", previous: params, proposed: params, rawChanges: [], newCategoryName: null, newPaymentMethodName: null, views: [] }],
    awaitingCorrection: false,
    correctionStage: "pick",
    correctionTarget: null,
  });
  const prevEvent = { title: "e", start: "2030-01-01T10:00:00-03:00", end: "2030-01-01T11:00:00-03:00", location: null, reminderMinutes: 60 };
  setPendingEditEvent(N, { eventId: 1, title: "e", previous: prevEvent, proposed: prevEvent, endSpec: null, changeText: "", awaitingCorrection: false, correctionStage: "pick", correctionTarget: null, headerText: "" });
  setPendingEditReminder(N, { reminderId: 1, message: "m", previousDueAt: "2030-01-01T10:00:00-03:00", proposedMessage: "m", proposedDueAt: "2030-01-01T10:00:00-03:00", isDateTimeChange: false, changeText: "", awaitingCorrection: false, correctionStage: "pick", correctionTarget: null, headerText: "" });
  const recurring = { description: "r", amount: 1, categoryId: null, paymentMethodId: null, dayOfMonth: 1 };
  setPendingEditRecurring(N, { recurringId: 1, previous: recurring, proposedParams: recurring, changeText: "", awaitingCorrection: false, headerText: "" });

  const getters = [getPendingEditExpense, getPendingEditEvent, getPendingEditReminder, getPendingEditRecurring];
  for (const get of getters) assert.ok(get(N));

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 9 * 60 * 1000;
    for (const get of getters) assert.ok(get(N), "ainda vale aos 9 min");
    Date.now = () => realNow() + 11 * 60 * 1000;
    for (const get of getters) assert.equal(get(N), null, "expirou aos 11 min");
  } finally {
    Date.now = realNow;
  }
});
