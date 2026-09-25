import { test } from "node:test";
import assert from "node:assert/strict";
import { getMonthBalance, setPaymentMethodLimit, isCardMethodName } from "../../src/expenses/balance";
import { ensureUserSeeded, getOrCreatePaymentMethod, insertExpense } from "../../src/expenses/service";
import { insertIncome } from "../../src/incomes/service";

const A = "551100110001";
const B = "551100110002";
const MONTH = "2026-05";

test("isCardMethodName reconhece cartao/credito/debito e ignora Pix/dinheiro", () => {
  assert.ok(isCardMethodName("Cartão de crédito"));
  assert.ok(isCardMethodName("Cartao Nubank"));
  assert.ok(isCardMethodName("débito"));
  assert.ok(!isCardMethodName("Pix"));
  assert.ok(!isCardMethodName("Dinheiro"));
});

test("saldo: Pix/dinheiro/sem forma abatem das entradas; cartao NAO abate, so do limite (se informado)", () => {
  ensureUserSeeded(A);
  const pix = getOrCreatePaymentMethod(A, "Pix");
  const card = getOrCreatePaymentMethod(A, "Cartão de crédito");
  insertIncome({ fromNumber: A, amount: 3000, description: "salario", date: `${MONTH}-05` });
  insertExpense({ fromNumber: A, amount: 200, description: "no pix", categoryId: null, paymentMethodId: pix.id, date: `${MONTH}-06` });
  insertExpense({ fromNumber: A, amount: 50, description: "sem forma", categoryId: null, paymentMethodId: null, date: `${MONTH}-07` });
  insertExpense({ fromNumber: A, amount: 700, description: "no cartao", categoryId: null, paymentMethodId: card.id, date: `${MONTH}-08` });
  insertExpense({ fromNumber: A, amount: 999, description: "outro mes", categoryId: null, paymentMethodId: pix.id, date: "2026-06-01" });

  // sem limite informado: nada de cartao na lista, e o cartao nao abate o saldo
  let b = getMonthBalance(A, MONTH);
  assert.equal(b.incomeTotal, 3000);
  assert.equal(b.spentNonCard, 250);
  assert.equal(b.spentCard, 700);
  assert.equal(b.balance, 2750);
  assert.equal(b.cards.length, 0);

  setPaymentMethodLimit(A, card.id, 2000);
  b = getMonthBalance(A, MONTH);
  assert.equal(b.balance, 2750); // continua igual
  assert.equal(b.cards.length, 1);
  assert.equal(b.cards[0].available, 1300); // 2000 - 700

  setPaymentMethodLimit(A, card.id, null); // remover o limite some de novo
  assert.equal(getMonthBalance(A, MONTH).cards.length, 0);
});

test("SEGURANCA: limite de cartao so muda pro dono", () => {
  ensureUserSeeded(A);
  ensureUserSeeded(B);
  const card = getOrCreatePaymentMethod(A, "Cartão do A");
  setPaymentMethodLimit(B, card.id, 5);
  assert.equal(getMonthBalance(A, MONTH).cards.some((c) => c.id === card.id), false);
});
