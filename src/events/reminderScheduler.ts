import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { getDueEventReminders, markEventReminderSent, getDueExtraEventReminders, markEventExtraReminderSent, formatMinutesBefore } from "./service";

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
        await sendText(event.from_number, `🔔 Daqui a ${formatMinutesBefore(event.reminder_minutes)}: ${event.title} (${when})`);
        markEventReminderSent(event.from_number, event.id);
      } catch (err) {
        console.error(`Erro ao enviar aviso do evento ${event.id}:`, err);
      }
    }

    // alertas ADICIONAIS do mesmo evento (ver event_extra_reminders) -- cada um
    // dispara independente, com seu proprio "sent", igual o principal acima.
    const dueExtras = getDueExtraEventReminders();
    for (const extra of dueExtras) {
      try {
        const when = spTimeFormatter.format(new Date(extra.start));
        await sendText(extra.fromNumber, `🔔 Daqui a ${formatMinutesBefore(extra.minutesBefore)}: ${extra.title} (${when})`);
        markEventExtraReminderSent(extra.id);
      } catch (err) {
        console.error(`Erro ao enviar aviso extra do evento ${extra.eventId}:`, err);
      }
    }
  });
}
