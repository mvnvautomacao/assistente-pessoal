import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_WORDS_FOR_NEW_REQUEST,
  MENU_EXIT_HINT,
  MIN_WORDS_FOR_CREATION,
  PENDING_EXIT_HINT,
  SECOND_CHANCE_MAX_CALLS,
  SECOND_CHANCE_WINDOW_MS,
  SAFE_NEW_REQUEST_TYPES,
  countWords,
  isSafeNewRequest,
  replacedPendingText,
  takeSecondChance,
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
  // no menu de campos o "3" e um campo, entao a saida e "cancelar"
  assert.equal(MENU_EXIT_HINT, "Se quer fazer outra coisa, responde *cancelar* e me manda o pedido de novo.");
  assert.equal(withExitHint("Não entendi 🤔", MENU_EXIT_HINT), `Não entendi 🤔\n${MENU_EXIT_HINT}`);
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
  // a lista segura e exatamente essa (so tipos que existem em Interpretation)
  assert.deepEqual([...SAFE_NEW_REQUEST_TYPES].sort(), safe.map((i) => i.type).sort());
  assert.ok(!SAFE_NEW_REQUEST_TYPES.has("list_reminders"));
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

test("isSafeNewRequest: minimo de palavras -- 2 pra consultar, 3 pra registrar/criar (palavra solta nunca troca)", () => {
  const expense: Interpretation = { type: "expense", amount: 30, description: "uber" };
  const income: Interpretation = { type: "income", amount: 3000, description: "salario", date: "2026-10-12" };
  const event: Interpretation = { type: "event", title: "Dentista", start: "2026-10-15T15:00:00-03:00" };
  const reminder: Interpretation = { type: "reminder", message: "remedio", due_at: "2026-10-12T20:00:00-03:00" };
  const query: Interpretation = { type: "expense_report", period: "month" };
  assert.equal(MIN_WORDS_FOR_NEW_REQUEST, 2);
  assert.equal(MIN_WORDS_FOR_CREATION, 3);
  for (const text of ["pix", "hoje", "", "   ", "\n"]) {
    assert.equal(isSafeNewRequest([expense], text), false, JSON.stringify(text));
    assert.equal(isSafeNewRequest([query], text), false, JSON.stringify(text));
  }
  // resposta curta e ambigua ("mercado 40") nao registra nada sozinha
  for (const created of [expense, income, event, reminder]) {
    for (const text of ["mercado 40", "uber 30", "  gastei  30  "]) assert.equal(isSafeNewRequest([created], text), false, `${created.type}: ${text}`);
    for (const text of ["gastei 30 uber", "  gastei 30 no uber  ", "recebi 3000 de salario"]) assert.equal(isSafeNewRequest([created], text), true, `${created.type}: ${text}`);
  }
  // consultas bastam com 2 palavras
  for (const text of ["gastos hoje", "quanto gastei", "  o que tenho amanha  "]) assert.equal(isSafeNewRequest([query], text), true, JSON.stringify(text));
  // numa mistura vale o minimo mais exigente
  assert.equal(isSafeNewRequest([query, expense], "gastos hoje"), false);
  assert.equal(isSafeNewRequest([query, expense], "gastei 30 no uber"), true);
  assert.equal(countWords(" a  b\tc\nd "), 4);
  assert.equal(countWords(""), 0);
});

test("textos da troca (RN05) e do desfazer com confirmacao aberta (RN07): edicao, pergunta e sem rotulo", () => {
  assert.equal(replacedPendingText("Mercado"), 'Deixei a alteração de "Mercado" de lado e entendi seu novo pedido.');
  assert.equal(replacedPendingText("Mercado", "edit"), 'Deixei a alteração de "Mercado" de lado e entendi seu novo pedido.');
  assert.equal(replacedPendingText("Salário", "question"), 'Deixei a pergunta sobre "Salário" de lado e entendi seu novo pedido.');
  assert.equal(replacedPendingText(null), "Deixei a pergunta anterior de lado e entendi seu novo pedido.");
  assert.equal(replacedPendingText(""), "Deixei a pergunta anterior de lado e entendi seu novo pedido.");
  assert.equal(replacedPendingText("Mercado", "question").includes("alteração"), false, "apagar nao e 'alteração'");
  assert.equal(
    undoWithPendingText("Mercado"),
    'Cancelei a alteração de "Mercado" — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.'
  );
  assert.equal(
    undoWithPendingText("Salário", "question"),
    'Cancelei a pergunta sobre "Salário" — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.'
  );
  assert.equal(undoWithPendingText(undefined), 'Cancelei a pergunta anterior — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.');
});

test("takeSecondChance: no maximo 3 chamadas da IA por numero em 10 minutos; a janela desliza", () => {
  assert.equal(SECOND_CHANCE_MAX_CALLS, 3);
  const T = 1_000_000;
  let history: number[] = [];
  for (let i = 0; i < SECOND_CHANCE_MAX_CALLS; i++) {
    const r = takeSecondChance(history, T + i * 1000);
    assert.equal(r.allowed, true, `chamada ${i + 1}`);
    history = r.history;
  }
  const blocked = takeSecondChance(history, T + 5000);
  assert.equal(blocked.allowed, false, "a 4a dentro da janela nao passa");
  assert.deepEqual(blocked.history, history, "bloqueada nao consome");
  // 10 min depois da primeira, uma vaga reabre
  const reopened = takeSecondChance(history, T + SECOND_CHANCE_WINDOW_MS);
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.history.length, 3);
  // historico vazio sempre libera
  assert.deepEqual(takeSecondChance([], T), { allowed: true, history: [T] });
});

test("a dica de saida esta em todos os 'nao entendi' das confirmacoes (RN06)", () => {
  assert.ok(NOT_UNDERSTOOD_TEXT.endsWith(`\n${PENDING_EXIT_HINT}`));
  assert.ok(INCOME_DELETE_NOT_UNDERSTOOD.endsWith(`\n${PENDING_EXIT_HINT}`));
  assert.ok(FIELD_SELECTION_RETRY.endsWith(`\n${MENU_EXIT_HINT}`), "no menu o '3' e um campo: a saida e 'cancelar'");
  assert.ok(!FIELD_SELECTION_RETRY.includes(PENDING_EXIT_HINT));
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
