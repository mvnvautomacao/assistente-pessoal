import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueReminders, markReminderSent } from "./service";

export function startReminderScheduler() {
  // roda a cada minuto, checa quais lembretes venceram e envia no WhatsApp
  cron.schedule("* * * * *", async () => {
    const due = getDueReminders();
    for (const reminder of due) {
      try {
        await sendText(reminder.to_number, `\u{1F514} Lembrete: ${reminder.message}`);
        markReminderSent(reminder.id);
      } catch (err) {
        console.error(`Erro ao enviar lembrete ${reminder.id}:`, err);
      }
    }
  });
}
