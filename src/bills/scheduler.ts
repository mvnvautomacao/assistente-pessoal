import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueBillAlerts, markBillAlertAsked } from "./service";
import { setPendingBillCheckin } from "./pendingCheckin";
import { logActivity } from "../activity/service";
import { spDateString } from "../timeSP";

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
          const question =
            bill.recurrence_type === "interval"
              ? `📌 Hora de: ${bill.name}. Já resolveu, ou quer que eu te lembre amanhã?`
              : `📌 Hoje é dia de pagar: ${bill.name}. Já pagou, ou quer que eu te lembre amanhã?`;
          await sendText(bill.from_number, question);
          markBillAlertAsked(bill.from_number, bill.id, today);
          setPendingBillCheckin(bill.from_number, {
            billAlertId: bill.id,
            name: bill.name,
            recurrenceType: bill.recurrence_type,
            intervalDays: bill.interval_days,
          });
          logActivity(bill.from_number, "bill_alert", `pergunta enviada: ${bill.name}`);
        } catch (err) {
          console.error(`Erro ao avisar alerta de conta fixa ${bill.id}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
