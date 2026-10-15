import { test } from "node:test";
import assert from "node:assert/strict";
import { billCheckinOptions, billCheckinRepeat, buildBillAlertQuestion, classifyBillCheckinReply } from "../../src/bills/checkinReply";

const cases: [string[], ReturnType<typeof classifyBillCheckinReply>][] = [
  // 1 = pago (numero, por extenso, prefixos)
  [["1", " 1 ", "1.", "um", "Um.", "UM", "uma", "opção 1", "opcao um", "o 1", "número um"], "paid"],
  // frases claras de pago, com/sem acento, caixa, pontuacao e emoji
  [
    ["tá pago", "ta pago", "Tá pago!", "TA PAGO", "Tá pago! ✅", "está pago", "Já foi", "ja foi...", "já foi", "resolvido", "Resolvido.", "paguei", "Paguei!", "já paguei", "ja paguei", "pago", "feito", "Feito ✅", "quitado", "quitei", "já fiz", "comprei", "já comprei", "ok pago", "sim", "Sim!", "s", "resolvi", "👍"],
    "paid",
  ],
  // 2 = adiar
  [["2", "dois", "Dois.", "opção 2", "duas", "amanhã", "amanha", "Amanhã!", "ainda não", "ainda nao", "não", "nao", "Não.", "n", "depois", "mais tarde", "me lembra amanhã", "esqueci", "não paguei", "ainda não paguei", "ainda não, lembra amanhã", "❌"], "snooze"],
  // 3 = pular
  [["3", "três", "tres", "Três.", "opção 3", "pular", "Pular!", "pula", "não vou pagar", "nao vou pagar", "esse mês não", "esse mes nao", "não vou comprar"], "skip"],
  // ambiguo / misto / fora de lugar: NUNCA fecha nem adia
  [
    [
      "não, já paguei", "nao ja paguei", "sim, mas ainda não paguei", "paguei metade", "talvez", "sei lá", "", "   ", "?", "4", "9", "dez", "um pouco", "1 e 2", "um dois", "sim e não", "paguei e comprei", "pago amanhã",
      "não vou pagar hoje, amanhã eu pago", "gastei 50 no mercado", "igual", "120", "R$ 120", "bla bla bla bla bla bla bla bla", "pode ser", "já paguei ontem", "paguei parte",
    ],
    "unclear",
  ],
];

test("classifyBillCheckinReply: tabela de entradas (numeros, por extenso, frases claras, mistas, vazias, emoji, caixa)", () => {
  for (const [texts, expected] of cases) {
    for (const text of texts) assert.equal(classifyBillCheckinReply(text), expected, JSON.stringify(text));
  }
});

test("classifyBillCheckinReply: texto muito longo e frase clara dentro de frase longa nao valem (so a mensagem inteira)", () => {
  assert.equal(classifyBillCheckinReply("sim ".repeat(200)), "unclear");
  assert.equal(classifyBillCheckinReply("oi, tudo bem? então, acho que já paguei sim, mas não tenho certeza"), "unclear");
  assert.equal(classifyBillCheckinReply("x".repeat(5000)), "unclear");
});

test("buildBillAlertQuestion (RN16): lista 1/2/3, com texto proprio pro alerta por intervalo", () => {
  assert.equal(
    buildBillAlertQuestion({ name: "Conta de água", recurrenceType: "day_of_month" }),
    "📌 Hoje é dia de pagar: Conta de água.\n1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)"
  );
  assert.equal(
    buildBillAlertQuestion({ name: "Ração", recurrenceType: "interval" }),
    "📌 Hora de: Ração.\n1 ✅ Já resolvi\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou fazer agora (pular)"
  );
  assert.equal(billCheckinOptions("day_of_month"), "1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)");
});

