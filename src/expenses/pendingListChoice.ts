// Cache curto e em memoria: guarda que um numero foi perguntado "resumo por
// categoria ou detalhado por dia?" pra um pedido de gastos de mais de 1 dia,
// e quantos dias era, pra resolver a resposta ("resumo"/"detalhado") na proxima
// mensagem. Mesma ideia de listCache.ts — nao precisa durar muito.
const TTL_MS = 5 * 60 * 1000;

interface PendingChoice {
  days: number;
  createdAt: number;
}

const pending = new Map<string, PendingChoice>();

export function setPendingListChoice(fromNumber: string, days: number) {
  pending.set(fromNumber, { days, createdAt: Date.now() });
}

export function getPendingListChoice(fromNumber: string): PendingChoice | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingListChoice(fromNumber: string) {
  pending.delete(fromNumber);
}
