import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { logActivity } from "../activity/service";
import {
  getDueEventReminders,
  getSkippedEventReminders,
  markEventReminderSent,
  getDueExtraEventReminders,
  markEventExtraReminderSent,
  formatMinutesBefore,
} from "./service";

// eventos cujo aviso ja foi registrado como ignorado (RF07): no maximo uma vez por evento (por processo)
const loggedSkipped = new Set<number>();

export function logSkippedEventReminders() {
  for (const event of getSkippedEventReminders()) {
    if (loggedSkipped.has(event.id)) continue;
    loggedSkipped.add(event.id);
    logActivity(event.from_number, "event_reminder_skipped", `aviso de "${event.title}" ignorado: o evento ja comecou`);
  }
}

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
    logSkippedEventReminders();
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
