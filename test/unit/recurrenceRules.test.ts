import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMOUNT_RANGE_TEXT,
  DAY_RANGE_TEXT,
  INTERVAL_RANGE_TEXT,
  MIN_DUPLICATE_LETTERS,
  dayAlreadyPassed,
  daysInMonthOf,
  decideMode,
  dueDateThisMonth,
  effectiveDay,
  extractFromText,
  findDuplicate,
  missingFields,
  namesOverlap,
  parseFillAnswer,
  reconcileKind,
  sanitizeDraft,
} from "../../src/recurrence/rules";

test("extractFromText: frases da especificacao (nome, valor, dia, intervalo)", () => {
  const cases: [string, { description?: string; amount?: number; dayOfMonth?: number; intervalDays?: number }][] = [
    ["internet 100 dia 10", { description: "Internet", amount: 100, dayOfMonth: 10 }],
    ["todo dia 10 pago 50 de internet", { description: "Internet", amount: 50, dayOfMonth: 10 }],
    ["15 reais gasto fixo dia 10", { amount: 15, dayOfMonth: 10 }],
    ["15 reais gasto fixo", { amount: 15 }],
    ["gasto fixo internet dia 10", { description: "Internet", dayOfMonth: 10 }],
    ["ração 80 reais a cada 45 dias", { description: "Ração", amount: 80, intervalDays: 45 }],
    ["luz todo dia 5", { description: "Luz", dayOfMonth: 5 }],
    ["academia", { description: "Academia" }],
    ["Água", { description: "Água" }],
    ["1.250,90 aluguel dia 5", { description: "Aluguel", amount: 1250.9, dayOfMonth: 5 }],
    ["R$ 99,90 netflix dia 20", { description: "Netflix", amount: 99.9, dayOfMonth: 20 }],
    ["2 mil aluguel dia 1", { description: "Aluguel", amount: 2000, dayOfMonth: 1 }],
    ["conta de luz dia 5", { description: "Conta de luz", dayOfMonth: 5 }],
  ];
  for (const [text, expected] of cases) {
    const found = extractFromText(text);
    assert.equal(found.description, expected.description, `${text}: nome`);
    assert.equal(found.amount, expected.amount, `${text}: valor`);
    assert.equal(found.dayOfMonth, expected.dayOfMonth, `${text}: dia`);
    assert.equal(found.intervalDays, expected.intervalDays, `${text}: intervalo`);
    assert.deepEqual(found.problems, [], text);
  }
});

test("extractFromText: intervalos em dias, semanas e meses ('de N em N', 'a cada um mes')", () => {
  const intervals: [string, number][] = [
    ["a cada 45 dias", 45],
    ["de 15 em 15 dias", 15],
    ["a cada 2 semanas", 14],
    ["a cada 2 meses", 60],
    ["a cada um mes", 30],
    ["a cada duas semanas", 14],
    ["A CADA 10 DIAS", 10],
  ];
  for (const [text, days] of intervals) assert.equal(extractFromText(`filtro ${text}`).intervalDays, days, text);
  // intervalo ganha do "dia N" e o numero do intervalo nao vira valor
  const both = extractFromText("racao a cada 45 dias");
  assert.equal(both.amount, undefined);
  assert.equal(both.dayOfMonth, undefined);
});

test("extractFromText: valores e dias invalidos viram problema (nao dado)", () => {
  assert.deepEqual(extractFromText("internet 100 dia 40").problems, [DAY_RANGE_TEXT]);
  assert.equal(extractFromText("internet 100 dia 40").dayOfMonth, undefined);
  assert.equal(extractFromText("internet 100 dia 40").amount, 100);
  assert.deepEqual(extractFromText("internet 0 dia 10").problems, [AMOUNT_RANGE_TEXT]);
  assert.equal(extractFromText("internet 0 dia 10").amount, undefined);
  assert.deepEqual(extractFromText("internet -50 dia 10").problems, [AMOUNT_RANGE_TEXT]);
  assert.deepEqual(extractFromText("filtro a cada 0 dias").problems, [INTERVAL_RANGE_TEXT]);
  assert.match(extractFromText("filtro a cada 9999 dias").problems[0], /no máximo 3650/);
  assert.deepEqual(extractFromText("dia 0").problems, [DAY_RANGE_TEXT]);
});

test("extractFromText: acento, caixa, emoji, pontuacao e espacos estranhos no nome", () => {
  assert.equal(extractFromText("  ÁGUA,   dia   5!! ").description, "ÁGUA");
  assert.equal(extractFromText("Mensalidade acadêmica dia 5").description, "Mensalidade acadêmica");
  assert.equal(extractFromText("🎬 streaming 40 dia 3").description, "Streaming");
  assert.equal(extractFromText("seguro do carro 300 dia 9").description, "Seguro do carro");
  assert.equal(extractFromText("").description, undefined);
  assert.equal(extractFromText("   ").description, undefined);
  assert.equal(extractFromText("gasto fixo").description, undefined);
});

