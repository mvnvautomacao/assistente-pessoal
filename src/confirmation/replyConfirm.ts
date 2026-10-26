// Card 24: "Entendi que foi *N*. Confirma?" -- o estado (pending_state, kind reply_confirm, 10 min), as mensagens e a leitura da resposta (1/sim, 2/nao,
// qualquer outra coisa). Aplicar e o roteador chamando o resolvedor ORIGINAL com o numero da opcao: nenhuma regra de negocio mora aqui.
import { EDIT_PENDING_TTL_MS } from "./constants";
import { classifyConfirmationReply } from "./classify";
import { normalizeReply } from "./normalize";
import { parseChoiceNumber } from "./numbers";
import { clearPending, getPending, setPending } from "../pending/store";

export type ReplySource = "audio" | "text";

export interface PendingReplyConfirm {
  optionNumber: number;
  optionLabel: string;
  intent: string;
  originalText: string; // o que o cliente disse (transcrito, se foi audio)
  source: ReplySource;
  repeatText: string; // a pergunta original, mostrada de novo no "2 Nao, ver as opcoes"
  signature: string; // identifica a pergunta aberta quando a sugestao nasceu: se mudou, ela ja nao esta mais aberta
  subject: string | null;
  level: "rules" | "ai";
  createdAt: number;
}

const KIND = "reply_confirm";
const VERSION = 1;

export function setPendingReplyConfirm(fromNumber: string, data: Omit<PendingReplyConfirm, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.optionLabel, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingReplyConfirm(fromNumber: string): PendingReplyConfirm | null {
  const stored = getPending<Omit<PendingReplyConfirm, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingReplyConfirm(fromNumber: string) {
  clearPending(fromNumber, KIND);
}

// o que o bot ouviu, ate 120 caracteres (so em mensagem vinda de audio; RN08)
export const HEARD_MAX_CHARS = 120;

export function truncateText(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

export function heardLine(text: string): string {
  return `🎧 Ouvi: "${truncateText(text, HEARD_MAX_CHARS)}"`;
}

export const REPLY_CONFIRM_OPTIONS = "1 Sim, é isso\n2 Não, ver as opções";

export function buildReplyConfirmMessage(input: { optionNumber: number; optionLabel: string; subject?: string | null; heard?: string | null }): string {
  const lead = input.subject ? `Sobre *${input.subject}*: ` : "";
  const heard = input.heard ? `${heardLine(input.heard)}\n` : "";
  return `${heard}${lead}Entendi que foi *${input.optionNumber} ${input.optionLabel}*. Confirma?\n${REPLY_CONFIRM_OPTIONS}`;
}

export const REPLY_QUESTION_GONE_TEXT = "Essa pergunta já não está mais aberta.";

// frases que valem como "nao, ver as opcoes" (a mensagem inteira)
const NO_PHRASES = new Set(["nao", "n", "negativo", "nao e isso", "nao nao", "errado", "ver as opcoes", "nao ver as opcoes", "opcoes", "as opcoes"]);

export type ReplyConfirmAnswer = "yes" | "no" | "other";

// 1/sim e equivalentes aplicam; 2/nao mostram as opcoes de novo; QUALQUER outra coisa ("3", "cancelar", outra frase) descarta a sugestao
export function readReplyConfirmation(text: string): ReplyConfirmAnswer {
  const number = parseChoiceNumber(text);
  if (number === 1) return "yes";
  if (number === 2) return "no";
  if (number !== null) return "other";
  if (NO_PHRASES.has(normalizeReply(text))) return "no";
  return classifyConfirmationReply(text) === "confirm" ? "yes" : "other";
}
