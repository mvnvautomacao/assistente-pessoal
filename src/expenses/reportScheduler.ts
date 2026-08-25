import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { config } from "../config";
import { previousWeekRange, previousMonthRange, buildExpenseReportText } from "./reportText";

export function startExpenseReportScheduler() {
  // toda segunda as 8h: resumo da semana que passou
  cron.schedule(
    "0 8 * * 1",
    async () => {
      const text = buildExpenseReportText(previousWeekRange(), { compare: true });
      await sendText(config.myWhatsappNumber, text).catch((err) => console.error("Erro ao enviar relatorio semanal:", err));
    },
    { timezone: "America/Sao_Paulo" }
  );

  // todo dia 1 as 8h: resumo do mes que passou
  cron.schedule(
    "0 8 1 * *",
    async () => {
      const text = buildExpenseReportText(previousMonthRange(), { compare: true });
      await sendText(config.myWhatsappNumber, text).catch((err) => console.error("Erro ao enviar relatorio mensal:", err));
    },
    { timezone: "America/Sao_Paulo" }
  );
}
