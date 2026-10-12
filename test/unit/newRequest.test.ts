import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_WORDS_FOR_NEW_REQUEST,
  PENDING_EXIT_HINT,
  SAFE_NEW_REQUEST_TYPES,
  countWords,
  isSafeNewRequest,
  replacedPendingText,
  undoWithPendingText,
  withExitHint,
} from "../../src/pending/newRequest";
import type { Interpretation } from "../../src/ai/interpret";
import { NOT_UNDERSTOOD_TEXT } from "../../src/confirmation/preview";
import { DeleteFlow, deleteNotUnderstood } from "../../src/confirmation/deletePreview";
import { INCOME_DELETE_NOT_UNDERSTOOD } from "../../src/confirmation/incomePreview";
import { FIELD_SELECTION_RETRY } from "../../src/fieldMenu/format";
import { isUndoText, UNDO_WORDS } from "../../src/pending/expiredNotice";

const TEXT = "gastei 30 no uber"; // 4 palavras

test("PENDING_EXIT_HINT e withExitHint: dica numa segunda linha", () => {
  assert.equal(PENDING_EXIT_HINT, "Se quer fazer outra coisa, responde *3* e me manda o pedido de novo.");
  assert.equal(withExitHint("Não entendi 🤔"), `Não entendi 🤔\n${PENDING_EXIT_HINT}`);
});

test("isSafeNewRequest: cada tipo da lista segura (completo) vale", () => {
  const safe: Interpretation[] = [
    { type: "expense", amount: 30, description: "uber" },
    { type: "installment_expense", description: "geladeira", installments: 10, installment_amount: 100 },
    { type: "income", amount: 3000, description: "salario", date: "2026-10-12" },
    { type: "event", title: "Dentista", start: "2026-10-15T15:00:00-03:00" },
    { type: "reminder", message: "tomar remedio", due_at: "2026-10-12T20:00:00-03:00" },
    { type: "list_expenses", days: 1 },
    { type: "expense_report", period: "month" },
    { type: "income_report", period: "month" },
    { type: "list_incomes", period: "month" },
    { type: "balance", period: "month" },
    { type: "report", days: 1 },
    { type: "total_last_list" },
    { type: "list_budgets" },
    { type: "list_categories" },
    { type: "list_recurring_expenses" },
    { type: "list_bill_alerts" },
    { type: "help" },
  ];
  for (const interpretation of safe) assert.equal(isSafeNewRequest([interpretation], TEXT), true, interpretation.type);
  // a lista segura e exatamente essa (mais list_reminders, que a IA ainda nao devolve)
  assert.deepEqual([...SAFE_NEW_REQUEST_TYPES].sort(), [...new Set([...safe.map((i) => i.type), "list_reminders"])].sort());
});

test("isSafeNewRequest: tipos fora da lista nunca trocam a confirmacao", () => {
  const unsafe: Interpretation[] = [
    { type: "edit_expense", query: "x" },
    { type: "edit_event", query: "x" },
    { type: "edit_reminder", query: "x" },
    { type: "edit_income" },
    { type: "edit_recurring_expense", query: "x" },
    { type: "edit_bill_alert", query: "x" },
    { type: "delete_event", query: "x" },
    { type: "delete_reminder", query: "x" },
    { type: "delete_expense", query: "x" },
    { type: "delete_income" },
    { type: "delete_category", category: "x" },
    { type: "remove_budget", category: "x" },
    { type: "remove_recurring_expense", query: "x" },
    { type: "remove_bill_alert", query: "x" },
    { type: "snooze_reminder" },
    { type: "add_event_reminder", query: "x", minutes_before: 10 },
    { type: "remove_event_reminder", query: "x", minutes_before: 10 },
    { type: "set_budget", category: "x", amount: 1 },
    { type: "set_default_payment", payment_method: "pix" },
    { type: "set_report_day" },
    { type: "set_no_expense_reminder" },
    { type: "set_recurring_expense", description: "x", amount: 1, category: "x", day_of_month: 5 },
    { type: "set_bill_alert", description: "x" },
    { type: "undo" },
    { type: "merge_categories", category: "a", to_category: "b" },
    { type: "bulk_recategorize", to_category: "a", scope: "today" },
    { type: "rename_category", category: "a", new_name: "b" },
    { type: "rename_payment_method", payment_method: "a", new_name: "b" },
    { type: "create_category", category: "x" },
    { type: "correct_category", category: "x" },
    { type: "unknown", description: "x" },
  ];
  for (const interpretation of unsafe) assert.equal(isSafeNewRequest([interpretation], TEXT), false, interpretation.type);
});

