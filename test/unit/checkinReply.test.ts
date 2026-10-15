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
