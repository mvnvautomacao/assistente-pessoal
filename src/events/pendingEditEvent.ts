// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar o evento X pra data/hora Y?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingEditEvent {
  eventId: number;
  title: string; // titulo ATUAL (antes dessa edicao) -- usado nas mensagens de confirmacao
  previous: { title: string; start: string; end: string; location: string | null; reminderMinutes: number };
  proposedTitle: string;
  proposedStart: string;
  proposedEnd: string;
  proposedReminderMinutes: number;
  // habilita reinterpretar uma resposta livre (nem "sim" nem "nao") como uma
  // NOVA data/hora via IA -- so faz sentido quando a mudanca pedida envolve
  // data/hora; pra edicao so de titulo/antecedencia, uma resposta livre so
  // gera "nao entendi", sem tentar achar data nenhuma nela.
  isDateTimeChange: boolean;
  changeText: string;
  createdAt: number;
}

const pending = new Map<string, PendingEditEvent>();

export function setPendingEditEvent(fromNumber: string, data: Omit<PendingEditEvent, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingEditEvent(fromNumber: string): PendingEditEvent | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEditEvent(fromNumber: string) {
  pending.delete(fromNumber);
}
