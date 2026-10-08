import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAmount } from "../../src/validation";
import { parseExpenseDate, validateExpenseDate, invalidDateMessage } from "../../src/expenses/parseDate";
import { MAX_EDIT_CHANGES, isExpenseEditField, mergeRawChanges, normalizeExpenseChanges } from "../../src/expenses/editChanges";
import {
  correctionOptions,
  formatCorrectionPicker,
  formatExpenseEditPreview,
  formatExpenseEditSuccess,
  viewLine,
} from "../../src/confirmation/expensePreview";
import type { ExpenseChangeView, ExpenseEditItem } from "../../src/expenses/pendingEditExpense";

test("validateAmount: limites de valor", () => {
  assert.deepEqual(validateAmount(0.01), { ok: true });
  assert.deepEqual(validateAmount(1_000_000), { ok: true });
  for (const bad of [0, -1, Number.NaN]) {
    const r = validateAmount(bad);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "not_positive");
      assert.equal(r.message, "O valor precisa ser maior que R$ 0,00.");
    }
  }
  const high = validateAmount(1_000_000.01);
  assert.equal(high.ok, false);
  if (!high.ok) {
    assert.equal(high.reason, "too_high");
    assert.equal(high.message, "Esse valor é muito alto (limite R$ 1.000.000,00). Confere e me manda de novo?");
  }
});

const TODAY = "2026-10-08";

test("parseExpenseDate: hoje, ontem, anteontem", () => {
  assert.deepEqual(parseExpenseDate("hoje", TODAY), { ok: true, date: "2026-10-08" });
  assert.deepEqual(parseExpenseDate(" Ontem! ", TODAY), { ok: true, date: "2026-10-07" });
  assert.deepEqual(parseExpenseDate("anteontem", TODAY), { ok: true, date: "2026-10-06" });
});

test("parseExpenseDate: dd/mm, dd/mm/aa, dd/mm/aaaa e ISO", () => {
  assert.deepEqual(parseExpenseDate("15/10", TODAY), { ok: true, date: "2026-10-15" });
  assert.deepEqual(parseExpenseDate("5-3", TODAY), { ok: true, date: "2026-03-05" });
  assert.deepEqual(parseExpenseDate("15/10/25", TODAY), { ok: true, date: "2025-10-15" });
  assert.deepEqual(parseExpenseDate("15.10.2024", TODAY), { ok: true, date: "2024-10-15" });
  assert.deepEqual(parseExpenseDate("2026-09-30", TODAY), { ok: true, date: "2026-09-30" });
  assert.deepEqual(parseExpenseDate("2026-09-30T10:00:00-03:00", TODAY), { ok: true, date: "2026-09-30" });
});

test("parseExpenseDate: dia N usa o mes atual, ou o anterior se o dia ainda nao chegou", () => {
  assert.deepEqual(parseExpenseDate("dia 5", TODAY), { ok: true, date: "2026-10-05" });
  assert.deepEqual(parseExpenseDate("dia 8", TODAY), { ok: true, date: "2026-10-08" });
  assert.deepEqual(parseExpenseDate("dia 20", TODAY), { ok: true, date: "2026-09-20" });
  // virada de ano: em janeiro, "dia 20" e de dezembro do ano anterior
  assert.deepEqual(parseExpenseDate("dia 20", "2026-01-10"), { ok: true, date: "2025-12-20" });
  // dia 31 num mes anterior que nao tem 31
  assert.deepEqual(parseExpenseDate("dia 31", "2026-10-08"), { ok: false, reason: "invalid", shown: "31/09/2026" });
});

