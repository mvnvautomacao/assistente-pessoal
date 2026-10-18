// Estado das sugestoes de frase solta (Card 17), persistido em pending_state (sobrevive a reinicio, expira em 10 min):
// o bot mostrou "Seria: 1 ... 2 ... 3 ..." (ou "Data de quê? 1 Gasto 2 Evento 3 Lembrete") e espera o numero.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { clearPending, getPending, setPending } from "../pending/store";
import type { LooseOption } from "./looseCommands";

export interface PendingLooseSuggest {
  options: LooseOption[];
  createdAt: number;
}

const KIND = "loose_suggest";
const VERSION = 1;

export function setPendingLooseSuggest(fromNumber: string, options: LooseOption[]) {
  setPending(fromNumber, KIND, { payload: { options }, label: "sugestões", ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingLooseSuggest(fromNumber: string): PendingLooseSuggest | null {
  const stored = getPending<{ options: LooseOption[] }>(fromNumber, KIND, VERSION);
  return stored ? { options: stored.payload.options, createdAt: stored.createdAt } : null;
}

export function clearPendingLooseSuggest(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
