import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueBillAlerts, markBillAlertAsked, snoozeBillAlert } from "./service";
import { enqueueBillCheckin } from "./pendingCheckin";
import { buildBillAlertQuestion } from "./checkinReply";
import { logActivity } from "../activity/service";
import { addDaysToDateString, spDateString } from "../timeSP";

export function startBillAlertScheduler() {
  // roda todo dia as 8h: pergunta "ja fez?" pros alertas cujo dia do mes bate
  // com hoje, ou cujo intervalo ja venceu (ou cuja soneca de "lembra amanha" venceu)
  cron.schedule(
    "0 8 * * *",
    async () => {
      const today = spDateString();
      const due = getDueBillAlerts(today);
      for (const bill of due) {
        try {
          // manda ANTES de marcar/armar a pendencia -- se o envio falhar (ex:
          // Evolution API fora do ar), nada fica registrado como "perguntado".
          // Na ordem antiga, uma falha aqui deixava o sistema achando que
          // perguntou (e esperando a resposta) sem o cliente nunca ter visto
          // a pergunta -- a proxima mensagem dele recebia "ja resolveu X?" do nada.
          await sendText(bill.from_number, buildBillAlertQuestion({ name: bill.name, recurrenceType: bill.recurrence_type }));
          markBillAlertAsked(bill.from_number, bill.id, today);
          const position = enqueueBillCheckin(bill.from_number, {
            billAlertId: bill.id,
            name: bill.name,
            recurrenceType: bill.recurrence_type,
            intervalDays: bill.interval_days,
          });
          // varios avisos no mesmo dia: o que espera na fila volta a perguntar amanha se a fila se perder
          // (ex: o da vez vence esperando o valor)
          if (position === "queued") snoozeBillAlert(bill.from_number, bill.id, addDaysToDateString(today, 1));
          logActivity(bill.from_number, "bill_alert", `pergunta enviada: ${bill.name}`);
        } catch (err) {
          console.error(`Erro ao avisar alerta de conta fixa ${bill.id}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
