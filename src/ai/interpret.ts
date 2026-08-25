import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export type Interpretation =
  | { type: "expense"; amount: number; category: string; description: string; date: string }
  | { type: "event"; title: string; start: string; end?: string; location?: string }
  | { type: "delete_event"; query: string }
  | { type: "reminder"; message: string; due_at: string }
  | { type: "report"; days: number }
  | { type: "unknown"; description?: string };

const ACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: ["expense", "event", "reminder", "delete_event", "report", "unknown"],
      description:
        "expense = o usuario relatou um gasto/compra. event = quer marcar algo na agenda com data/hora. reminder = quer ser lembrado de algo depois. delete_event = quer cancelar/remover/desmarcar um compromisso que ja existe na agenda. report = quer um resumo/relatorio do que tem agendado (eventos e/ou lembretes) nos proximos dias. unknown = nao deu pra entender.",
    },
    amount: { type: "number", description: "Valor do gasto em reais (so para type=expense)" },
    category: { type: "string", description: "Categoria do gasto, ex: mercado, transporte, lazer (so para type=expense)" },
    description: { type: "string", description: "Descricao curta (expense) ou motivo (unknown)" },
    date: { type: "string", description: "Data ISO 8601 do gasto (so para type=expense)" },
    title: { type: "string", description: "Titulo do evento (so para type=event)" },
    start: { type: "string", description: "Data/hora ISO 8601 de inicio (so para type=event)" },
    end: { type: "string", description: "Data/hora ISO 8601 de fim, opcional (so para type=event)" },
    location: { type: "string", description: "Local do evento, opcional (so para type=event)" },
    query: { type: "string", description: "Palavra-chave pra buscar o evento a cancelar, ex: o titulo ou parte dele (so para type=delete_event)" },
    message: { type: "string", description: "Texto do lembrete (so para type=reminder)" },
    due_at: { type: "string", description: "Data/hora ISO 8601 em que o lembrete deve ser enviado (so para type=reminder)" },
    days: { type: "number", description: "Quantidade de dias a frente pro relatorio (so para type=report). Se o usuario nao especificar, use 7." },
  },
  required: ["type"],
};

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "record_actions",
  description:
    "Classifica a mensagem do usuario em uma ou mais acoes estruturadas. A maioria das mensagens tem 1 pedido so, mas se o usuario pedir mais de uma coisa na mesma mensagem (ex: 'marca dentista amanha e reuniao sexta'), inclua uma entrada em 'actions' para cada pedido identificado.",
  input_schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        description: "Uma entrada para cada pedido/acao identificado na mensagem, na ordem em que aparecem.",
        items: ACTION_SCHEMA,
      },
    },
    required: ["actions"],
  },
};

function buildSystemPrompt() {
  const now = new Date().toISOString();
  return `Voce interpreta mensagens de WhatsApp de um assistente pessoal. Data/hora atual: ${now} (America/Sao_Paulo).
Sempre chame a ferramenta record_actions com o resultado. Datas relativas ("amanha", "sexta que vem") devem ser convertidas para ISO 8601 com base na data atual.
Se a mensagem tiver mais de um pedido (ex: dois eventos, ou um gasto e um lembrete), retorne uma acao para cada um dentro de "actions".`;
}

async function classify(content: Anthropic.MessageParam["content"]): Promise<Interpretation[]> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1536,
    system: buildSystemPrompt(),
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "record_actions" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return [{ type: "unknown", description: "Modelo nao retornou classificacao" }];
  }

  const input = toolUse.input as { actions?: Interpretation[] };
  return input.actions?.length ? input.actions : [{ type: "unknown", description: "Nenhuma acao identificada" }];
}

export async function interpretText(text: string): Promise<Interpretation[]> {
  return classify(text);
}

export async function interpretReceiptImage(imageBase64: string, mediaType: string): Promise<Interpretation[]> {
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