test("parseFillAnswer: cada pergunta aceita varios dados e valida o que foi perguntado", () => {
  // nome + valor + dia numa resposta so (RN06)
  assert.deepEqual(parseFillAnswer("description", "internet 100 dia 10").patch, { description: "Internet", amount: 100, dayOfMonth: 10 });
  assert.deepEqual(parseFillAnswer("description", "academia").patch, { description: "Academia" });
  assert.equal(parseFillAnswer("description", "academia").problem, undefined);
  assert.ok(parseFillAnswer("description", "100").problem, "so numero nao e nome");
  // valor
  assert.deepEqual(parseFillAnswer("amount", "100").patch, { amount: 100 });
  assert.deepEqual(parseFillAnswer("amount", "R$ 99,90").patch, { amount: 99.9 });
  assert.deepEqual(parseFillAnswer("amount", "1.250,90").patch, { amount: 1250.9 });
  assert.deepEqual(parseFillAnswer("amount", "100 reais").patch, { amount: 100 });
  assert.equal(parseFillAnswer("amount", "0").problem, AMOUNT_RANGE_TEXT);
  assert.ok(parseFillAnswer("amount", "bla").problem);
  assert.deepEqual(parseFillAnswer("amount", "100 dia 10").patch, { amount: 100, dayOfMonth: 10 });
  // dia/intervalo: numero solto e o dia do mes
  assert.deepEqual(parseFillAnswer("schedule", "10").patch, { dayOfMonth: 10 });
  assert.deepEqual(parseFillAnswer("schedule", "dia 8").patch, { dayOfMonth: 8 });
  assert.deepEqual(parseFillAnswer("schedule", "a cada 45 dias").patch, { intervalDays: 45 });
  assert.equal(parseFillAnswer("schedule", "40").problem, DAY_RANGE_TEXT);
  assert.equal(parseFillAnswer("schedule", "0").problem, DAY_RANGE_TEXT);
  assert.ok(parseFillAnswer("schedule", "qualquer hora").problem);
});

test("sanitizeDraft: valores invalidos da IA saem do rascunho e viram pergunta (RN07)", () => {
  const ok = sanitizeDraft({ description: " Internet ", amount: 100, dayOfMonth: 10 });
  assert.deepEqual(ok, { draft: { description: "Internet", amount: 100, dayOfMonth: 10 }, problems: [] });
  const bad = sanitizeDraft({ description: "", amount: 0, dayOfMonth: 40, intervalDays: 0 });
  assert.deepEqual(bad.draft, {});
  assert.deepEqual(bad.problems, [AMOUNT_RANGE_TEXT, DAY_RANGE_TEXT, INTERVAL_RANGE_TEXT]);
  assert.deepEqual(sanitizeDraft({ amount: -3, dayOfMonth: 2.5 }).problems, [AMOUNT_RANGE_TEXT, DAY_RANGE_TEXT]);
  // dia e intervalo juntos: vale o intervalo
  assert.deepEqual(sanitizeDraft({ description: "x", dayOfMonth: 5, intervalDays: 20 }).draft, { description: "x", intervalDays: 20 });
});

test("decideMode e reconcileKind: intervalo => alerta (valor descartado); 'conta fixa' sem valor e ambigua (RN01 a RN04)", () => {
  // RN01/RN03
  assert.equal(decideMode("recurring_expense", { description: "x", amount: 80, intervalDays: 45 }), "bill_alert");
  const reconciled = reconcileKind("recurring_expense", { description: "Ração", amount: 80, intervalDays: 45 });
  assert.equal(reconciled.mode, "bill_alert");
  assert.deepEqual(reconciled.draft, { description: "Ração", intervalDays: 45, ignoredAmount: 80 });
  // RN02: dia + valor => gasto fixo; RN04: sem valor e sem aviso => pergunta
  assert.equal(decideMode("unclear", { description: "Internet", dayOfMonth: 10, amount: 100 }), "recurring_expense");
  assert.equal(decideMode("unclear", { description: "Internet", dayOfMonth: 10 }), "unclear");
  assert.equal(decideMode("bill_alert", { description: "Luz", dayOfMonth: 5 }), "bill_alert");
  assert.equal(decideMode("recurring_expense", { description: "Internet", dayOfMonth: 10 }), "recurring_expense");
  // sem intervalo nada muda
  const same = reconcileKind("unclear", { description: "x", dayOfMonth: 3 });
  assert.deepEqual(same, { mode: "unclear", draft: { description: "x", dayOfMonth: 3 } });
});

