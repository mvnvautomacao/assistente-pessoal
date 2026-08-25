import { sendText } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, Interpretation } from "./ai/interpret";
import { createCalendarEvent } from "./google/calendar";
import { appendExpense } from "./google/sheets";
import { createReminder } from "./reminders/service";

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
      await sendText(from, `✅ Gasto registrado: R$${interpretation.amount.toFixed(2)} em ${interpretation.category}`);
      break;
    }
    case "event": {
      await createCalendarEvent(interpretation);
      await sendText(from, `📅 Evento "${interpretation.title}" criado na agenda`);
      break;
    }
    case "reminder": {
      createReminder(from, interpretation.message, interpretation.due_at);
      await sendText(from, `⏰ Lembrete criado: "${interpretation.message}"`);
      break;
    }
    default: {
      await sendText(from, "Nao entendi se isso e um gasto, um evento ou um lembrete. Pode reformular?");
    }
  }
}
