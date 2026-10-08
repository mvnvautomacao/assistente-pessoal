import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretTargetReply, looksLikeMultipleNumbers, parseChoiceNumber, stripLeadingArticles } from "../../src/targetChoice/reply";
import {
  MAX_TARGET_CANDIDATES,
  TARGET_GONE_TEXT,
  eventLine,
  reminderLine,
  expenseLine,
  formatTargetList,
  targetNotUnderstoodText,
} from "../../src/targetChoice/format";
import { setPendingTargetChoice, getPendingTargetChoice, clearPendingTargetChoice } from "../../src/targetChoice/pending";
import { ensureUserSeeded, insertExpense, findExpenseCandidates, findRecentExpense, getOrCreateCategory } from "../../src/expenses/service";

test("interpretTargetReply: numero escolhe (variacoes de escrita, por extenso e emoji)", () => {
  for (const text of ["2", "2.", "2️⃣", "o 2", "O 2!", "opção 2", "opcao 2", "numero 2", "02", "dois", "Dois.", "duas"]) {
    assert.deepEqual(interpretTargetReply(text, 3), { type: "pick", index: 1 }, `"${text}"`);
  }
  assert.deepEqual(interpretTargetReply("1", 3), { type: "pick", index: 0 });
  assert.deepEqual(interpretTargetReply("3", 3), { type: "pick", index: 2 }); // 3 e opcao quando existe
  assert.deepEqual(interpretTargetReply("oito", 8), { type: "pick", index: 7 });
});

test("interpretTargetReply: numero fora da lista e invalido, exceto '3' sem 3 opcoes que cancela", () => {
  assert.deepEqual(interpretTargetReply("5", 3), { type: "invalid" });
  assert.deepEqual(interpretTargetReply("0", 3), { type: "invalid" });
  assert.deepEqual(interpretTargetReply("9", 2), { type: "invalid" });
  assert.deepEqual(interpretTargetReply("3", 2), { type: "cancel" });
  assert.deepEqual(interpretTargetReply("tres", 2), { type: "cancel" });
});

test("interpretTargetReply: cancelamento", () => {
  for (const text of ["cancelar", "Cancela", "não", "nao", "n", "deixa", "deixa pra lá", "esquece", "❌", "negativo"]) {
    assert.deepEqual(interpretTargetReply(text, 3), { type: "cancel" }, `"${text}"`);
  }
});

test("interpretTargetReply: texto livre vira refino, sem artigos/preposicoes no inicio e com acento preservado", () => {
  assert.deepEqual(interpretTargetReply("pressão", 3), { type: "refine", query: "pressão" });
  assert.deepEqual(interpretTargetReply("do remédio", 3), { type: "refine", query: "remédio" });
  assert.deepEqual(interpretTargetReply("a Maria da padaria.", 3), { type: "refine", query: "Maria da padaria" });
  assert.deepEqual(interpretTargetReply("das compras do mês", 3), { type: "refine", query: "compras do mês" });
  assert.deepEqual(interpretTargetReply("o", 3), { type: "invalid" }); // so artigo
  assert.deepEqual(interpretTargetReply("", 3), { type: "invalid" });
  assert.deepEqual(interpretTargetReply("   ", 3), { type: "invalid" });
});

test("parseChoiceNumber e stripLeadingArticles", () => {
  assert.equal(parseChoiceNumber("opção 4"), 4);
  assert.equal(parseChoiceNumber("quatro"), 4);
  assert.equal(parseChoiceNumber("a casa"), null);
  assert.equal(parseChoiceNumber("2 3"), null);
  assert.equal(stripLeadingArticles("  os   gastos  de hoje "), "gastos de hoje");
  assert.equal(stripLeadingArticles("de"), "");
});

test("lista numerada: texto exato do contrato (lembretes), singular de verbo por acao e 'Tem mais opcoes'", () => {
  const lines = [
    reminderLine({ message: "Remédio pressão", due_at: "2026-10-09T08:00:00-03:00" }),
    reminderLine({ message: "Remédio vitamina", due_at: "2026-10-09T09:00:00-03:00" }),
    reminderLine({ message: "Remédio gato", due_at: "2026-10-11T10:00:00-03:00" }),
  ];
  assert.equal(
    formatTargetList({ kind: "reminder", header: { type: "found", query: "remédio" }, verb: "remarcar", lines, total: 3 }),
    'Achei 3 lembretes com "remédio":\n1. Remédio pressão — sex 09/10 às 08:00\n2. Remédio vitamina — sex 09/10 às 09:00\n3. Remédio gato — dom 11/10 às 10:00\n\nQual deles você quer remarcar? Responde com o número ou *cancelar*.'
  );

  const more = formatTargetList({ kind: "event", header: { type: "found", query: "consulta" }, verb: "cancelar", lines: lines.slice(0, 2), total: 11 });
  assert.match(more, /Achei 11 eventos com "consulta":/);
  assert.match(more, /Tem mais opções\. Diga o nome mais específico ou \*cancelar\*\./);

  assert.match(
    formatTargetList({ kind: "reminder", header: { type: "refined", query: "pressão" }, verb: "apagar", lines: lines.slice(0, 2), total: 2 }),
    /^Ainda tenho 2 opções com "pressão":\n1\. /
  );
  assert.match(
    formatTargetList({ kind: "expense", header: { type: "expired" }, verb: "editar", lines: ["a — R$ 1,00 · 01/10"], total: 1 }),
    /^Essa lista já expirou, então não vou adivinhar pelo número\. Seus últimos gastos:\n1\. a/
  );
});

