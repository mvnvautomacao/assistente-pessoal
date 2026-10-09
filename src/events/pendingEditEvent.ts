// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar o evento X?" antes de aplicar de verdade. Mesma ideia dos outros
// caches de conversa (pendingDeletion.ts etc). O que muda de fato (Quando,
// Termino, Nome, Local, Aviso) e calculado de previous x proposed (ver editPlan.ts).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { EndSpec, EventChangeKey, EventSnapshot } from "./editPlan";
const TTL_MS = EDIT_PENDING_TTL_MS;

export interface PendingEditEvent {
  eventId: number;
  title: string; // titulo ATUAL (antes dessa edicao) -- usado nas mensagens de confirmacao
  previous: EventSnapshot;
  proposed: EventSnapshot;
  // o que o usuario pediu sobre o termino (horario final OU duracao); null = a duracao
  // original acompanha o inicio. Guardado pra a correcao do inicio recalcular o termino.
  endSpec: EndSpec | null;
  changeText: string;
  awaitingCorrection: boolean;
  // com mais de uma mudanca a opcao 2 primeiro pergunta QUAL corrigir ("pick");
  // com uma so, vai direto ao novo valor ("value") -- igual ao gasto
  correctionStage: "pick" | "value";
  correctionTarget: EventChangeKey | null;
  headerText: string; // 1a linha da previa, fixa durante a confirmacao
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
