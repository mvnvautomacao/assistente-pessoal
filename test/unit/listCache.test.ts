import { test } from "node:test";
import assert from "node:assert/strict";
import { setLastShownExpenses, getLastShownExpenses, clearLastShownExpenses } from "../../src/expenses/listCache";

test("guarda e devolve a lista mostrada pra um numero", () => {
  setLastShownExpenses("5511900000001", [10, 20, 30]);
  assert.deepEqual(getLastShownExpenses("5511900000001"), [10, 20, 30]);
});

test("numeros diferentes tem caches independentes (isolamento multi-tenant)", () => {
  setLastShownExpenses("5511900000002", [1, 2]);
  setLastShownExpenses("5511900000003", [9, 8, 7]);
  assert.deepEqual(getLastShownExpenses("5511900000002"), [1, 2]);
  assert.deepEqual(getLastShownExpenses("5511900000003"), [9, 8, 7]);
});

test("clearLastShownExpenses invalida a referencia (simula 'mandou outra coisa no meio')", () => {
  setLastShownExpenses("5511900000004", [1, 2, 3]);
  clearLastShownExpenses("5511900000004");
  assert.equal(getLastShownExpenses("5511900000004"), null);
});

test("numero sem lista nenhuma retorna null", () => {
  assert.equal(getLastShownExpenses("5511900000099"), null);
});

test("uma nova lista para o mesmo numero substitui a anterior", () => {
  setLastShownExpenses("5511900000005", [1, 2, 3]);
  setLastShownExpenses("5511900000005", [4, 5]);
  assert.deepEqual(getLastShownExpenses("5511900000005"), [4, 5]);
});
