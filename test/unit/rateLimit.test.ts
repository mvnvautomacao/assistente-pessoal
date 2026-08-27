import { test } from "node:test";
import assert from "node:assert/strict";
import { isRateLimited, recordMessageAndCheckLimit } from "../../src/access/rateLimit";

test("nao esta limitado antes de mandar qualquer mensagem", () => {
  assert.equal(isRateLimited("551100070001"), false);
});

test("recordMessageAndCheckLimit so retorna true depois de passar de 20 mensagens na janela", () => {
  const B = "551100070002";
  for (let i = 0; i < 20; i++) {
    assert.equal(recordMessageAndCheckLimit(B), false);
  }
  assert.equal(recordMessageAndCheckLimit(B), true); // a 21a estoura
});

test("depois de estourar, isRateLimited fica true (cooldown ativo)", () => {
  const C = "551100070003";
  for (let i = 0; i < 21; i++) recordMessageAndCheckLimit(C);
  assert.equal(isRateLimited(C), true);
});

test("numeros diferentes tem contadores independentes", () => {
  const D = "551100070004";
  const E = "551100070005";
  for (let i = 0; i < 21; i++) recordMessageAndCheckLimit(D);
  assert.equal(isRateLimited(D), true);
  assert.equal(isRateLimited(E), false); // E nunca mandou nada, nao e afetado por D
  assert.equal(recordMessageAndCheckLimit(E), false); // E ainda nao passou do limite dele
});
