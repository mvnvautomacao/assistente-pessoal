import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { insertExpense, getCategoryById, getPaymentMethodById } from "./service";
import { checkBudgetAlert } from "./budgets";
import { getDueRecurringExpenses, markRecurringExpenseRunForMonth } from "./recurring";
import { logActivity } from "../activity/service";
import { spDateString } from "../timeSP";

export function startRecurringExpenseScheduler() {
  // roda todo dia as 7h: lanca automaticamente os gastos fixos cujo dia bate com hoje
  cron.schedule(
    "0 7 * * *",
    async () => {
      const today = spDateString();
      const due = getDueRecurringExpenses(today);
      for (const recurring of due) {
        try {
          const category = recurring.category_id ? getCategoryById(recurring.from_number, recurring.category_id) : null;
          const paymentMethod = recurring.payment_method_id ? getPaymentMethodById(recurring.from_number, recurring.payment_method_id) : null;

          insertExpense({
            fromNumber: recurring.from_number,
            amount: recurring.amount,
            description: recurring.description,
            categoryId: recurring.category_id,
            paymentMethodId: recurring.payment_method_id,
            date: today,
          });
          markRecurringExpenseRunForMonth(recurring.id, today.slice(0, 7));

          const categorySuffix = category ? ` em ${category.name}` : "";
          const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
          const budgetAlert = category ? (checkBudgetAlert(recurring.from_number, category.id, category.name) ?? "") : "";
          logActivity(recurring.from_number, "recurring_expense", `R$${recurring.amount.toFixed(2)}${categorySuffix}${paymentSuffix} — ${recurring.description}`);
          await sendText(
            recurring.from_number,
            `🔁 Gasto fixo lançado: R$${recurring.amount.toFixed(2)}${categorySuffix}${paymentSuffix} — ${recurring.description}${budgetAlert}`
          );
        } catch (err) {
          console.error(`Erro ao lancar gasto fixo ${recurring.id}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