test("isSafeNewRequest: mistura (um seguro e um nao) nao e atendida; vazio ou nulo tambem nao", () => {
  const expense: Interpretation = { type: "expense", amount: 30, description: "uber" };
  assert.equal(isSafeNewRequest([expense, { type: "income", amount: 10, description: "x", date: "2026-10-12" }], TEXT), true);
  assert.equal(isSafeNewRequest([expense, { type: "delete_expense", query: "x" }], TEXT), false);
  assert.equal(isSafeNewRequest([{ type: "delete_expense", query: "x" }, expense], TEXT), false);
  assert.equal(isSafeNewRequest([], TEXT), false);
  assert.equal(isSafeNewRequest(null, TEXT), false);
  assert.equal(isSafeNewRequest(undefined, TEXT), false);
});

test("isSafeNewRequest: pedido incompleto (valor, descricao, titulo, inicio, texto ou horario ausentes) nao vale", () => {
  const incomplete: Interpretation[] = [
    { type: "expense", amount: 0, description: "uber" },
    { type: "expense", amount: -5, description: "uber" },
    { type: "expense", amount: Number.NaN, description: "uber" },
    { type: "expense", amount: 30, description: "  " },
    { type: "event", title: "", start: "2026-10-15T15:00:00-03:00" },
    { type: "event", title: "Dentista", start: "" },
    { type: "reminder", message: "", due_at: "2026-10-12T20:00:00-03:00" },
    { type: "reminder", message: "remedio", due_at: " " },
  ];
  for (const interpretation of incomplete) assert.equal(isSafeNewRequest([interpretation], TEXT), false, JSON.stringify(interpretation));
});

test("isSafeNewRequest: minimo de 2 palavras (palavra solta nunca troca)", () => {
  const expense: Interpretation = { type: "expense", amount: 30, description: "uber" };
  assert.equal(MIN_WORDS_FOR_NEW_REQUEST, 2);
  for (const text of ["pix", "hoje", "", "   ", "\n"]) assert.equal(isSafeNewRequest([expense], text), false, JSON.stringify(text));
  for (const text of ["uber 30", "gastei  30", "  gastei 30 no uber  "]) assert.equal(isSafeNewRequest([expense], text), true, JSON.stringify(text));
  assert.equal(countWords(" a  b\tc\nd "), 4);
  assert.equal(countWords(""), 0);
});

test("textos da troca (RN05) e do desfazer com confirmacao aberta (RN07), com e sem rotulo", () => {
  assert.equal(replacedPendingText("Mercado"), 'Deixei a alteração de "Mercado" de lado e entendi seu novo pedido.');
  assert.equal(replacedPendingText(null), "Deixei a pergunta anterior de lado e entendi seu novo pedido.");
  assert.equal(replacedPendingText(""), "Deixei a pergunta anterior de lado e entendi seu novo pedido.");
  assert.equal(
    undoWithPendingText("Mercado"),
    'Cancelei a alteração de "Mercado" — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.'
  );
  assert.equal(undoWithPendingText(undefined), 'Cancelei a pergunta anterior — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.');
});

test("a dica de saida esta em todos os 'nao entendi' das confirmacoes (RN06)", () => {
  assert.ok(NOT_UNDERSTOOD_TEXT.endsWith(`\n${PENDING_EXIT_HINT}`));
  assert.ok(INCOME_DELETE_NOT_UNDERSTOOD.endsWith(`\n${PENDING_EXIT_HINT}`));
  assert.ok(FIELD_SELECTION_RETRY.endsWith(`\n${PENDING_EXIT_HINT}`));
  const flows: DeleteFlow[] = ["event", "reminder", "expense", "installment", "category", "budget", "recurring", "bill_alert", "merge", "bulk"];
  for (const flow of flows) {
    assert.ok(deleteNotUnderstood({ flow }).endsWith(`\n${PENDING_EXIT_HINT}`), flow);
    assert.ok(deleteNotUnderstood({ flow, offerOther: true }).endsWith(`\n${PENDING_EXIT_HINT}`), `${flow} + opcao 2`);
  }
});

test("isUndoText: so a mensagem inteira de desfazer (mesma lista do aviso de expiracao)", () => {
  for (const text of ["desfaz isso", "Desfazer", "desfaz", "desfazer isso", "Desfaz a última", "  DESFAZ ISSO!  "]) assert.equal(isUndoText(text), true, text);
  for (const text of ["desfaz isso e apaga o gasto", "quero desfazer", "refazer", "", "isso"]) assert.equal(isUndoText(text), false, text);
  assert.ok(UNDO_WORDS.has("desfaz isso"));
});
