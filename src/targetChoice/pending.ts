// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): o usuario pediu uma acao citando um item pelo nome e
// houve mais de um candidato -- o bot mandou a lista numerada e espera o numero.
// Guarda a interpretacao ORIGINAL (pra continuar exatamente de onde parou, sem o
// usuario reescrever o pedido) e os ids dos candidatos mostrados.
import type { Interpretation } from "../ai/interpret";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { clearPending, getPending, setPending } from "../pending/store";

export type TargetKind = "event" | "reminder" | "expense" | "recurring" | "income" | "reminder_sent";

export interface PendingTargetChoice {
  kind: TargetKind;
  action: Interpretation;
  candidateIds: number[];
  createdAt: number;
}

const KIND = "target_choice";
const VERSION = 1;

export function setPendingTargetChoice(fromNumber: string, data: Omit<PendingTargetChoice, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: "lista de opções", ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingTargetChoice(fromNumber: string): PendingTargetChoice | null {
  const stored = getPending<Omit<PendingTargetChoice, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingTargetChoice(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
