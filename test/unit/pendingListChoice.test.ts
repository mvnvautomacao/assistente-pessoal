import { test } from "node:test";
import assert from "node:assert/strict";
import { setPendingListChoice, getPendingListChoice, clearPendingListChoice } from "../../src/expenses/pendingListChoice";

test("guarda e devolve quantos dias estavam pendentes de escolha", () => {
  setPendingListChoice("5511900000010", 5);
  assert.deepEqual(getPendingListChoice("5511900000010")?.days, 5);
});

test("clearPendingListChoice remove o estado pendente", () => {
  setPendingListChoice("5511900000011", 3);
  clearPendingListChoice("5511900000011");
  assert.equal(getPendingListChoice("5511900000011"), null);
});

test("numero sem pendencia retorna null", () => {
  assert.equal(getPendingListChoice("5511900000098"), null);
});