test("missingFields: ordem nome -> valor -> dia/intervalo; alerta e 'unclear' nao pedem valor (RN05)", () => {
  assert.deepEqual(missingFields("recurring_expense", {}), ["description", "amount", "schedule"]);
  assert.deepEqual(missingFields("recurring_expense", { amount: 15, dayOfMonth: 10 }), ["description"]);
  assert.deepEqual(missingFields("recurring_expense", { description: "Internet", dayOfMonth: 10 }), ["amount"]);
  assert.deepEqual(missingFields("recurring_expense", { description: "Internet", amount: 1 }), ["schedule"]);
  assert.deepEqual(missingFields("recurring_expense", { description: "Internet", amount: 1, dayOfMonth: 10 }), []);
  assert.deepEqual(missingFields("bill_alert", {}), ["description", "schedule"]);
  assert.deepEqual(missingFields("bill_alert", { description: "Ração", intervalDays: 45 }), []);
  assert.deepEqual(missingFields("unclear", { description: "Internet" }), ["schedule"]);
  assert.deepEqual(missingFields("recurring_expense", { description: "   ", amount: 1, dayOfMonth: 1 }), ["description"]);
});

test("duplicata: nome igual ou um contem o outro (min. 3 letras), sem acento nem caixa (RN09)", () => {
  assert.equal(MIN_DUPLICATE_LETTERS, 3);
  assert.equal(namesOverlap("Água", "agua"), true);
  assert.equal(namesOverlap("Internet", "internet fibra"), true);
  assert.equal(namesOverlap("internet fibra", "Internet"), true);
  assert.equal(namesOverlap("Conta de luz", "luz"), true);
  assert.equal(namesOverlap("Luz", "Internet"), false);
  assert.equal(namesOverlap("TV", "Netflix TV"), false, "2 letras nao bastam pra 'conter'");
  assert.equal(namesOverlap("TV", "tv"), true, "mas igual vale");
  assert.equal(namesOverlap("", "x"), false);
  const items = [
    { id: 1, name: "Academia" },
    { id: 2, name: "Internet fibra" },
  ];
  assert.equal(findDuplicate(items, "INTERNET")?.id, 2);
  assert.equal(findDuplicate(items, "academia smart")?.id, 1);
  assert.equal(findDuplicate(items, "Luz"), null);
  assert.equal(findDuplicate([], "Luz"), null);
});

test("mes corrente: dia ja passou? (31 em mes curto, 06:59 x 07:00, ultimo dia do mes)", () => {
  // outubro tem 31 dias, novembro 30, fevereiro 28/29
  assert.equal(daysInMonthOf("2026-10-15"), 31);
  assert.equal(daysInMonthOf("2026-11-15"), 30);
  assert.equal(daysInMonthOf("2026-02-15"), 28);
  assert.equal(daysInMonthOf("2028-02-15"), 29);
  assert.equal(effectiveDay(31, "2026-11-15"), 30);
  assert.equal(effectiveDay(31, "2028-02-15"), 29);
  assert.equal(effectiveDay(10, "2026-11-15"), 10);

  // dia anterior a hoje: passou
  assert.equal(dayAlreadyPassed(10, "2026-10-15", 12), true);
  // dia ainda nao chegou: nao passou
  assert.equal(dayAlreadyPassed(10, "2026-10-08", 12), false);
  // no proprio dia: antes das 7h o cron ainda vai lancar; a partir das 7h ja passou
  assert.equal(dayAlreadyPassed(10, "2026-10-10", 6), false, "06:59");
  assert.equal(dayAlreadyPassed(10, "2026-10-10", 7), true, "07:00");
  assert.equal(dayAlreadyPassed(10, "2026-10-10", 23), true);
  // dia 31 num mes de 30 dias: hoje dia 30 depois das 7h ja passou; antes das 7h, nao
  assert.equal(dayAlreadyPassed(31, "2026-11-30", 12), true);
  assert.equal(dayAlreadyPassed(31, "2026-11-30", 6), false);
  assert.equal(dayAlreadyPassed(31, "2026-11-29", 12), false);
  // fevereiro: dia 30 cai no 28
  assert.equal(dayAlreadyPassed(30, "2026-02-28", 8), true);
  assert.equal(dayAlreadyPassed(30, "2026-02-27", 8), false);

  assert.equal(dueDateThisMonth(10, "2026-10-15"), "2026-10-10");
  assert.equal(dueDateThisMonth(5, "2026-10-15"), "2026-10-05");
  assert.equal(dueDateThisMonth(31, "2026-11-30"), "2026-11-30");
  assert.equal(dueDateThisMonth(31, "2028-02-10"), "2028-02-29");
});
