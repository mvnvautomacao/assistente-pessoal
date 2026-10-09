import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_REGISTRY, MenuKind, getFieldDef } from "../../src/fieldMenu/registry";
import { parseFieldSelection } from "../../src/fieldMenu/select";
import { FIELD_SELECTION_RETRY, formatFieldMenu, formatFieldQuestion, formatFieldRetry, isChoiceQuestion } from "../../src/fieldMenu/format";
import {
  MAX_TEXT_LENGTH,
  validateAmountAnswer,
  validateDateAnswer,
  validateDayAnswer,
  validateLeadAnswer,
  validateTextAnswer,
} from "../../src/fieldMenu/validate";
import { setPendingFieldMenu, getPendingFieldMenu, clearPendingFieldMenu } from "../../src/fieldMenu/pending";
import { formatTargetList, recurringLine } from "../../src/targetChoice/format";

test("registro: ordem e rotulos de cada tipo (RN02)", () => {
  const labels = (kind: MenuKind) => FIELD_REGISTRY[kind].map((f) => f.label);
  assert.deepEqual(labels("expense"), ["Valor", "Nome", "Categoria", "Data", "Pagamento"]);
  assert.deepEqual(labels("event"), ["Dia e hora", "Título", "Aviso", "Término", "Local"]);
  assert.deepEqual(labels("reminder"), ["Dia e hora", "Texto"]);
  assert.deepEqual(labels("recurring"), ["Nome", "Valor", "Categoria", "Dia do mês", "Pagamento"]);
  assert.equal(getFieldDef("event", "lead")?.question, "lead");
  assert.equal(getFieldDef("event", "nada"), undefined);
});

test("parseFieldSelection: numeros, nomes e separadores (RN03)", () => {
  const keys = (text: string, kind: MenuKind = "expense") => {
    const r = parseFieldSelection(text, kind);
    return r.ok ? r.keys : null;
  };
  assert.deepEqual(keys("1 e 5"), ["amount", "payment_method"]);
  assert.deepEqual(keys("1,5"), ["amount", "payment_method"]);
  assert.deepEqual(keys("1+5"), ["amount", "payment_method"]);
  assert.deepEqual(keys("valor pagamento"), ["amount", "payment_method"]);
  assert.deepEqual(keys("Valor e Forma de Pagamento"), ["amount", "payment_method"]);
  assert.deepEqual(keys("CATEGORIA"), ["category"]);
  assert.deepEqual(keys("2"), ["description"]);
  assert.deepEqual(keys("um e cinco"), ["amount", "payment_method"]);
  // repetidos somem e a ordem e a do menu
  assert.deepEqual(keys("1 1"), ["amount"]);
  assert.deepEqual(keys("5 e 1"), ["amount", "payment_method"]);
  assert.deepEqual(keys("pagamento 1"), ["amount", "payment_method"]);
  // "dia e hora" tem um "e" no meio e continua sendo um campo so
  assert.deepEqual(keys("dia e hora", "event"), ["datetime"]);
  assert.deepEqual(keys("1 e 3", "event"), ["datetime", "lead"]);
  assert.deepEqual(keys("titulo", "event"), ["title"]);
  assert.deepEqual(keys("dia do mes", "recurring"), ["day"]);
  assert.deepEqual(keys("texto", "reminder"), ["message"]);
});

test("parseFieldSelection: qualquer item invalido invalida tudo", () => {
  for (const bad of ["1 e 9", "xyz", "", "   ", "0", "6", "tudo", "valor banana"]) {
    assert.equal(parseFieldSelection(bad, "expense").ok, false, `"${bad}"`);
  }
  assert.equal(parseFieldSelection("3", "reminder").ok, false); // lembrete so tem 2 campos
});

