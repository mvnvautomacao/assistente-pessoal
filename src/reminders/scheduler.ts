import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { formatWhen } from "../confirmation/preview";
import { getDueReminders, markReminderSent } from "./service";

// dica enviada junto de todo lembrete que toca (RN16) -- uma constante so, facil de desligar
export const SNOOZE_HINT = 'Pra adiar, responde "adia 30 min" ou "adia pra amanhã 9h".';

// Card 19 (RN07): lembrete atrasado em mais que isso sai com a linha de atraso; no maximo isso de lembretes por rodada (minuto)
export const REMINDER_LATE_AFTER_MS = 10 * 60 * 1000;
export const MAX_REMINDERS_PER_ROUND = 10;

export function reminderText(message: string, lateDueAt?: string): string {
  const late = lateDueAt ? `\n⏰ (atrasado: era pra ${formatWhen(lateDueAt)})` : "";
  return `\u{1F514} Lembrete: ${message}${late}${SNOOZE_HINT ? `\n${SNOOZE_HINT}` : ""}`;
}

// Uma rodada (chamada a cada minuto): envia os vencidos, do mais antigo pro mais novo, ate o teto. Sem limite de idade: lembrete antigo ainda
// sai, com o aviso de atraso. Devolve quantos foram enviados.
export async function sendDueReminders(now: Date = new Date(Date.now())): Promise<number> {
  let sent = 0;
  for (const reminder of getDueReminders(now, MAX_REMINDERS_PER_ROUND)) {
    try {
      const late = now.getTime() - new Date(reminder.due_at).getTime() > REMINDER_LATE_AFTER_MS;
      await sendText(reminder.to_number, reminderText(reminder.message, late ? reminder.due_at : undefined));
      markReminderSent(reminder.to_number, reminder.id);
      sent++;
    } catch (err) {
      console.error(`Erro ao enviar lembrete ${reminder.id}:`, err);
    }
  }
  return sent;
}

export function startReminderScheduler() {
  // roda a cada minuto, checa quais lembretes venceram e envia no WhatsApp
  cron.schedule("* * * * *", async () => {
    await sendDueReminders();
  });
}
