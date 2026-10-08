import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../src/ai/interpret";
import { setLastShownExpenses, clearLastShownExpenses } from "../../src/expenses/listCache";
import { ensureUserSeeded, insertExpense, getOrCreateCategory } from "../../src/expenses/service";

const A = "551100140001";
const B = "551100140002";

// Achado real: "muda valor de 1 para 10,49" logo depois do bot mostrar a lista
// de gastos virou "nao entendido" -- a IA classifica cada mensagem sozinha e nao
// sabia que existia uma lista aberta. O prompt agora leva essa lista.
test("com lista de gastos aberta, o prompt da IA inclui a lista numerada e a regra do list_ref", () => {
  ensureUserSeeded(A);
  const cat = getOrCreateCategory(A, "Lazer");
  const e1 = insertExpense({ fromNumber: A, amount: 10.5, description: "chocolate acai", categoryId: cat.id, paymentMethodId: null, date: "2026-10-08" });
  const e2 = insertExpense({ fromNumber: A, amount: 7, description: "milho", categoryId: cat.id, paymentMethodId: null, date: "2026-10-08" });
  setLastShownExpenses(A, [e1.id, e2.id], "hoje");

  const prompt = buildSystemPrompt(A);
  assert.match(prompt, /CONTEXTO DA CONVERSA/);
  assert.match(prompt, /1\. R\$10\.50 — chocolate acai/);
  assert.match(prompt, /2\. R\$7\.00 — milho/);
  assert.match(prompt, /list_ref/);
  assert.match(prompt, /muda valor de 1 para 10,49/);
});

test("sem lista aberta (ou lista de outro numero, ou limpa), o prompt NAO inclui o contexto", () => {
  ensureUserSeeded(B);
  assert.doesNotMatch(buildSystemPrompt(B), /CONTEXTO DA CONVERSA/); // B nunca viu lista (isolamento entre numeros)

  clearLastShownExpenses(A);
  assert.doesNotMatch(buildSystemPrompt(A), /CONTEXTO DA CONVERSA/);
});