test("parseExpenseDate: datas impossiveis, fora da janela e texto nao reconhecido", () => {
  assert.deepEqual(parseExpenseDate("31/02", TODAY), { ok: false, reason: "invalid", shown: "31/02/2026" });
  assert.deepEqual(parseExpenseDate("00/10", TODAY), { ok: false, reason: "invalid", shown: "00/10/2026" });
  assert.deepEqual(parseExpenseDate("10/13", TODAY), { ok: false, reason: "invalid", shown: "10/13/2026" });
  assert.deepEqual(parseExpenseDate("29/02/2025", TODAY), { ok: false, reason: "invalid", shown: "29/02/2025" });
  assert.deepEqual(parseExpenseDate("29/02/2024", TODAY), { ok: true, date: "2024-02-29" });
  assert.deepEqual(parseExpenseDate("01/01/2010", TODAY), { ok: false, reason: "out_of_range", shown: "01/01/2010" });
  assert.deepEqual(parseExpenseDate("01/01/2028", TODAY), { ok: false, reason: "out_of_range", shown: "01/01/2028" });
  assert.deepEqual(parseExpenseDate("sexta que vem", TODAY), { ok: false, reason: "unrecognized" });
});

test("parseExpenseDate: bordas da janela (5 anos atras ate 1 ano a frente)", () => {
  assert.deepEqual(parseExpenseDate("08/10/2021", TODAY), { ok: true, date: "2021-10-08" });
  assert.equal(parseExpenseDate("07/10/2021", TODAY).ok, false);
  assert.deepEqual(parseExpenseDate("08/10/2027", TODAY), { ok: true, date: "2027-10-08" });
  assert.equal(parseExpenseDate("09/10/2027", TODAY).ok, false);
  // 29/02 de ano bissexto como "hoje": a janela nao quebra
  assert.deepEqual(parseExpenseDate("28/02/2023", "2028-02-29"), { ok: true, date: "2023-02-28" });
});

test("validateExpenseDate: confere ISO vindo da IA", () => {
  assert.deepEqual(validateExpenseDate("2026-10-15", TODAY), { ok: true, date: "2026-10-15" });
  assert.deepEqual(validateExpenseDate("2026-02-31", TODAY), { ok: false, reason: "invalid", shown: "31/02/2026" });
  assert.deepEqual(validateExpenseDate("amanha", TODAY), { ok: false, reason: "unrecognized" });
  assert.equal(invalidDateMessage("31/02/2026"), "Essa data não parece certa (31/02/2026). Me manda o dia de novo, ex: 15/10 ou ontem.");
});

test("normalizeExpenseChanges: changes tem prioridade; legado field/value vira lista; lixo e descartado", () => {
  assert.deepEqual(normalizeExpenseChanges({ field: "amount", value: "45" }), [{ field: "amount", value: "45" }]);
  assert.deepEqual(
    normalizeExpenseChanges({ changes: [{ field: "amount", value: " 45 " }, { field: "category", value: "Lazer" }], field: "date", value: "ontem" }),
    [
      { field: "amount", value: "45" },
      { field: "category", value: "Lazer" },
    ]
  );
  assert.deepEqual(normalizeExpenseChanges({ changes: [{ field: "banana", value: "x" }, { field: "amount", value: "" }, { field: "date" }] }), []);
  assert.deepEqual(normalizeExpenseChanges({ changes: [] , field: "description", value: "Feira" }), [{ field: "description", value: "Feira" }]);
  assert.deepEqual(normalizeExpenseChanges({}), []);
  assert.deepEqual(normalizeExpenseChanges({ field: "amount", value: 45 }), [{ field: "amount", value: "45" }]);
  assert.deepEqual(normalizeExpenseChanges({ field: "amount", value: null }), []);
});

test("mergeRawChanges: campo repetido vale o ultimo valor, na posicao da primeira aparicao; limite de mudancas", () => {
  assert.deepEqual(
    mergeRawChanges(
      [
        { field: "amount", value: "1" },
        { field: "date", value: "ontem" },
      ],
      [{ field: "amount", value: "2" }]
    ),
    [
      { field: "amount", value: "2" },
      { field: "date", value: "ontem" },
    ]
  );
  assert.equal(MAX_EDIT_CHANGES, 5);
  assert.equal(isExpenseEditField("category"), true);
  assert.equal(isExpenseEditField("banana"), false);
  assert.equal(isExpenseEditField(3), false);
});

