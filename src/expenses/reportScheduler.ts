import { sendText } from "../whatsapp/client";
import { previousWeekRange, currentMonthRange, previousMonthRange, buildExpenseReportText } from "./reportText";
import { getReportSubscribers, getExpenseSummaryBetween } from "./service";
import { addDaysToDateString, effectiveDayOfMonth, spDateString, spTimeString } from "../timeSP";
import { DailyJob, registerDailyJob } from "../scheduler/dailyJobs";

export const WEEKLY_REPORT_JOB_NAME = "relatorio_semanal";
export const MONTHLY_REPORT_JOB_NAME = "relatorio_mensal";
// o relatorio do mes que acabou ainda e recuperado ate este dia do mes seguinte (Card 19, RN02)
export const MONTHLY_REPORT_RECOVERY_LAST_DAY = 2;

const dayOfMonth = (date: string) => Number(date.slice(8, 10));

// dia da semana (0 = domingo) de uma data-calendario pura
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isLastDayOfMonth(date: string): boolean {
  return dayOfMonth(date) === effectiveDayOfMonth(31, date.slice(0, 7));
}

// Relatorio semanal, todo dia a partir das 9h: manda so pra quem escolheu o dia da semana da execucao. Perdeu a hora? Recupera so no MESMO dia
// (ate 23:59); no dia seguinte um relatorio "da semana passada" so confunde, entao a execucao fica registrada como perdida.
export const weeklyReportJob: DailyJob = {
  name: WEEKLY_REPORT_JOB_NAME,
  time: "09:00",
  lookbackDays: 0,
  atMostOnce: true,
  recoverable: (runDate, today) => runDate === today,
  async run({ runDate }) {
    const range = previousWeekRange(runDate);
    const subscribers = getReportSubscribers().filter((s) => s.report_day_of_week === weekdayOf(runDate));
    let items = 0;
    let failures = 0;
    for (const s of subscribers) {
      try {
        // Pedido do usuario: sem NENHUM gasto registrado na semana, nao manda
        // nada (nem a mensagem de "nenhum gasto registrado") -- so fica em
        // silencio esse dia, em vez de incomodar com um relatorio vazio.
        const summary = getExpenseSummaryBetween(range.start, range.end, s.from_number);
        if (summary.count === 0) continue;
        await sendText(s.from_number, buildExpenseReportText(range, { compare: true, fromNumber: s.from_number }));
        items++;
      } catch (err) {
        console.error(`Erro ao enviar relatorio semanal pra ${s.from_number}:`, err);
        failures++;
      }
    }
    return { items, failures };
  },
};

// Relatorio mensal: no ultimo dia do mes, a partir das 18h, pra todo mundo que tem relatorio ativado. Perdeu a hora? Recupera ate o dia 2 do
// mes seguinte, com o resumo do mes que acabou identificado pelo nome do mes.
export const monthlyReportJob: DailyJob = {
  name: MONTHLY_REPORT_JOB_NAME,
  time: "18:00",
  lookbackDays: MONTHLY_REPORT_RECOVERY_LAST_DAY,
  atMostOnce: true,
  scheduledOn: isLastDayOfMonth,
  recoverable: (runDate, today) => today <= addDaysToDateString(runDate, MONTHLY_REPORT_RECOVERY_LAST_DAY),
  runDates(now) {
    const today = spDateString(now);
    const time = spTimeString(now);
    if (isLastDayOfMonth(today) && time >= "18:00") return [today];
    if (dayOfMonth(today) <= MONTHLY_REPORT_RECOVERY_LAST_DAY) return [addDaysToDateString(`${today.slice(0, 7)}-01`, -1)];
    return [];
  },
  async run({ runDate, today }) {
    // resumo do mes da execucao: o vigente (rodou no proprio dia) ou o que acabou (recuperado nos primeiros dias do mes seguinte)
    const range = runDate.slice(0, 7) === today.slice(0, 7) ? currentMonthRange(runDate) : previousMonthRange(today);
    let items = 0;
    let failures = 0;
    for (const s of getReportSubscribers()) {
      try {
        // mesma regra do semanal: sem nenhum gasto no mes, fica em silencio.
        const summary = getExpenseSummaryBetween(range.start, range.end, s.from_number);
        if (summary.count === 0) continue;
        await sendText(s.from_number, buildExpenseReportText(range, { compare: true, fromNumber: s.from_number }));
        items++;
      } catch (err) {
        console.error(`Erro ao enviar relatorio mensal pra ${s.from_number}:`, err);
        failures++;
      }
    }
    return { items, failures };
  },
};

export function startExpenseReportScheduler() {
  registerDailyJob(weeklyReportJob);
  registerDailyJob(monthlyReportJob);
}
