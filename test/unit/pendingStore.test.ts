import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import {
  EXPIRED_NOTICE_WINDOW_MS,
  assertSerializable,
  clearAllPending,
  clearPending,
  findExpiredUnnotified,
  getPending,
  markExpiredNotified,
  purgeOld,
  resetPendingStoreForTests,
  setPending,
} from "../../src/pending/store";
import { consumeExpiredNotice, expiredNoticeText, replyShape } from "../../src/pending/expiredNotice";
import { UNDO_HINT, withUndoHint } from "../../src/undo/replyWithUndo";

const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;

// o store nunca lanca: falhas viram log -- nos testes de erro o log e esperado, entao silencia
function silenceConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test("store: grava, le, substitui por (numero, tipo) e apaga", () => {
  const N = "551100170001";
  setPending(N, "edit_event", { payload: { a: 1 }, label: "Consulta", ttlMs: 10 * MIN, version: 1, now: T0 });
  const stored = getPending<{ a: number }>(N, "edit_event", 1, T0 + MIN);
  assert.deepEqual(stored, { payload: { a: 1 }, label: "Consulta", createdAt: T0, expiresAt: T0 + 10 * MIN });

  // outro tipo no mesmo numero convive; o mesmo tipo substitui
  setPending(N, "edit_income", { payload: { b: 2 }, ttlMs: 10 * MIN, version: 1, now: T0 });
  setPending(N, "edit_event", { payload: { a: 99 }, label: "Outra", ttlMs: 10 * MIN, version: 1, now: T0 + 5 * MIN });
  assert.equal(getPending<{ a: number }>(N, "edit_event", 1, T0 + 6 * MIN)?.payload.a, 99);
  assert.equal(getPending<{ a: number }>(N, "edit_event", 1, T0 + 6 * MIN)?.createdAt, T0 + 5 * MIN);
  assert.equal(getPending(N, "edit_income", 1, T0 + 6 * MIN)?.label, null);

  clearPending(N, "edit_event");
  assert.equal(getPending(N, "edit_event", 1, T0 + 6 * MIN), null);
  assert.ok(getPending(N, "edit_income", 1, T0 + 6 * MIN));
  clearAllPending(N);
  assert.equal(getPending(N, "edit_income", 1, T0 + 6 * MIN), null);
});

test("store: isolado por numero", () => {
  const A = "551100170002";
  const B = "551100170003";
  setPending(A, "undo", { payload: { x: "A" }, ttlMs: 10 * MIN, version: 1, now: T0 });
  setPending(B, "undo", { payload: { x: "B" }, ttlMs: 10 * MIN, version: 1, now: T0 });
  clearAllPending(A);
  assert.equal(getPending(A, "undo", 1, T0), null);
  assert.deepEqual(getPending<{ x: string }>(B, "undo", 1, T0)?.payload, { x: "B" });
});

test("store: TTL -- ativa ate expires_at, depois null (mas a linha fica pro aviso)", () => {
  const N = "551100170004";
  setPending(N, "edit_expense", { payload: {}, label: "Mercado", ttlMs: 10 * MIN, version: 1, now: T0 });
  assert.ok(getPending(N, "edit_expense", 1, T0 + 10 * MIN));
  assert.equal(getPending(N, "edit_expense", 1, T0 + 10 * MIN + 1), null);
  const row = db.prepare(`SELECT kind FROM pending_state WHERE from_number = ?`).get(N);
  assert.ok(row, "linha vencida continua guardada");
});

test("store: versao diferente e JSON invalido sao descartados com log", () => {
  const N = "551100170005";
  setPending(N, "field_menu", { payload: { v: 1 }, ttlMs: 10 * MIN, version: 1, now: T0 });
  silenceConsoleError(() => assert.equal(getPending(N, "field_menu", 2, T0), null));
  assert.equal(db.prepare(`SELECT 1 FROM pending_state WHERE from_number = ? AND kind = 'field_menu'`).get(N), undefined);

  db.prepare(`INSERT OR REPLACE INTO pending_state (from_number, kind, payload, version, label, created_at, expires_at, expired_notified) VALUES (?, 'field_menu', '{nao e json', 1, NULL, ?, ?, 0)`).run(N, T0, T0 + 10 * MIN);
  silenceConsoleError(() => assert.equal(getPending(N, "field_menu", 1, T0), null));
  assert.equal(db.prepare(`SELECT 1 FROM pending_state WHERE from_number = ? AND kind = 'field_menu'`).get(N), undefined);
});