test("formatFieldMenu: formato do menu de cada tipo", () => {
  assert.equal(
    formatFieldMenu("Mercado — R$ 38,00 · 07/10 · Pix", "expense"),
    '✏️ Mercado — R$ 38,00 · 07/10 · Pix\nO que você quer mudar?\n1 Valor\n2 Nome\n3 Categoria\n4 Data\n5 Pagamento\n\nPode escolher mais de um: "1 e 5". Ou *cancelar*.'
  );
  assert.match(formatFieldMenu("Consulta", "event"), /1 Dia e hora\n2 Título\n3 Aviso\n4 Término\n5 Local\n\nPode escolher mais de um: "1 e 5"/);
  assert.match(formatFieldMenu("Remédio", "reminder"), /1 Dia e hora\n2 Texto\n\nPode escolher mais de um: "1 e 2"/);
  assert.match(formatFieldMenu("Academia", "recurring"), /1 Nome\n2 Valor\n3 Categoria\n4 Dia do mês\n5 Pagamento/);
  assert.equal(FIELD_SELECTION_RETRY, "Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.");
});

test("formatFieldQuestion: progresso '(i de n)' e pergunta de escolha com opcoes numeradas", () => {
  const amount = getFieldDef("expense", "amount")!;
  assert.equal(formatFieldQuestion({ def: amount, step: 1, total: 2 }), "(1 de 2) Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");
  assert.equal(formatFieldQuestion({ def: amount, step: 1, total: 1 }), "Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.");

  const pay = getFieldDef("expense", "payment_method")!;
  assert.equal(
    formatFieldQuestion({ def: pay, step: 2, total: 2, options: ["Pix", "Crédito", "Dinheiro"] }),
    "(2 de 2) Qual forma de pagamento?\n1. Pix\n2. Crédito\n3. Dinheiro\nResponde com o número ou escreve o nome (se não existir, eu só crio depois que você confirmar). Ou *cancelar*."
  );
  const cat = getFieldDef("expense", "category")!;
  assert.equal(
    formatFieldQuestion({ def: cat, step: 1, total: 1, options: [] }),
    "Qual categoria?\nEscreve o nome (se não existir, eu só crio depois que você confirmar). Ou *cancelar*."
  );
  assert.match(formatFieldQuestion({ def: getFieldDef("event", "datetime")!, step: 1, total: 1 }), /data e hora certas/);
  assert.match(formatFieldQuestion({ def: getFieldDef("event", "lead")!, step: 1, total: 1 }), /Quanto tempo antes/);
  assert.match(formatFieldQuestion({ def: getFieldDef("recurring", "day")!, step: 1, total: 1 }), /1 a 31/);
  assert.match(formatFieldQuestion({ def: getFieldDef("expense", "date")!, step: 1, total: 1 }), /data certa/);
  assert.equal(formatFieldQuestion({ def: getFieldDef("event", "title")!, step: 1, total: 1 }), "Qual é o novo título? Ou responde *cancelar*.");
  assert.equal(formatFieldQuestion({ def: getFieldDef("reminder", "message")!, step: 1, total: 1 }), "Qual é o novo texto? Ou responde *cancelar*.");
  assert.equal(formatFieldRetry("Não recebi nada.", { def: getFieldDef("expense", "description")!, step: 1, total: 1 }), "Não recebi nada.\nQual é o novo nome? Ou responde *cancelar*.");
  assert.equal(isChoiceQuestion("category"), true);
  assert.equal(isChoiceQuestion("amount"), false);
});

