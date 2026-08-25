import { sendText } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, Interpretation } from "./ai/interpret";
import { createCalendarEvent, findUpcomingEvents, deleteCalendarEvent, listUpcomingEvents } from "./google/calendar";
import { appendExpense } from "./google/sheets";
import { createReminder, getRemindersWithinDays } from "./reminders/service";
import { logActivity } from "./activity/service";
import type { calendar_v3 } from "googleapis";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatEventStart(start?: calendar_v3.Schema$EventDateTime): string {
  const value = start?.dateTime ?? start?.date;
  return value ? formatDateTime(value) : "data desconhecida";
}

// Formato do evento "messages.upsert" da Evolution API. O campo com o audio/imagem
// em base64 pode vir em lugares diferentes dependendo da versao/config da API.
interface EvolutionMessage {
  key: { remoteJid: string; fromMe: boolean };
  messageType: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    base64?: string;
    audioMessage?: { mimetype?: string };
    imageMessage?: { mimetype?: string };
  };
  base64?: string;
}

export async function handleIncomingMessage(data: EvolutionMessage) {
  const from = data.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");
  const base64Media = data.message?.base64 ?? data.base64;

  let interpretation: Interpretation;

  if (data.messageType === "conversation" || data.messageType === "extendedTextMessage") {
    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
    interpretation = await interpretText(text);
  } else if (data.messageType === "audioMessage" && base64Media) {
    const text = await transcribeAudio(Buffer.from(base64Media, "base64"));
    interpretation = await interpretText(text);
  } else if (data.messageType === "imageMessage" && base64Media) {
    const mimeType = data.message?.imageMessage?.mimetype ?? "image/jpeg";
    interpretation = await interpretReceiptImage(base64Media, mimeType);
  } else {
    await sendText(from, "Por enquanto so entendo texto, audio e imagem de comprovante. 🙂");
    return;
  }

  try {
    await handleInterpretation(from, interpretation);
  } catch (err) {
    console.error("Erro ao processar interpretacao:", err);
    logActivity(from, "error", err instanceof Error ? err.message : String(err));
    await sendText(from, "Deu erro aqui do meu lado tentando processar isso. Tenta de novo em instantes.");
  }
}

async function handleInterpretation(from: string, interpretation: Interpretation) {
  switch (interpretation.type) {
    case "expense": {
      await appendExpense({
        date: interpretation.date,
        category: interpretation.category,
        description: interpretation.description,
        amount: interpretation.amount,
      });
      logActivity(from, "expense", `R$${interpretation.amount.toFixed(2)} em ${interpretation.category} — ${interpretation.description}`);
      await sendText(from, `✅ Gasto registrado: R$${interpretation.amount.toFixed(2)} em ${interpretation.category}`);
      break;
    }
    case "event": {
      await createCalendarEvent(interpretation);
      logActivity(from, "event", `${interpretation.title} — ${interpretation.start}`);
      await sendText(from, `📅 Evento "${interpretation.title}" criado na agenda`);
      break;
    }
    case "delete_event": {
      const matches = await findUpcomingEvents(interpretation.query);
      if (matches.length === 0) {
        logActivity(from, "delete_event", `nenhum evento encontrado para "${interpretation.query}"`);
        await sendText(from, `Não encontrei nenhum evento parecido com "${interpretation.query}" nos próximos 60 dias.`);
      } else if (matches.length === 1) {
        const event = matches[0];
        await deleteCalendarEvent(event.id!);
        logActivity(from, "delete_event", `removido: ${event.summary}`);
        await sendText(from, `🗑️ Evento "${event.summary}" removido da agenda`);
      } else {
        const list = matches
          .map((e) => `• ${e.summary} — ${formatEventStart(e.start)}`)
          .join("\n");
        logActivity(from, "delete_event", `${matches.length} eventos parecidos com "${interpretation.query}", pedi pra especificar`);
        await sendText(from, `Achei mais de um evento parecido com "${interpretation.query}":\n${list}\n\nMe diga o nome mais específico de qual quer cancelar.`);
      }
      break;
    }
    case "reminder": {
      createReminder(from, interpretation.message, interpretation.due_at);
      logActivity(from, "reminder", `${interpretation.message} — ${interpretation.due_at}`);
      await sendText(from, `⏰ Lembrete criado: "${interpretation.message}"`);
      break;
    }
    case "report": {
      const days = interpretation.days ?? 7;
      const [events, reminders] = await Promise.all([listUpcomingEvents(days), Promise.resolve(getRemindersWithinDays(days))]);

      const eventsText = events.length
        ? events.map((e) => `• ${e.summary} — ${formatEventStart(e.start)}`).join("\n")
        : "Nenhum evento agendado.";
      const remindersText = reminders.length
        ? reminders.map((r) => `• ${r.message} — ${formatDateTime(r.due_at)}`).join("\n")
        : "Nenhum lembrete agendado.";

      logActivity(from, "report", `proximos ${days} dias: ${events.length} eventos, ${reminders.length} lembretes`);
      await sendText(from, `📊 Próximos ${days} dias\n\n📅 Agenda:\n${eventsText}\n\n⏰ Lembretes:\n${remindersText}`);
      break;
    }
    default: {
      logActivity(from, "unknown", interpretation.description ?? "nao classificado");
      await sendText(from, "Nao entendi se isso e um gasto, um evento (criar ou cancelar) ou um lembrete. Pode reformular?");
    }
  }
}
