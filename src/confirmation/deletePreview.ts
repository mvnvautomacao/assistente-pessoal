// Confirmacao de apagar/remover no padrao 1/3 (Card 9): monta a pergunta de cada um dos
// 9 fluxos, a mensagem "nao entendi" e interpreta a resposta. Funcoes puras, sem I/O --
// o router so liga isto aos handlers de cada fluxo.
import { classifyConfirmationReply } from "./classify";
import { normalizeReply } from "./normalize";
import { parseChoiceNumber } from "./numbers";

export type DeleteFlow =
  | "event"
  | "reminder"
  | "expense"
  | "installment"
  | "category"
  | "budget"
  | "recurring"
  | "bill_alert"
  | "merge"
  | "bulk";

interface FlowText {
  confirm: string; // opcao 1
  cancel: string; // opcao 3
  verb: string; // "Responde *1* pra <verbo> ..."
}

const FLOWS: Record<DeleteFlow, FlowText> = {
  event: { confirm: "🗑️ Cancelar o evento", cancel: "↩️ Manter na agenda", verb: "cancelar o evento" },
  reminder: { confirm: "🗑️ Apagar", cancel: "❌ Cancelar", verb: "apagar" },
  expense: { confirm: "🗑️ Apagar", cancel: "❌ Cancelar", verb: "apagar" },
  installment: { confirm: "🗑️ Apagar todas", cancel: "❌ Cancelar", verb: "apagar" },
  category: { confirm: "🗑️ Apagar", cancel: "❌ Cancelar", verb: "apagar" },
  budget: { confirm: "🗑️ Remover", cancel: "❌ Cancelar", verb: "remover" },
  recurring: { confirm: "🛑 Parar de lançar", cancel: "❌ Cancelar", verb: "parar" },
  bill_alert: { confirm: "🛑 Parar de avisar", cancel: "❌ Cancelar", verb: "parar" },
  merge: { confirm: "🔀 Juntar", cancel: "❌ Cancelar", verb: "juntar" },
  bulk: { confirm: "✅ Mudar", cancel: "❌ Cancelar", verb: "mudar" },
};

export interface DeleteSpec {
  flow: DeleteFlow;
  title: string; // 1a linha: "🗑️ Apagar este gasto?"
  detail?: string; // o item no formato padrao ("Mercado — R$ 38,00 · 07/10 · Pix")
  notes?: string[]; // avisos extras (uma linha cada)
  // so no apagar gasto sem alvo explicito: oferece "2 Nao e esse, ver os ultimos"
  offerOther?: boolean;
}

export const OTHER_OPTION_TEXT = "🔎 Não é esse, ver os últimos";

export function formatDeleteConfirmation(spec: DeleteSpec): string {
  const text = FLOWS[spec.flow];
  const body = [spec.detail, ...(spec.notes ?? [])].filter((line): line is string => Boolean(line)).join("\n");
  const options = [`1 ${text.confirm}`, ...(spec.offerOther ? [`2 ${OTHER_OPTION_TEXT}`] : []), `3 ${text.cancel}`].join("\n");
  return `${spec.title}\n${body ? `${body}\n` : ""}\n${options}`;
}

export function deleteNotUnderstood(spec: Pick<DeleteSpec, "flow" | "offerOther">): string {
  if (spec.offerOther) return "Não entendi 🤔 Responde *1* pra apagar, *2* pra ver os últimos gastos ou *3* pra cancelar.";
  const text = FLOWS[spec.flow];
  const cancel = spec.flow === "event" ? "manter" : "cancelar";
  return `Não entendi 🤔 Responde *1* pra ${text.verb} ou *3* pra ${cancel}.`;
}

export type DeleteReply = "confirm" | "cancel" | "other" | "not_understood";

// "nao e esse" / "outro" so valem quando o fluxo oferece a opcao 2
const OTHER_PHRASES = new Set(["nao e esse", "nao e essa", "nao e esse nao", "outro", "outra", "o outro", "no outro", "ver os ultimos", "ver outros"]);

// RN01: so confirma/cancela quando a mensagem INTEIRA e de confirmar/cancelar -- "pode ser
// amanha", "sim, mas so o do dia 10" e "nao, e o outro" nunca viram sim/nao.
export function interpretDeleteReply(answerText: string, offerOther: boolean): DeleteReply {
  const reply = classifyConfirmationReply(answerText);
  if (reply === "confirm") return "confirm";
  if (reply === "cancel") return "cancel";
  if (offerOther) {
    const normalized = normalizeReply(answerText);
    if (parseChoiceNumber(answerText) === 2 || OTHER_PHRASES.has(normalized)) return "other";
  }
  return "not_understood";
}
