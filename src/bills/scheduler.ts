import { sendText } from "../whatsapp/client";
import { BILL_MAX_UNANSWERED_ASKS, billLateFromDate, closeBillAlertUnanswered, getDueBillAlerts, markBillAlertAsked, snoozeBillAlert, unansweredAsksInCycle } from "./service";
import { enqueueBillCheckin, removeBillFromCheckin } from "./pendingCheckin";
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
        // 3 avisos sem resposta neste ciclo: fecha em silencio, sem lancar gasto, e soma a recorrencia (o 3o aviso ja avisou que seria o ultimo)
        const previousAsks = unansweredAsksInCycle(bill, today);
        if (previousAsks >= BILL_MAX_UNANSWERED_ASKS) {
          if (closeBillAlertUnanswered(bill.from_number, bill.id, today)) {
            removeBillFromCheckin(bill.from_number, bill.id);
            logActivity(bill.from_number, "bill_alert", `fechado sem resposta apos ${BILL_MAX_UNANSWERED_ASKS} avisos: ${bill.name}`);
            items++;
          }
          continue;
        }
        // manda ANTES de marcar/armar a pendencia -- se o envio falhar (ex:
        // Evolution API fora do ar), nada fica registrado como "perguntado".
        // Na ordem antiga, uma falha aqui deixava o sistema achando que
        // perguntou (e esperando a resposta) sem o cliente nunca ter visto
        // a pergunta -- a proxima mensagem dele recebia "ja resolveu X?" do nada.
        const lateFromDate = billLateFromDate(bill, today);
        const monthEndFromDay = bill.recurrence_type === "day_of_month" && !lateFromDate ? monthEndShiftFrom(bill.day_of_month, today) : null;
        const isLastAsk = previousAsks + 1 >= BILL_MAX_UNANSWERED_ASKS;
        await sendText(
          bill.from_number,
          buildBillAlertQuestion({ name: bill.name, recurrenceType: bill.recurrence_type, intervalDays: bill.interval_days, monthEndFromDay, lateFromDate, isLastAsk })
        );
        markBillAlertAsked(bill.from_number, bill.id, today);
        enqueueBillCheckin(bill.from_number, {
          billAlertId: bill.id,
          name: bill.name,
          recurrenceType: bill.recurrence_type,
          intervalDays: bill.interval_days,
          monthEndFromDay,
          lateFromDate,
          isLastAsk,
        });
        // sem resposta, o aviso volta amanha (ate o limite de 3): a soneca agenda isso; qualquer resposta que fecha o ciclo a limpa
        snoozeBillAlert(bill.from_number, bill.id, addDaysToDateString(today, 1));
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