test("serializacao: Date, Map, Set, funcao e numero nao finito sao rejeitados; aninhado tambem", () => {
  assert.doesNotThrow(() => assertSerializable({ a: [1, "x", null, undefined, { b: true }] }));
  assert.throws(() => assertSerializable({ when: new Date() }), /Date/);
  assert.throws(() => assertSerializable({ m: new Map() }), /Map/);
  assert.throws(() => assertSerializable({ s: new Set() }), /Set/);
  assert.throws(() => assertSerializable({ f: () => 1 }), /function/);
  assert.throws(() => assertSerializable({ n: Number.NaN }), /finito/);
  assert.throws(() => assertSerializable({ list: [{ deep: new Date() }] }), /list\[0\]\.deep/);
  assert.throws(() => assertSerializable({ b: 10n }), /bigint/);

  // no store: o erro de programacao vira log e nada e gravado (o webhook nao cai)
  const N = "551100170006";
  silenceConsoleError(() => setPending(N, "undo", { payload: { when: new Date() }, ttlMs: MIN, version: 1, now: T0 }));
  assert.equal(getPending(N, "undo", 1, T0), null);
});

test("store: vencidas nao avisadas (mais recente primeiro), marcar como avisadas e limpeza", () => {
  const N = "551100170007";
  setPending(N, "edit_event", { payload: {}, label: "Consulta", ttlMs: 10 * MIN, version: 1, now: T0 });
  setPending(N, "undo", { payload: {}, label: "Mercado", ttlMs: 10 * MIN, version: 1, now: T0 + 2 * MIN });
  setPending(N, "edit_income", { payload: {}, label: "Salario", ttlMs: 10 * MIN, version: 1, now: T0 + 40 * MIN });

  // ninguem venceu ainda
  assert.deepEqual(findExpiredUnnotified(N, T0 + 5 * MIN), []);
  // duas venceram (a do undo e a mais recente); a de entrada ainda e ativa
  const expired = findExpiredUnnotified(N, T0 + 20 * MIN);
  assert.deepEqual(expired.map((e) => [e.kind, e.label]), [["undo", "Mercado"], ["edit_event", "Consulta"]]);
  // depois da janela de 60 min, nao avisa mais
  assert.ok(!findExpiredUnnotified(N, T0 + 10 * MIN + EXPIRED_NOTICE_WINDOW_MS + 1).some((e) => e.kind === "edit_event"));

  markExpiredNotified(N, T0 + 20 * MIN);
  assert.deepEqual(findExpiredUnnotified(N, T0 + 20 * MIN), []);
  assert.ok(getPending(N, "edit_income", 1, T0 + 41 * MIN), "pendencia ativa nao e tocada");

  // limpeza: so apaga o que venceu ha mais de 60 min
  const removed = purgeOld(T0 + 10 * MIN + EXPIRED_NOTICE_WINDOW_MS + 1);
  assert.ok(removed >= 1);
  assert.equal(db.prepare(`SELECT 1 FROM pending_state WHERE from_number = ? AND kind = 'edit_event'`).get(N), undefined);
  assert.ok(db.prepare(`SELECT 1 FROM pending_state WHERE from_number = ? AND kind = 'edit_income'`).get(N), "mais nova permanece");
  resetPendingStoreForTests();
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM pending_state`).get() as { n: number }).n, 0);
});

test("replyShape: so respostas de pendencia (sim/nao/numero/desfazer), nunca pedido completo", () => {
  for (const text of ["1", "sim", "Sim!", "3", "não", "cancelar", "2", "o 4", "oito", "ok", "pode"]) {
    assert.equal(replyShape(text), "reply", `"${text}"`);
  }
  for (const text of ["desfazer", "desfaz isso", "Desfaz!", "desfazer a última"]) assert.equal(replyShape(text), "undo", `"${text}"`);
  for (const text of ["muda o mercado pra 40", "10", "oi", "gastei 50 no mercado", "corrigir", ""]) assert.equal(replyShape(text), null, `"${text}"`);
});

test("textos do aviso de expiracao por tipo (RN10)", () => {
  assert.equal(
    expiredNoticeText({ kind: "edit_expense", label: "Mercado — R$ 38,00" }),
    '⌛ A confirmação de "Mercado — R$ 38,00" expirou (passaram mais de 10 minutos) e eu não mexi em nada. Se ainda quiser, é só pedir de novo.'
  );
  for (const kind of ["edit_event", "edit_reminder", "edit_recurring", "edit_income", "delete_income", "field_menu"] as const) {
    assert.match(expiredNoticeText({ kind, label: "X" }), /^⌛ A confirmação de "X" expirou/);
  }
  const list = '⌛ A lista de opções expirou (passaram mais de 10 minutos). Me diz de novo o que você quer fazer, ex: "muda o mercado pra 40".';
  assert.equal(expiredNoticeText({ kind: "target_choice", label: "lista de opções" }), list);
  assert.equal(expiredNoticeText({ kind: "edit_target", label: null }), list);
  assert.equal(
    expiredNoticeText({ kind: "undo", label: "Mercado: R$ 38,00 → R$ 40,00" }),
    '⌛ O prazo pra desfazer "Mercado: R$ 38,00 → R$ 40,00" já passou (10 minutos). Se precisar corrigir, é só pedir a edição de novo.'
  );
  assert.match(expiredNoticeText({ kind: "undo", label: null }), /desfazer "essa ação"/);
  assert.match(expiredNoticeText({ kind: "edit_event", label: null }), /confirmação de "essa alteração"/);
});

test("consumeExpiredNotice: avisa uma vez (a mais recente), separa 'desfaz' das demais respostas, ignora pedido completo", () => {
  const N = "551100170008";
  setPending(N, "edit_event", { payload: {}, label: "Consulta", ttlMs: 10 * MIN, version: 1, now: T0 });
  setPending(N, "edit_income", { payload: {}, label: "Salario", ttlMs: 10 * MIN, version: 1, now: T0 + MIN });
  setPending(N, "undo", { payload: {}, label: "Mercado", ttlMs: 10 * MIN, version: 1, now: T0 + 2 * MIN });
  const later = T0 + 30 * MIN;

  assert.equal(consumeExpiredNotice(N, "muda o mercado pra 40", later), null); // pedido completo: nada
  assert.equal(consumeExpiredNotice(N, "desfaz isso", later), expiredNoticeText({ kind: "undo", label: "Mercado" }));
  // "desfaz" marcou TODAS como avisadas: o "1" seguinte nao gera outro aviso
  assert.equal(consumeExpiredNotice(N, "1", later), null);

  const M = "551100170009";
  setPending(M, "edit_event", { payload: {}, label: "Consulta", ttlMs: 10 * MIN, version: 1, now: T0 });
  setPending(M, "edit_income", { payload: {}, label: "Salario", ttlMs: 10 * MIN, version: 1, now: T0 + MIN });
  setPending(M, "undo", { payload: {}, label: "Mercado", ttlMs: 10 * MIN, version: 1, now: T0 + 2 * MIN });
  // "1" nao fala do desfazer: avisa a confirmacao mais recente (entrada), ignorando o undo
  assert.equal(consumeExpiredNotice(M, "1", later), expiredNoticeText({ kind: "edit_income", label: "Salario" }));
  assert.equal(consumeExpiredNotice(M, "1", later), null);
  assert.equal(consumeExpiredNotice(M, "sim", later), null);

  // so desfazer vencido e a pessoa diz "sim": nada a explicar
  const K = "551100170010";
  setPending(K, "undo", { payload: {}, label: "X", ttlMs: 10 * MIN, version: 1, now: T0 });
  assert.equal(consumeExpiredNotice(K, "sim", later), null);
  // ... e so confirmacao vencida e a pessoa diz "desfaz": tambem nada
  const L = "551100170011";
  setPending(L, "edit_event", { payload: {}, label: "X", ttlMs: 10 * MIN, version: 1, now: T0 });
  assert.equal(consumeExpiredNotice(L, "desfaz", later), null);
  // sem janela: venceu ha mais de 60 min
  assert.equal(consumeExpiredNotice(L, "1", T0 + 10 * MIN + EXPIRED_NOTICE_WINDOW_MS + 1), null);
  // sem nada vencido
  assert.equal(consumeExpiredNotice("551100179999", "1", later), null);
});

test("dica de desfazer: acrescentada uma vez, em linha propria, sem duplicar", () => {
  assert.equal(UNDO_HINT, "Errou? Responde *desfazer*.");
  assert.equal(withUndoHint("✅ Pronto!"), "✅ Pronto!\nErrou? Responde *desfazer*.");
  const once = withUndoHint("✅ Pronto!");
  assert.equal(withUndoHint(once), once);
  assert.equal(withUndoHint("⏰ Adiado! Errou? Responde *desfazer*."), "⏰ Adiado! Errou? Responde *desfazer*.");
});

test("store: falha do banco vira log e nunca derruba o fluxo (sem pendencia)", () => {
  const N = "551100170020";
  setPending(N, "undo", { payload: { x: 1 }, ttlMs: 10 * MIN, version: 1, now: T0 });
  db.exec(`ALTER TABLE pending_state RENAME TO pending_state_off`);
  try {
    silenceConsoleError(() => {
      assert.doesNotThrow(() => setPending(N, "undo", { payload: {}, ttlMs: MIN, version: 1, now: T0 }));
      assert.equal(getPending(N, "undo", 1, T0), null);
      assert.doesNotThrow(() => clearPending(N, "undo"));
      assert.doesNotThrow(() => clearAllPending(N));
      assert.deepEqual(findExpiredUnnotified(N, T0 + 20 * MIN), []);
      assert.doesNotThrow(() => markExpiredNotified(N, T0));
      assert.equal(purgeOld(T0), 0);
    });
  } finally {
    db.exec(`ALTER TABLE pending_state_off RENAME TO pending_state`);
  }
  assert.ok(getPending(N, "undo", 1, T0 + MIN), "a linha original continua la depois que o banco volta");
});
