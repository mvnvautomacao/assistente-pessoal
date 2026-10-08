// Cache curto e em memoria: guarda quais entradas foram mostradas na ultima
// resposta de "list_incomes" pra cada numero, pra "muda o valor do 2" saber a
// quem se refere. Mesma ideia de expenses/listCache.ts -- e uma lista invalida a
// outra: o numero sempre vale para a ULTIMA lista mostrada (gastos ou entradas).
import { clearLastShownExpenses } from "../expenses/listCache";

const TTL_MS = 10 * 60 * 1000;

interface CachedList {
  ids: number[];
  label?: string;
  createdAt: number;
}

const cache = new Map<string, CachedList>();

export function setLastShownIncomes(fromNumber: string, ids: number[], label?: string) {
  clearLastShownExpenses(fromNumber);
  cache.set(fromNumber, { ids, label, createdAt: Date.now() });
}

export function getLastShownIncomes(fromNumber: string): number[] | null {
  const entry = cache.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(fromNumber);
    return null;
  }
  return entry.ids;
}

export function clearLastShownIncomes(fromNumber: string) {
  cache.delete(fromNumber);
}
