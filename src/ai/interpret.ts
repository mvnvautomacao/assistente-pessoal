import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export type Interpretation =
  | { type: "expense"; amount: number; category: string; description: string; date: string }
  | { type: "event"; title: string; start: string; end?: string; location?: string }
  | { type: "reminder"; message: string; due_at: string }
  | { type: "unknown"; description?: string };

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "record_action",
  description: "Classifica a mensagem do usuario e extrai os dados estruturados correspondentes.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["expense", "event", "reminder", "unknown"],
        description:
          "expense = o usuario relatou um gasto/compra. event = quer marcar algo na agenda com data/hora. reminder = quer ser lembrado de algo depois. unknown = nao deu pra entender.",
      },
      amount: { type: "number", description: "Valor do gasto em reais (so para type=expense)" },
      category: { type: "string", description: "Categoria do gasto, ex: mercado, transporte, lazer (so para type=expense)" },
      description: { type: "string", description: "Descricao curta (expense) ou motivo (unknown)" },
      date: { type: "string", description: "Data ISO 8601 do gasto (so para type=expense)" },
      title: { type: "string", description: "Titulo do evento (so para type=event)" },
      start: { type: "string", description: "Data/hora ISO 8601 de inicio (so para type=event)" },
      end: { type: "string", description: "Data/hora ISO 8601 de fim, opcional (so para type=event)" },
      location: { type: "string", description: "Local do evento, opcional (so para type=event)" },
      message: { type: "string", description: "Texto do lembrete (so para type=reminder)" },
      due_at: { type: "string", description: "Data/hora ISO 8601 em que o lembrete deve ser enviado (so para type=reminder)" },
    },
    required: ["type"],
  },
};

function buildSystemPrompt() {
  const now = new Date().toISOString();
  return `Voce interpreta mensagens de WhatsApp de um assistente pessoal. Data/hora atual: ${now} (America/Sao_Paulo).
Sempre chame a ferramenta record_action com o resultado. Datas relativas ("amanha", "sexta que vem") devem ser convertidas para ISO 8601 com base na data atual.`;
}

async function classify(content: Anthropic.MessageParam["content"]): Promise<Interpretation> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: buildSystemPrompt(),
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "record_action" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { type: "unknown", description: "Modelo nao retornou classificacao" };
  }
  return toolUse.input as Interpretation;
}

export async function interpretText(text: string): Promise<Interpretation> {
  return classify(text);
}

export async function interpretReceiptImage(imageBase64: string, mediaType: string): Promise<Interpretation> {
  return classify([
    {
      type: "image",
      source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageBase64 },
    },
    {
      type: "text",
      text: "Essa imagem e um comprovante/nota de um gasto. Extraia o valor total, categoria e descricao.",
    },
  ]);
}
