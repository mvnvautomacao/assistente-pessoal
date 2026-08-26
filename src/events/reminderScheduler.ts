import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueEventReminders, markEventReminderNotified } from "./notifications";

const spTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function startEventReminderScheduler() {
  // roda a cada minuto, igual o scheduler de lembretes normais
  cron.schedule("* * * * *", async () => {
    const due = getDueEventReminders();
    for (const reminder of due) {
      try {
        const when = spTimeFormatter.format(new Date(reminder.event_start));
        await sendText(reminder.from_number, `🔔 Daqui a ${reminder.reminder_minutes} min: ${reminder.title} (${when})`);
        markEventReminderNotified(reminder.id);
      } catch (err) {
        console.error(`Erro ao enviar aviso do evento ${reminder.event_id}:`, err);
      }
    }
  });
}
