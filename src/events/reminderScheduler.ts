import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueEventReminders, markEventReminderSent } from "./service";

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
    for (const event of due) {
      try {
        const when = spTimeFormatter.format(new Date(event.start));
        await sendText(event.from_number, `🔔 Daqui a ${event.reminder_minutes} min: ${event.title} (${when})`);
        markEventReminderSent(event.id);
      } catch (err) {
        console.error(`Erro ao enviar aviso do evento ${event.id}:`, err);
      }
    }
  });
}
