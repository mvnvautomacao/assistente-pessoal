import { sendText } from "../whatsapp/client";
import { deleteExpense } from "./service";
import { getMissedRecurringExpenses, RECURRING_LOOKBACK_DAYS, resetRecurringExpenseRunMonth } from "./recurring";
import { launchRecurringExpense } from "./recurringLaunch";
import { DailyJob, registerDailyJob } from "../scheduler/dailyJobs";

export const RECURRING_JOB_NAME = "gastos_fixos";

// Todo dia a partir das 7h (Card 19): lanca os gastos fixos que vencem hoje e recupera os dos ultimos 7 dias que o servidor
// perdeu (deploy, queda). O gasto atrasado entra com a data do VENCIMENTO, e a trava contra repeticao e o last_run_month.
export const recurringExpenseJob: DailyJob = {
  name: RECURRING_JOB_NAME,
  time: "07:00",
  lookbackDays: RECURRING_LOOKBACK_DAYS,
  atMostOnce: false,
  async run({ today }) {
    let items = 0;
    let failures = 0;
    for (const { recurring, dueDate } of getMissedRecurringExpenses(today, RECURRING_LOOKBACK_DAYS)) {
      const previousMonth = recurring.last_run_month;
      let expenseId: number | null = null;
      try {
        const launched = launchRecurringExpense(recurring, dueDate, {
          announceMonthEnd: dueDate === today,
          lateFromDate: dueDate < today ? dueDate : undefined,
        });
        expenseId = launched.expenseId;
        await sendText(recurring.from_number, launched.text);
        items++;
      } catch (err) {
        console.error(`Erro ao lancar gasto fixo ${recurring.id}:`, err);
        // o aviso nao saiu: desfaz o lancamento pra a proxima tentativa refazer tudo sem duplicar
        if (expenseId !== null) {
          deleteExpense(recurring.from_number, expenseId);
          resetRecurringExpenseRunMonth(recurring.from_number, recurring.id, previousMonth);
        }
        failures++;
      }
    }
    return { items, failures };
  },
};

export function startRecurringExpenseScheduler() {
  registerDailyJob(recurringExpenseJob);
}
