import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getClientBilling,
  listClientBilling,
  setClientBillingInfo,
  recordClientPayment,
  getPaymentHistory,
  getPaidMonthsForClient,
  deleteClientBilling,
  PLAN_PRICES,
} from "../../src/billing/service";
import { spDateString } from "../../src/timeSP";

const A = "551100120001";
const B = "551100120002";
const C = "551100120003";

test("cliente sem cobranca configurada nao aparece na listagem, e getClientBilling devolve null", () => {
  assert.equal(getClientBilling(A), null);
  assert.ok(!listClientBilling().some((c) => c.from_number === A));
});

test("setClientBillingInfo grava mensalidade e vencimento, e atualiza so o que foi passado", () => {
  setClientBillingInfo(A, { monthlyFee: 99.9, nextDueDate: "2026-10-05" });
  let b = getClientBilling(A)!;
  assert.equal(b.monthly_fee, 99.9);
  assert.equal(b.next_due_date, "2026-10-05");
  assert.equal(b.last_payment_date, null);
  assert.ok(listClientBilling().some((c) => c.from_number === A));

  // manda so o vencimento de novo -- a mensalidade que ja estava la nao pode sumir
  setClientBillingInfo(A, { nextDueDate: "2026-11-05" });
  b = getClientBilling(A)!;
  assert.equal(b.monthly_fee, 99.9);
  assert.equal(b.next_due_date, "2026-11-05");
});

test("PLAN_PRICES tem os valores fixos combinados: mensal R$19,90, anual R$179,90", () => {
  assert.equal(PLAN_PRICES.mensal, 19.9);
  assert.equal(PLAN_PRICES.anual, 179.9);
});

test("recordClientPayment (mensal) reinicia o vencimento pra 1 mes a partir de HOJE, nao do vencimento antigo, e usa o preco fixo", () => {
  setClientBillingInfo(B, { monthlyFee: 50, nextDueDate: "2020-01-01" }); // bem atrasado de proposito
  recordClientPayment(B, "mensal");
  const b = getClientBilling(B)!;
  assert.equal(b.monthly_fee, 19.9); // preco fixo do plano, sobrescreve o valor antigo
  assert.equal(b.plan, "mensal");
  assert.ok(b.last_payment_date); // hoje
  assert.notEqual(b.next_due_date, "2020-02-01"); // NAO conta a partir do vencimento antigo
  assert.equal(b.last_payment_date, spDateString());
});

test("recordClientPayment (anual) usa o preco anual e cobre 12 competencias no historico de meses pagos", () => {
  recordClientPayment(C, "anual");
  const b = getClientBilling(C)!;
  assert.equal(b.monthly_fee, 179.9);
  assert.equal(b.plan, "anual");

  const months = getPaidMonthsForClient(C);
  assert.equal(months.length, 12);

  const history = getPaymentHistory(C);
  assert.equal(history.length, 1);
  assert.equal(history[0].plan, "anual");
  assert.equal(history[0].amount, 179.9);
});

test("varios pagamentos mensais acumulam no historico sem duplicar competencias repetidas", () => {
  const D = "551100120004";
  recordClientPayment(D, "mensal");
  recordClientPayment(D, "mensal");
  assert.equal(getPaymentHistory(D).length, 2);
  // os 2 pagamentos foram feitos hoje -- cobrem a mesma competencia, entao o
  // conjunto de meses pagos (sem repetir) continua sendo so 1.
  assert.equal(getPaidMonthsForClient(D).length, 1);
});

test("deleteClientBilling remove o registro e o historico de pagamentos", () => {
  setClientBillingInfo(A, { monthlyFee: 10, nextDueDate: "2026-01-01" });
  recordClientPayment(A, "mensal");
  assert.ok(getClientBilling(A));
  assert.ok(getPaymentHistory(A).length > 0);
  deleteClientBilling(A);
  assert.equal(getClientBilling(A), null);
  assert.equal(getPaymentHistory(A).length, 0);
});

test("SEGURANCA/ISOLAMENTO: cobranca e historico de pagamento de um numero nao vazam pra outro", () => {
  setClientBillingInfo(A, { monthlyFee: 77, nextDueDate: "2026-05-05" });
  recordClientPayment(A, "anual");
  assert.equal(getClientBilling(B)?.monthly_fee === 77, false);
  assert.ok(!getPaymentHistory(B).some((p) => p.amount === 179.9 && p.from_number === A));
  assert.equal(getPaidMonthsForClient("551100120099").length, 0);
});
