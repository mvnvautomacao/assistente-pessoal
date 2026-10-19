import { sendText } from "../whatsapp/client";
import { billLateFromDate, getDueBillAlerts, markBillAlertAsked, snoozeBillAlert } from "./service";
import { enqueueBillCheckin } from "./pendingCheckin";
import { buildBillAlertQuestion } from "./checkinReply";
import { logActivity } from "../activity/service";
import { addDaysToDateString, monthEndShiftFrom } from "../timeSP";
import { DailyJob, registerDailyJob } from "../scheduler/dailyJobs";

export const BILL_ALERT_JOB_NAME = "alertas_conta";

// Todo dia a partir das 8h (Card 19): pergunta "ja fez?" pros alertas cujo dia do mes bate com hoje, cujo intervalo ja venceu (ou cuja soneca
// de "lembra amanha" venceu) -- e recupera o ciclo que o servidor perdeu (vencimento que ja passou sem aviso), com "(atrasado: vencia dia ...)".
// A trava contra repeticao e o proprio alerta (last_asked_date, confirmed_month).
export const billAlertJob: DailyJob = {
  name: BILL_ALERT_JOB_NAME,
  time: "08:00",
  lookbackDays: 0, // o ciclo pendente (sem limite de dias dentro do ciclo): perder o mes seria pior que avisar atrasado
  atMostOnce: false,
  async run({ today }) {
    let items = 0;
    let failures = 0;
    for (const bill of getDueBillAlerts(today)) {
      try {
        // manda ANTES de marcar/armar a pendencia -- se o envio falhar (ex:
        // Evolution API fora do ar), nada fica registrado como "perguntado".
        // Na ordem antiga, uma falha aqui deixava o sistema achando que
        // perguntou (e esperando a resposta) sem o cliente nunca ter visto
        // a pergunta -- a proxima mensagem dele recebia "ja resolveu X?" do nada.
        const lateFromDate = billLateFromDate(bill, today);
        const monthEndFromDay = bill.recurrence_type === "day_of_month" && !lateFromDate ? monthEndShiftFrom(bill.day_of_month, today) : null;
        await sendText(bill.from_number, buildBillAlertQuestion({ name: bill.name, recurrenceType: bill.recurrence_type, monthEndFromDay, lateFromDate }));
        markBillAlertAsked(bill.from_number, bill.id, today);
        const position = enqueueBillCheckin(bill.from_number, {
          billAlertId: bill.id,
          name: bill.name,
          recurrenceType: bill.recurrence_type,
          intervalDays: bill.interval_days,
          monthEndFromDay,
          lateFromDate,
        });
        // varios avisos no mesmo dia: o que espera na fila volta a perguntar amanha se a fila se perder
        // (ex: o da vez vence esperando o valor)
        if (position === "queued") snoozeBillAlert(bill.from_number, bill.id, addDaysToDateString(today, 1));
        logActivity(bill.from_number, "bill_alert", `pergunta enviada: ${bill.name}${lateFromDate ? ` (atrasado: vencia ${lateFromDate})` : ""}`);
        items++;
      } catch (err) {
        console.error(`Erro ao avisar alerta de conta fixa ${bill.id}:`, err);
        failures++;
      }
    }
    return { items, failures };
  },
};

export function startBillAlertScheduler() {
  registerDailyJob(billAlertJob);
}