test("validadores: valor, dia do mes, antecedencia e texto (RN05)", () => {
  assert.deepEqual(validateAmountAnswer("45,90"), { ok: true, value: 45.9 });
  assert.deepEqual(validateAmountAnswer("3"), { ok: true, value: 3 });
  assert.equal(validateAmountAnswer("abc").ok, false);
  const zero = validateAmountAnswer("0");
  assert.deepEqual(zero, { ok: false, error: "O valor precisa ser maior que R$ 0,00." });
  const high = validateAmountAnswer("2000000");
  assert.equal(high.ok, false);
  if (!high.ok) assert.match(high.error, /muito alto/);

  assert.deepEqual(validateDayAnswer("dia 8"), { ok: true, value: 8 });
  assert.equal(validateDayAnswer("32").ok, false);
  assert.equal(validateDayAnswer("0").ok, false);

  assert.deepEqual(validateLeadAnswer("2 horas"), { ok: true, value: 120 });
  assert.deepEqual(validateLeadAnswer("na hora"), { ok: true, value: 0 });
  assert.equal(validateLeadAnswer("31 dias").ok, false);
  assert.equal(validateLeadAnswer("bastante").ok, false);

  assert.deepEqual(validateTextAnswer("  Academia   Smart  "), { ok: true, value: "Academia Smart" });
  assert.deepEqual(validateTextAnswer("   "), { ok: false, error: "Não recebi nada." });
  assert.deepEqual(validateTextAnswer("x".repeat(MAX_TEXT_LENGTH)).ok, true);
  const long = validateTextAnswer("x".repeat(MAX_TEXT_LENGTH + 1));
  assert.deepEqual(long, { ok: false, error: "Esse texto está muito longo (máximo 100 caracteres)." });
});

test("validateDateAnswer: formatos comuns sem IA, data impossivel e fora da janela", async () => {
  assert.deepEqual(await validateDateAnswer("15/10", "2026-10-08"), { ok: true, value: "2026-10-15" });
  assert.deepEqual(await validateDateAnswer("ontem", "2026-10-08"), { ok: true, value: "2026-10-07" });
  const bad = await validateDateAnswer("31/02", "2026-10-08");
  assert.deepEqual(bad, { ok: false, error: "Essa data não parece certa (31/02/2026). Me manda o dia de novo, ex: 15/10 ou ontem." });
});

test("pendencia do menu de campos: um por numero, isolada, com TTL de 10 min", () => {
  const N = "551100130001";
  const base = { kind: "expense" as const, itemId: 1, header: "h", label: "l", stage: "choose_fields" as const, queue: [], step: 0, collected: {}, choices: [] };
  setPendingFieldMenu(N, base);
  setPendingFieldMenu(N, { ...base, itemId: 2 });
  assert.equal(getPendingFieldMenu(N)?.itemId, 2);
  assert.equal(getPendingFieldMenu("551100130002"), null);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 9 * 60 * 1000;
    assert.ok(getPendingFieldMenu(N));
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(getPendingFieldMenu(N), null);
  } finally {
    Date.now = realNow;
  }
  setPendingFieldMenu(N, base);
  clearPendingFieldMenu(N);
  assert.equal(getPendingFieldMenu(N), null);
});

test("lista numerada 'navegar' (editar -> tipo) e linha de gasto fixo", () => {
  assert.equal(recurringLine({ description: "Academia", amount: 89.9, day_of_month: 5 }), "Academia — R$ 89,90 · todo dia 5");
  const text = formatTargetList({
    kind: "event",
    header: { type: "browse" },
    verb: "editar",
    lines: ["Consulta dentista — sex 10/10 às 14:00", "Reunião cliente — seg 13/10 às 09:00"],
    total: 2,
  });
  assert.equal(
    text,
    "Seus próximos eventos:\n1. Consulta dentista — sex 10/10 às 14:00\n2. Reunião cliente — seg 13/10 às 09:00\n\nQual deles você quer editar? Responde com o número ou *cancelar*."
  );
  for (const [kind, title] of [
    ["expense", "Seus últimos gastos:"],
    ["reminder", "Seus lembretes:"],
    ["recurring", "Seus gastos fixos:"],
  ] as const) {
    assert.match(formatTargetList({ kind, header: { type: "browse" }, verb: "editar", lines: ["a"], total: 1 }), new RegExp(`^${title}`));
  }
  assert.match(formatTargetList({ kind: "recurring", header: { type: "found", query: "academia" }, verb: "editar", lines: ["a", "b"], total: 2 }), /Achei 2 gastos fixos com "academia":/);
});
