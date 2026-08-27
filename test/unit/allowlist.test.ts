import { test } from "node:test";
import assert from "node:assert/strict";
import { isNumberAllowed, allowNumber, revokeNumber, listAllowedNumbers } from "../../src/access/allowlist";

const A = "551100060001";
const B = "551100060002";

test("numero nao autorizado por padrao", () => {
  assert.equal(isNumberAllowed(A), false);
});

test("allowNumber autoriza e listAllowedNumbers lista", () => {
  allowNumber(A, "cliente teste");
  assert.equal(isNumberAllowed(A), true);
  assert.ok(listAllowedNumbers().some((a) => a.from_number === A && a.note === "cliente teste"));
});

test("allowNumber de novo (mesmo numero) atualiza a nota em vez de duplicar", () => {
  allowNumber(B, "nota original");
  allowNumber(B, "nota atualizada");
  const matches = listAllowedNumbers().filter((a) => a.from_number === B);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].note, "nota atualizada");
});

test("revokeNumber bloqueia de novo", () => {
  allowNumber(A);
  assert.equal(isNumberAllowed(A), true);
  assert.equal(revokeNumber(A), true);
  assert.equal(isNumberAllowed(A), false);
});

test("revokeNumber de numero que nao esta na lista retorna false", () => {
  assert.equal(revokeNumber("551100060099"), false);
});
