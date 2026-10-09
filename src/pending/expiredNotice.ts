// Aviso de expiracao: quem responde "1", "sim", "2" ou "desfaz" DEPOIS do prazo recebe uma
// explicacao clara, em vez de a mensagem ir pra IA e virar outra coisa. So vale quando o
// numero nao tem nenhuma pendencia ativa (o router chama isto depois de todas as
// checagens de pendencia, antes da IA) e a mensagem inteira e so uma resposta de pendencia.
import { classifyConfirmationReply, normalizeReply } from "../confirmation/classify";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { parseChoiceNumber } from "../targetChoice/reply";
import { ExpiredPending, findExpiredUnnotified, markExpiredNotified } from "./store";

const TTL_MINUTES = Math.round(EDIT_PENDING_TTL_MS / 60000);

export type ReplyShape = "undo" | "reply";

const UNDO_WORDS = new Set(["desfazer", "desfaz", "desfaz isso", "desfazer isso", "desfaz a ultima", "desfazer a ultima"]);

// a mensagem inteira e so uma resposta de pendencia? ("desfazer" / sim, nao, 1, 3 / numero de 1 a 9)
export function replyShape(text: string): ReplyShape | null {
  if (UNDO_WORDS.has(normalizeReply(text))) return "undo";
  const reply = classifyConfirmationReply(text);
  if (reply === "confirm" || reply === "cancel") return "reply";
  const number = parseChoiceNumber(text);
  if (number !== null && number >= 1 && number <= 9) return "reply";
  return null;
}

const LIST_KINDS = new Set(["target_choice", "edit_target"]);

export function expiredNoticeText(expired: Pick<ExpiredPending, "kind" | "label">): string {
  if (expired.kind === "undo") {
    return `⌛ O prazo pra desfazer "${expired.label ?? "essa ação"}" já passou (${TTL_MINUTES} minutos). Se precisar corrigir, é só pedir a edição de novo.`;
  }
  if (LIST_KINDS.has(expired.kind)) {
    return `⌛ A lista de opções expirou (passaram mais de ${TTL_MINUTES} minutos). Me diz de novo o que você quer fazer, ex: "muda o mercado pra 40".`;
  }
  return `⌛ A confirmação de "${expired.label ?? "essa alteração"}" expirou (passaram mais de ${TTL_MINUTES} minutos) e eu não mexi em nada. Se ainda quiser, é só pedir de novo.`;
}

// Devolve o aviso a enviar (ou null, e a mensagem segue o fluxo normal). Marca TODAS as
// vencidas do numero como avisadas: um segundo "1" nao gera outro aviso.
export function consumeExpiredNotice(fromNumber: string, text: string, now: number = Date.now()): string | null {
  const shape = replyShape(text);
  if (!shape) return null;
  const expired = findExpiredUnnotified(fromNumber, now);
  if (expired.length === 0) return null;
  // "desfaz" fala do desfazer; as demais respostas falam de confirmacao/lista/menu
  const candidates = expired.filter((e) => (shape === "undo" ? e.kind === "undo" : e.kind !== "undo"));
  if (candidates.length === 0) return null;
  markExpiredNotified(fromNumber, now);
  return expiredNoticeText(candidates[0]);
}
