import { downloadMedia, sendText } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, Interpretation } from "./ai/interpret";
import { createCalendarEvent } from "./google/calendar";
import { appendExpense } from "./google/sheets";
import { createReminder } from "./reminders/service";

interface IncomingMessage {
  from: string;
  type: "text" | "audio" | "image" | string;
  text?: { body: string };
  audio?: { id: string };
  image?: { id: string; mime_type: string };
}

export async function handleIncomingMessage(message: IncomingMessage) {
  const from = message.from;

  let interpretation: Interpretation;

  if (message.type === "text" && message.text) {
    interpretation = await interpretText(message.text.body);
  } else if (message.type === "audio" && message.audio) {
    const audio = await downloadMedia(message.audio.id);
    const text = await transcribeAudio(audio);
    interpretation = await interpretText(text);
  } else if (message.type === "image" && message.image) {
    const image = await downloadMedia(message.image.id);
    interpretation = await interpretReceiptImage(image.toString("base64"), message.image.mime_type);
  } else {
    await sendText(from, "Por enquanto so entendo texto, audio e imagem de comprovante. 🙂");
    return;
  }

  await handleInterpretation(from, interpretation);
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
