import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueReminders, markReminderSent } from "./service";

// dica enviada junto de todo lembrete que toca (RN16) -- uma constante so, facil de desligar
export const SNOOZE_HINT = 'Pra adiar, responde "adia 30 min" ou "adia pra amanhã 9h".';

export function reminderText(message: string): string {
  return `\u{1F514} Lembrete: ${message}${SNOOZE_HINT ? `\n${SNOOZE_HINT}` : ""}`;
}

export function startReminderScheduler() {
  // roda a cada minuto, checa quais lembretes venceram e envia no WhatsApp
  cron.schedule("* * * * *", async () => {
    const due = getDueReminders();
    for (const reminder of due) {
      try {
        await sendText(reminder.to_number, reminderText(reminder.message));
        markReminderSent(reminder.to_number, reminder.id);
      } catch (err) {
        console.error(`Erro ao enviar lembrete ${reminder.id}:`, err);
      }
    }
  });
}
