// Cache curto e em memoria: guarda quais gastos foram mostrados na ultima resposta
// de "list_expenses" pra cada numero, pra "edita o 2" saber a quem se refere.
// Nao precisa sobreviver a um restart nem durar muito — se o numero mandar qualquer
// outra coisa no meio, o router invalida (ver handleInterpretation).
const TTL_MS = 10 * 60 * 1000;

interface CachedList {
  ids: number[];
  createdAt: number;
}

const cache = new Map<string, CachedList>();

export function setLastShownExpenses(fromNumber: string, ids: number[]) {
  cache.set(fromNumber, { ids, createdAt: Date.now() });
}

export function getLastShownExpenses(fromNumber: string): number[] | null {
  const entry = cache.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(fromNumber);
    return null;
  }
  return entry.ids;
}

export function clearLastShownExpenses(fromNumber: string) {
  cache.delete(fromNumber);
}