test("billCheckinRepeat: repete a lista; cita a conta quando ha mais de um aviso esperando", () => {
  assert.equal(
    billCheckinRepeat({ name: "Conta de água", recurrenceType: "day_of_month" }),
    "Não entendi 🤔 Responde *1*, *2* ou *3*:\n1 ✅ Já paguei\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou pagar este mês (pular)"
  );
  assert.match(billCheckinRepeat({ name: "Ração", recurrenceType: "interval" }, { mentionName: true }), /^Não entendi 🤔 Sobre \*Ração\*, responde \*1\*, \*2\* ou \*3\*:\n1 ✅ Já resolvi/);
});

// ---- etapa do valor (RN01) -------------------------------------------------------------------------
import { BILL_VALUE_POSITIVE_TEXT, billValueQuestion, billValueRetry, interpretBillValueReply, parseSpokenNumber } from "../../src/bills/checkinValue";

test("interpretBillValueReply: valor (virgula, milhar, R$, reais, por extenso), 'igual', 'pular', invalido e outro", () => {
  const amount = (text: string) => interpretBillValueReply(text);
  for (const [text, value] of [
    ["120", 120], ["120,50", 120.5], ["120.50", 120.5], ["R$ 1.250,90", 1250.9], ["1.250,90", 1250.9], ["R$120", 120], ["120 reais", 120], ["120 conto", 120],
    ["cento e vinte", 120], ["cem", 100], ["duzentos e cinquenta", 250], ["dois mil", 2000], ["dois mil e quinhentos", 2500], ["mil", 1000], ["quinze", 15], ["  89,9  ", 89.9],
    ["1", 1], ["2", 2], ["3", 3], // nesta etapa 1, 2 e 3 NAO sao opcoes: sao valores
  ] as [string, number][]) {
    assert.deepEqual(amount(text), { kind: "amount", amount: value }, text);
  }
  for (const text of ["igual", "Igual!", "o mesmo", "mesmo valor", "igual ao anterior", "IGUAL"]) assert.deepEqual(amount(text), { kind: "same" }, text);
  for (const text of ["pular", "Pular!", "pula", "pula essa", "só marcar"]) assert.deepEqual(amount(text), { kind: "skip" }, text);
  for (const text of ["0", "-5", "0,00", "zero"]) {
    const reply = amount(text);
    assert.ok(reply.kind === "invalid" || reply.kind === "other", `${text}: ${JSON.stringify(reply)}`);
  }
  assert.deepEqual(amount("0"), { kind: "invalid", problem: BILL_VALUE_POSITIVE_TEXT });
  assert.deepEqual(amount("-50"), { kind: "invalid", problem: BILL_VALUE_POSITIVE_TEXT });
  for (const text of ["", "   ", "abc", "gastei 50 no mercado", "talvez", "ajuda", "cento e abacaxi", "sei lá quanto foi"]) assert.deepEqual(amount(text), { kind: "other" }, text);
});

test("parseSpokenNumber: so numeros por extenso; qualquer outra palavra invalida", () => {
  assert.equal(parseSpokenNumber("cento e vinte"), 120);
  assert.equal(parseSpokenNumber("Três mil e duzentos"), 3200);
  assert.equal(parseSpokenNumber("dezenove"), 19);
  assert.equal(parseSpokenNumber("vinte e cinco"), 25);
  assert.equal(parseSpokenNumber("uma mil"), 1000);
  assert.equal(parseSpokenNumber("cem reais"), null);
  assert.equal(parseSpokenNumber(""), null);
  assert.equal(parseSpokenNumber("e"), null);
});

test("billValueQuestion: com e sem o valor da ultima vez", () => {
  assert.equal(
    billValueQuestion("Conta de água", 118),
    "Boa! Quanto foi *Conta de água*? (ex: 120 ou 120,50)\nDa última vez: R$ 118,00 — responde *igual* pra repetir. Ou *pular* pra só marcar como feito."
  );
  assert.equal(billValueQuestion("Ração", null), "Boa! Quanto foi *Ração*? (ex: 120 ou 120,50)\nOu responde *pular* pra só marcar como feito.");
  assert.equal(billValueRetry("O valor precisa ser maior que R$ 0,00.", "Ração", null), "O valor precisa ser maior que R$ 0,00.\n" + billValueQuestion("Ração", null));
});
