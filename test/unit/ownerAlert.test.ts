import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAlertOwner } from "../../src/access/ownerAlert";

test("primeiro alerta pra uma chave sempre permite", () => {
  assert.equal(shouldAlertOwner("chave-unica-1"), true);
});

test("segundo alerta pra mesma chave dentro do cooldown e bloqueado (evita spam pro dono)", () => {
  const key = "chave-unica-2";
  assert.equal(shouldAlertOwner(key), true);
  assert.equal(shouldAlertOwner(key), false);
  assert.equal(shouldAlertOwner(key), false);
});

test("chaves diferentes sao independentes", () => {
  assert.equal(shouldAlertOwner("chave-a"), true);
  assert.equal(shouldAlertOwner("chave-b"), true);
});