function view(field: ExpenseChangeView["field"], label: string, from: string, to: string, isNew = false): ExpenseChangeView {
  return { field, label, from, to, isNew };
}

function item(description: string, views: ExpenseChangeView[], headerText = `${description} — R$ 38,00 · 07/10 · Pix`): ExpenseEditItem {
  const params = { amount: 38, description, date: "2026-10-07", categoryId: null, paymentMethodId: null };
  return { expenseId: 1, description, headerText, previous: params, proposed: params, rawChanges: [], newCategoryName: null, newPaymentMethodName: null, views };
}

test("formatExpenseEditPreview: um gasto com varias mudancas e '(nova)' na categoria nova", () => {
  const text = formatExpenseEditPreview([
    item("Mercado", [
      view("amount", "Valor", "R$ 38,00", "R$ 45,00"),
      view("category", "Categoria", "Alimentação", "Lazer", true),
      view("payment_method", "Pagamento", "Pix", "Crédito"),
    ]),
  ]);
  assert.equal(
    text,
    "✏️ Mercado — R$ 38,00 · 07/10 · Pix\nValor: R$ 38,00 → R$ 45,00\nCategoria: Alimentação → Lazer (nova)\nPagamento: Pix → Crédito\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );
  assert.equal(viewLine(view("amount", "Valor", "a", "b")), "Valor: a → b");
});

test("formatExpenseEditPreview: lote de gastos", () => {
  const text = formatExpenseEditPreview([
    item("Mercado", [view("payment_method", "Pagamento", "Crédito", "Pix")]),
    item("Uber", [view("payment_method", "Pagamento", "Pix", "Dinheiro"), view("amount", "Valor", "R$ 10,00", "R$ 12,00")]),
  ]);
  assert.equal(
    text,
    "✏️ Vou fazer 2 alterações:\n1. Mercado — Pagamento: Crédito → Pix\n2. Uber — Pagamento: Pix → Dinheiro; Valor: R$ 10,00 → R$ 12,00\n\n1 ✅ Confirmar tudo\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );
});

test("correctionOptions + formatCorrectionPicker: uma opcao por mudanca; rotulo inclui o gasto no lote", () => {
  const single = correctionOptions([item("Mercado", [view("amount", "Valor", "a", "b"), view("payment_method", "Pagamento", "c", "d")])]);
  assert.deepEqual(
    single.map((o) => [o.itemIndex, o.field, o.label]),
    [
      [0, "amount", "Valor"],
      [0, "payment_method", "Pagamento"],
    ]
  );
  assert.equal(formatCorrectionPicker(single), "Qual você quer corrigir?\n1 Valor\n2 Pagamento\n\nOu responde *cancelar*.");

  const batch = correctionOptions([item("Mercado", [view("amount", "Valor", "a", "b")]), item("Uber", [view("date", "Data", "c", "d")])]);
  assert.deepEqual(
    batch.map((o) => [o.itemIndex, o.field, o.label]),
    [
      [0, "amount", "Mercado — Valor"],
      [1, "date", "Uber — Data"],
    ]
  );
});

test("formatExpenseEditSuccess: um gasto lista cada campo; lote so conta", () => {
  const one = formatExpenseEditSuccess([
    item("Mercado", [
      view("amount", "Valor", "a", "R$ 45,00"),
      view("date", "Data", "a", "05/10"),
      view("description", "Nome", "a", "Feira"),
      view("category", "Categoria", "a", "Lazer"),
      view("payment_method", "Pagamento", "a", "Crédito"),
    ]),
  ]);
  assert.equal(one, '✏️ "Mercado" atualizado: valor R$ 45,00; data 05/10; nome Feira; categoria Lazer; pagamento Crédito.');
  assert.equal(formatExpenseEditSuccess([item("A", []), item("B", [])]), "✏️ 2 gastos atualizados.");
});
