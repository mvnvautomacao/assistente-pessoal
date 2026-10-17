import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueRecurringExpenses } from "./recurring";
import { launchRecurringExpense } from "./recurringLaunch";
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
          const launched = launchRecurringExpense(recurring, today, { announceMonthEnd: true });
          await sendText(recurring.from_number, launched.text);
        } catch (err) {
          console.error(`Erro ao lancar gasto fixo ${recurring.id}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
