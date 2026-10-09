// Cache curto e em memoria: o usuario pediu uma acao citando um item pelo nome e
// houve mais de um candidato -- o bot mandou a lista numerada e espera o numero.
// Guarda a interpretacao ORIGINAL (pra continuar exatamente de onde parou, sem o
// usuario reescrever o pedido) e os ids dos candidatos mostrados.
import type { Interpretation } from "../ai/interpret";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export type TargetKind = "event" | "reminder" | "expense" | "recurring" | "income" | "reminder_sent";

export interface PendingTargetChoice {
  kind: TargetKind;
  action: Interpretation;
  candidateIds: number[];
  createdAt: number;
}

const pending = new Map<string, PendingTargetChoice>();

// no maximo uma escolha de alvo por numero: criar outra substitui a anterior
export function setPendingTargetChoice(fromNumber: string, data: Omit<PendingTargetChoice, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingTargetChoice(fromNumber: string): PendingTargetChoice | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > EDIT_PENDING_TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingTargetChoice(fromNumber: string) {
  pending.delete(fromNumber);
}
