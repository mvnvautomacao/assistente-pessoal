// Lancamento de UM gasto fixo (Card 13): insere o gasto, marca o mes como lancado e monta o aviso de
// orcamento, o log e o texto. Compartilhado pelo cron das 7h (recurringScheduler.ts) e pelo cadastro
// quando o usuario pede pra lancar o mes corrente na hora -- um unico lugar pro comportamento.
import { insertExpense, getCategoryById, getPaymentMethodById } from "./service";
import { checkBudgetAlert } from "./budgets";
import { markRecurringExpenseRunForMonth, RecurringExpense } from "./recurring";
import { logActivity } from "../activity/service";
import { monthEndShiftFrom } from "../timeSP";

export interface LaunchedRecurringExpense {
  expenseId: number;
  text: string;
}

// "date" = YYYY-MM-DD do gasto lancado; o mes marcado como lancado e o dessa data
export function launchRecurringExpense(recurring: RecurringExpense, date: string, options: { announceMonthEnd?: boolean } = {}): LaunchedRecurringExpense {
  const category = recurring.category_id ? getCategoryById(recurring.from_number, recurring.category_id) : null;
  const paymentMethod = recurring.payment_method_id ? getPaymentMethodById(recurring.from_number, recurring.payment_method_id) : null;

  const expense = insertExpense({
    fromNumber: recurring.from_number,
    amount: recurring.amount,
    description: recurring.description,
    categoryId: recurring.category_id,
    paymentMethodId: recurring.payment_method_id,
    date,
    fixed: { source: "recurring", refId: recurring.id },
  });
  markRecurringExpenseRunForMonth(recurring.from_number, recurring.id, date.slice(0, 7));

  // Card 16 (RN17): disparo antecipado pro ultimo dia de um mes curto -- o texto diz isso (so no cron, que roda no proprio dia)
  const shiftedFrom = options.announceMonthEnd ? monthEndShiftFrom(recurring.day_of_month, date) : null;
  const monthEndNote = shiftedFrom ? ` (vence todo dia ${shiftedFrom}; hoje é o último dia do mês)` : "";
  const categorySuffix = category ? ` em ${category.name}` : "";
  const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
  const budgetAlert = category ? (checkBudgetAlert(recurring.from_number, category.id, category.name) ?? "") : "";
  logActivity(recurring.from_number, "recurring_expense", `R$${recurring.amount.toFixed(2)}${categorySuffix}${paymentSuffix} — ${recurring.description}`);
  return {
    expenseId: expense.id,
    text: `🔁 Gasto fixo lançado${monthEndNote}: R$${recurring.amount.toFixed(2)}${categorySuffix}${paymentSuffix} — ${recurring.description}${budgetAlert}`,
  };
}
