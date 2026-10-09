// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer mudar o lembrete X pra data/hora Y?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { clearPending, getPending, setPending } from "../pending/store";
const TTL_MS = EDIT_PENDING_TTL_MS;

export interface PendingEditReminder {
  reminderId: number;
  message: string; // texto ATUAL (antes dessa edicao) -- usado nas mensagens de confirmacao
  previousDueAt: string;
  proposedMessage: string;
  proposedDueAt: string;
  // mesma ideia do PendingEditEvent: so reinterpreta resposta livre como nova
  // data/hora quando a mudanca pedida envolve data/hora.
  isDateTimeChange: boolean;
  changeText: string;
  awaitingCorrection: boolean;
  // com mais de uma mudanca (Quando + Texto) a opcao 2 pergunta QUAL corrigir ("pick")
  correctionStage: "pick" | "value";
  correctionTarget: "datetime" | "text" | null;
  headerText: string; // 1a linha da previa (ex: "Mercado — R$ 38,00 · 07/10 · Pix"), fixa durante a confirmacao
  createdAt: number;
}

const KIND = "edit_reminder";
const VERSION = 1;

export function setPendingEditReminder(fromNumber: string, data: Omit<PendingEditReminder, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.message, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditReminder(fromNumber: string): PendingEditReminder | null {
  const stored = getPending<Omit<PendingEditReminder, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEditReminder(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
