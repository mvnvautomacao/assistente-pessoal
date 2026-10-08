// Cache curto e em memoria: o usuario mandou so "editar" (sem dizer o que) e o
// bot perguntou o que ele quer editar. A proxima resposta escolhe o alvo.
// Mesma ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, number>();

export function setPendingEditTarget(fromNumber: string) {
  pending.set(fromNumber, Date.now());
}

export function getPendingEditTarget(fromNumber: string): boolean {
  const createdAt = pending.get(fromNumber);
  if (createdAt === undefined) return false;
  if (Date.now() - createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return false;
  }
  return true;
}

export function clearPendingEditTarget(fromNumber: string) {
  pending.delete(fromNumber);
}