test("linhas de item e mensagens de erro", () => {
  assert.equal(eventLine({ title: "Consulta dentista", start: "2026-10-09T14:00:00-03:00" }), "Consulta dentista — sex 09/10 às 14:00");
  assert.equal(expenseLine({ description: "Mercado", amount: 38, date: "2026-10-07" }, "Pix"), "Mercado — R$ 38,00 · 07/10 · Pix");
  assert.equal(expenseLine({ description: "Mercado", amount: 112.4, date: "2026-10-05" }, null), "Mercado — R$ 112,40 · 05/10");
  assert.equal(targetNotUnderstoodText(3), "Não entendi 🤔 Responde com um número de 1 a 3, ou *cancelar*.");
  assert.equal(TARGET_GONE_TEXT, "Esse item não existe mais.");
  assert.equal(MAX_TARGET_CANDIDATES, 8);
});

test("findExpenseCandidates: 0, 1 e varios candidatos, mais recente primeiro, so desse numero", () => {
  const A = "551100160001";
  const B = "551100160002";
  ensureUserSeeded(A);
  ensureUserSeeded(B);
  const cat = getOrCreateCategory(A, "Mercado");
  const base = { categoryId: cat.id, paymentMethodId: null, date: "2026-10-07" };
  insertExpense({ fromNumber: A, amount: 10, description: "Mercado centro", ...base });
  insertExpense({ fromNumber: A, amount: 20, description: "Padaria", ...base });
  insertExpense({ fromNumber: A, amount: 30, description: "mercado bairro", ...base });
  insertExpense({ fromNumber: B, amount: 99, description: "Mercado do B", ...base });

  assert.deepEqual(findExpenseCandidates(A, "mercado").map((e) => e.description), ["mercado bairro", "Mercado centro"]); // recente primeiro, sem acento/caixa
  assert.deepEqual(findExpenseCandidates(A, "padaria").map((e) => e.amount), [20]);
  assert.deepEqual(findExpenseCandidates(A, "farmacia"), []);
  assert.deepEqual(findExpenseCandidates(A, "   "), []);
  assert.equal(findExpenseCandidates(A, "mercado", 1).length, 1); // limit corta
  assert.ok(!findExpenseCandidates(A, "mercado").some((e) => e.from_number !== A)); // isolamento
  assert.equal(findRecentExpense(A, "mercado")?.description, "mercado bairro"); // findRecentExpense = o primeiro dos candidatos
});

test("findExpenseCandidates: janela de busca = 20 gastos mais recentes", () => {
  const C = "551100160003";
  ensureUserSeeded(C);
  const base = { categoryId: null, paymentMethodId: null, date: "2026-10-07" };
  insertExpense({ fromNumber: C, amount: 1, description: "gasto antigo fora da janela", ...base });
  for (let i = 0; i < 20; i++) insertExpense({ fromNumber: C, amount: 2, description: `filler ${i}`, ...base });
  assert.deepEqual(findExpenseCandidates(C, "antigo"), []); // 21o mais recente: fora
  assert.equal(findExpenseCandidates(C, "filler").length, 20);
});

test("pendencia de escolha de alvo: uma por numero (a nova substitui), isolada e com TTL de 10 min", () => {
  const N = "551100160004";
  const M = "551100160005";
  const action = { type: "delete_event" as const, query: "x" };
  setPendingTargetChoice(N, { kind: "event", action, candidateIds: [1, 2] });
  setPendingTargetChoice(N, { kind: "reminder", action: { type: "delete_reminder", query: "y" }, candidateIds: [7] });
  assert.equal(getPendingTargetChoice(N)?.kind, "reminder");
  assert.deepEqual(getPendingTargetChoice(N)?.candidateIds, [7]);
  assert.equal(getPendingTargetChoice(M), null);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 9 * 60 * 1000;
    assert.ok(getPendingTargetChoice(N));
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(getPendingTargetChoice(N), null);
  } finally {
    Date.now = realNow;
  }
  clearPendingTargetChoice(N);
  assert.equal(getPendingTargetChoice(N), null);
});

test("interpretTargetReply: varios numeros ('1 e 5') pedem um item por vez, sem virar refino", () => {
  for (const text of ["1 e 5", "1,5", "1 5", "um e dois", "2 e 3 e 4"]) {
    assert.deepEqual(interpretTargetReply(text, 8), { type: "multiple" }, `"${text}"`);
    assert.equal(looksLikeMultipleNumbers(text), true);
  }
  // uma palavra no meio ja e busca por texto; numero unico continua escolhendo
  assert.deepEqual(interpretTargetReply("1 mercado", 8), { type: "refine", query: "1 mercado" });
  assert.deepEqual(interpretTargetReply("2", 8), { type: "pick", index: 1 });
  assert.equal(looksLikeMultipleNumbers("e"), false);
});
