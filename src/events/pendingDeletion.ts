// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer cancelar o evento X?" antes de excluir de verdade, pra resolver a
// resposta ("sim"/"nao") na proxima mensagem. Mesma ideia dos outros caches
// de conversa (listCache.ts, pendingListChoice.ts).
const TTL_MS = 5 * 60 * 1000;

interface PendingDeletion {
  eventId: number;
  title: string;
  createdAt: number;
}

const pending = new Map<string, PendingDeletion>();

export function setPendingEventDeletion(fromNumber: string, eventId: number, title: string) {
  pending.set(fromNumber, { eventId, title, createdAt: Date.now() });
}

export function getPendingEventDeletion(fromNumber: string): PendingDeletion | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEventDeletion(fromNumber: string) {
  pending.delete(fromNumber);
}
