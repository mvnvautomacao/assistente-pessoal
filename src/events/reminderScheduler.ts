import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { db } from "../db";
import { logActivity } from "../activity/service";
import {
  getDueEventReminders,
  getSkippedEventReminders,
  markEventReminderSent,
  getDueExtraEventReminders,
  markEventExtraReminderSent,
  formatMinutesBefore,
} from "./service";

const SKIPPED_LOG_TYPE = "event_reminder_skipped";

// eventos cujo aviso ja foi registrado como ignorado (RF07): no maximo uma vez por evento. O Set e so um
// cache de curta duracao (so guarda ids que ainda aparecem na consulta, entao nao cresce); quem garante
// "uma vez" mesmo depois de um reinicio e a conferencia no proprio log de atividade.
const loggedSkipped = new Set<number>();

function skippedSummary(event: { id: number; title: string }): string {
  return `aviso de "${event.title}" (#${event.id}) ignorado: o evento ja comecou`;
}

function alreadyLoggedSkipped(event: { id: number; from_number: string; title: string }): boolean {
  const row = db
    .prepare(`SELECT 1 AS found FROM activity_log WHERE from_number = ? AND type = ? AND summary = ? LIMIT 1`)
    .get(event.from_number, SKIPPED_LOG_TYPE, skippedSummary(event));
  return row !== undefined;
}

// devolve quantos avisos ignorados foram registrados agora
export function logSkippedEventReminders(): number {
  const skipped = getSkippedEventReminders();
  const stillSkipped = new Set(skipped.map((e) => e.id));
  for (const id of loggedSkipped) if (!stillSkipped.has(id)) loggedSkipped.delete(id);

  let logged = 0;
  for (const event of skipped) {
    if (loggedSkipped.has(event.id)) continue;
    loggedSkipped.add(event.id);
    if (alreadyLoggedSkipped(event)) continue;
    logActivity(event.from_number, SKIPPED_LOG_TYPE, skippedSummary(event));
    logged++;
  }
  return logged;
}

const spTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// Card 19 (RN09): aviso que sai atrasado (servidor fora do ar) diz os minutos que de fato faltam, calculados na hora do envio; dentro da
// tolerancia mantem o texto de sempre ("Daqui a 1 hora")
export const EVENT_REMINDER_LATE_TOLERANCE_MS = 2 * 60 * 1000;

export function eventReminderLead(startIso: string, plannedMinutes: number, now: Date): string {
  const start = new Date(startIso).getTime();
  const lateMs = now.getTime() - (start - plannedMinutes * 60000);
  if (lateMs <= EVENT_REMINDER_LATE_TOLERANCE_MS) return formatMinutesBefore(plannedMinutes);
  return formatMinutesBefore(Math.max(0, Math.min(plannedMinutes, Math.ceil((start - now.getTime()) / 60000))));
}

// "Daqui a 20 min"; se o aviso saiu atrasado e o evento esta comecando (faltam 0 min), "Agora"
export function eventReminderPrefix(startIso: string, plannedMinutes: number, now: Date): string {
  const start = new Date(startIso).getTime();
  const late = now.getTime() - (start - plannedMinutes * 60000) > EVENT_REMINDER_LATE_TOLERANCE_MS;
  if (late && Math.ceil((start - now.getTime()) / 60000) <= 0) return "Agora";
  return `Daqui a ${eventReminderLead(startIso, plannedMinutes, now)}`;
}

// Uma rodada (chamada a cada minuto): avisos principais e extras que venceram
export async function sendDueEventReminders(now: Date = new Date(Date.now())) {
  logSkippedEventReminders();
  const due = getDueEventReminders(now);
  for (const event of due) {
    try {
      const when = spTimeFormatter.format(new Date(event.start));
      await sendText(event.from_number, `🔔 ${eventReminderPrefix(event.start, event.reminder_minutes, now)}: ${event.title} (${when})`);
      markEventReminderSent(event.from_number, event.id);
    } catch (err) {
      console.error(`Erro ao enviar aviso do evento ${event.id}:`, err);
    }
  }

  // alertas ADICIONAIS do mesmo evento (ver event_extra_reminders) -- cada um
  // dispara independente, com seu proprio "sent", igual o principal acima.
  const dueExtras = getDueExtraEventReminders(now);
  for (const extra of dueExtras) {
    try {
      const when = spTimeFormatter.format(new Date(extra.start));
      await sendText(extra.fromNumber, `🔔 ${eventReminderPrefix(extra.start, extra.minutesBefore, now)}: ${extra.title} (${when})`);
      markEventExtraReminderSent(extra.id);
    } catch (err) {
      console.error(`Erro ao enviar aviso extra do evento ${extra.eventId}:`, err);
    }
  }
}


export function startEventReminderScheduler() {
  // roda a cada minuto, igual o scheduler de lembretes normais
  cron.schedule("* * * * *", async () => {
    await sendDueEventReminders();
  });
}
