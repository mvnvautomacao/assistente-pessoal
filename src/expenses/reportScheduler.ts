import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { previousWeekRange, currentMonthRange, buildExpenseReportText } from "./reportText";
import { getReportSubscribers, getExpenseSummaryBetween } from "./service";
import { spDayOfWeek, isLastDayOfMonthSP } from "../timeSP";

export function startExpenseReportScheduler() {
  // roda todo dia as 8h: manda o relatorio semanal so pra quem escolheu hoje como o dia dele
  cron.schedule(
    "0 9 * * *",
    async () => {
      const today = spDayOfWeek();
      const range = previousWeekRange();
      const subscribers = getReportSubscribers().filter((s) => s.report_day_of_week === today);
      for (const s of subscribers) {
        try {
          // Pedido do usuario: sem NENHUM gasto registrado na semana, nao manda
          // nada (nem a mensagem de "nenhum gasto registrado") -- so fica em
          // silencio esse dia, em vez de incomodar com um relatorio vazio.
          const summary = getExpenseSummaryBetween(range.start, range.end, s.from_number);
          if (summary.count === 0) continue;
          const text = buildExpenseReportText(range, { compare: true, fromNumber: s.from_number });
          await sendText(s.from_number, text);
        } catch (err) {
          console.error(`Erro ao enviar relatorio semanal pra ${s.from_number}:`, err);
        }
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
      const range = currentMonthRange();
      const subscribers = getReportSubscribers();
      for (const s of subscribers) {
        try {
          // mesma regra do semanal: sem nenhum gasto no mes, fica em silencio.
          const summary = getExpenseSummaryBetween(range.start, range.end, s.from_number);
          if (summary.count === 0) continue;
          const text = buildExpenseReportText(range, { compare: true, fromNumber: s.from_number });
          await sendText(s.from_number, text);
        } catch (err) {
          console.error(`Erro ao enviar relatorio mensal pra ${s.from_number}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
