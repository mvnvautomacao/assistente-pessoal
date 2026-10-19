// "Ultima lista mostrada" de cada numero (Card 20): gastos, entradas OU agenda -- UMA so por vez. O numero que o usuario manda depois
// ("edita o 2", "cancela o 3") sempre vale para a ULTIMA lista mostrada; guardar uma invalida as outras. Cache curto e em memoria
// (10 min, perde no reinicio -- mesma limitacao documentada das listas de gastos). As fachadas expenses/listCache.ts e
// incomes/listCache.ts continuam com as funcoes de sempre, so que em cima deste modulo.

const TTL_MS = 10 * 60 * 1000;

// item numerado da agenda: eventos e lembretes na ordem em que foram mostrados
export interface AgendaShownItem {
  kind: "event" | "reminder";
  id: number;
}

export type ShownList =
  | { kind: "expense"; ids: number[]; label?: string }
  | { kind: "income"; ids: number[]; label?: string }
  | { kind: "agenda"; items: AgendaShownItem[] };

export type ShownListKind = ShownList["kind"];

const cache = new Map<string, { list: ShownList; createdAt: number }>();

export function setLastShown(fromNumber: string, list: ShownList) {
  cache.set(fromNumber, { list, createdAt: Date.now() });
}

export function getLastShown(fromNumber: string): ShownList | null {
  const entry = cache.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(fromNumber);
    return null;
  }
  return entry.list;
}

// sem "kind" limpa qualquer lista; com "kind" so limpa se a ultima lista for desse tipo (nao apaga a de outro tipo)
export function clearLastShown(fromNumber: string, kind?: ShownListKind) {
  if (kind && cache.get(fromNumber)?.list.kind !== kind) return;
  cache.delete(fromNumber);
}

export function setLastShownAgenda(fromNumber: string, items: AgendaShownItem[]) {
  setLastShown(fromNumber, { kind: "agenda", items });
}

export function getLastShownAgenda(fromNumber: string): AgendaShownItem[] | null {
  const list = getLastShown(fromNumber);
  return list && list.kind === "agenda" ? list.items : null;
}

export function clearLastShownAgenda(fromNumber: string) {
  clearLastShown(fromNumber, "agenda");
}
