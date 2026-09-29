import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getClientBilling,
  listClientBilling,
  setClientBillingInfo,
  markClientPaymentReceived,
  deleteClientBilling,
} from "../../src/billing/service";
import { spDateString } from "../../src/timeSP";

const A = "551100120001";
const B = "551100120002";

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

test("markClientPaymentReceived reinicia o vencimento pra 1 mes a partir de HOJE, nao do vencimento antigo, e preserva a mensalidade", () => {
  setClientBillingInfo(B, { monthlyFee: 50, nextDueDate: "2020-01-01" }); // bem atrasado de proposito
  markClientPaymentReceived(B);
  const b = getClientBilling(B)!;
  assert.equal(b.monthly_fee, 50); // preservada
  assert.ok(b.last_payment_date); // hoje
  assert.notEqual(b.next_due_date, "2020-02-01"); // NAO conta a partir do vencimento antigo
  assert.equal(b.last_payment_date, spDateString());
});

test("deleteClientBilling remove o registro", () => {
  setClientBillingInfo(A, { monthlyFee: 10, nextDueDate: "2026-01-01" });
  assert.ok(getClientBilling(A));
  deleteClientBilling(A);
  assert.equal(getClientBilling(A), null);
});

test("SEGURANCA/ISOLAMENTO: cobranca de um numero nao vaza pra outro", () => {
  setClientBillingInfo(A, { monthlyFee: 77, nextDueDate: "2026-05-05" });
  assert.equal(getClientBilling(B)?.monthly_fee === 77, false);
});
