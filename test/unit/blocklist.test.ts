import { test } from "node:test";
import assert from "node:assert/strict";
import { isNumberBlocked, blockNumber, unblockNumber, listBlockedNumbers } from "../../src/access/blocklist";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { sendText } from "../../src/whatsapp/client";

const A = "551100130001";
const B = "551100130002";

test("blockNumber bloqueia, tira da lista de autorizados, e bloqueio vence a autorizacao", () => {
  allowNumber(A);
  assert.ok(isNumberAllowed(A));

  blockNumber(A, "bot de outra empresa");
  assert.ok(isNumberBlocked(A));
  assert.ok(!isNumberAllowed(A));
  assert.equal(listBlockedNumbers().find((b) => b.from_number === A)?.note, "bot de outra empresa");

  allowNumber(A); // mesmo autorizando de novo na mao, o bloqueio continua valendo
  assert.ok(!isNumberAllowed(A));
});

test("unblockNumber NAO autoriza de volta, e bloqueio de um numero nao afeta outro", () => {
  allowNumber(B);
  blockNumber(A);
  assert.ok(isNumberAllowed(B));
  assert.ok(!isNumberBlocked(B));

  assert.ok(unblockNumber(A));
  assert.ok(!isNumberBlocked(A));
  assert.ok(!isNumberAllowed(A)); // voltou pra "nao autorizado"
  assert.equal(unblockNumber(A), false);
});

test("sendText pra numero bloqueado nunca chama a Evolution API (cobre toda automacao)", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    blockNumber(A);
    await sendText(A, "lembrete qualquer");
    assert.equal(calls, 0);

    await sendText(B, "pra quem nao esta bloqueado");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
