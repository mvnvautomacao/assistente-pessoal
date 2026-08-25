import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { previousWeekRange, currentMonthRange, buildExpenseReportText } from "./reportText";
import { getReportSubscribers } from "./service";
import { spDayOfWeek, isLastDayOfMonthSP } from "../timeSP";

export function startExpenseReportScheduler() {
  // roda todo dia as 8h: manda o relatorio semanal so pra quem escolheu hoje como o dia dele
  cron.schedule(
    "0 8 * * *",
    async () => {
      const today = spDayOfWeek();
      const subscribers = getReportSubscribers().filter((s) => s.report_day_of_week === today);
      for (const s of subscribers) {
        const text = buildExpenseReportText(previousWeekRange(), { compare: true, fromNumber: s.from_number });
        await sendText(s.from_number, text).catch((err) => console.error(`Erro ao enviar relatorio semanal pra ${s.from_number}:`, err));
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  // roda todo dia as 18h, mas so faz algo no ultimo dia do mes: manda o resumo do mes
  // vigente (que esta terminando hoje) pra todo mundo que tem relatorio ativado
  cron.schedule(
    "0 18 * * *",
    async () => {
      if (!isLastDayOfMonthSP()) return;
      const subscribers = getReportSubscribers();
      for (const s of subscribers) {
        const text = buildExpenseReportText(currentMonthRange(), { compare: true, fromNumber: s.from_number });
        await sendText(s.from_number, text).catch((err) => console.error(`Erro ao enviar relatorio mensal pra ${s.from_number}:`, err));
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
