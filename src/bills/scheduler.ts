import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueBillAlerts, markBillAlertAsked } from "./service";
import { setPendingBillCheckin } from "./pendingCheckin";
import { logActivity } from "../activity/service";
import { spDateString } from "../timeSP";

export function startBillAlertScheduler() {
  // roda todo dia as 8h: pergunta "ja pagou?" pros alertas de conta fixa cujo
  // dia bate com hoje (ou cuja soneca de "lembra amanha" venceu)
  cron.schedule(
    "0 8 * * *",
    async () => {
      const today = spDateString();
      const due = getDueBillAlerts(today);
      for (const bill of due) {
        try {
          markBillAlertAsked(bill.id, today);
          setPendingBillCheckin(bill.from_number, { billAlertId: bill.id, name: bill.name });
          logActivity(bill.from_number, "bill_alert", `pergunta enviada: ${bill.name}`);
          await sendText(
            bill.from_number,
            `📌 Hoje é dia de pagar: ${bill.name}. Já pagou, ou quer que eu te lembre amanhã?`
          );
        } catch (err) {
          console.error(`Erro ao avisar alerta de conta fixa ${bill.id}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
