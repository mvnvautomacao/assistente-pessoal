// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer mudar o evento X?" antes de aplicar de verdade. Mesma ideia dos outros
// caches de conversa (pendingDeletion.ts etc). O que muda de fato (Quando,
// Termino, Nome, Local, Aviso) e calculado de previous x proposed (ver editPlan.ts).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { EndSpec, EventChangeKey, EventSnapshot } from "./editPlan";
import { clearPending, getPending, setPending } from "../pending/store";
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

const KIND = "edit_event";
const VERSION = 1;

export function setPendingEditEvent(fromNumber: string, data: Omit<PendingEditEvent, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.title, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditEvent(fromNumber: string): PendingEditEvent | null {
  const stored = getPending<Omit<PendingEditEvent, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEditEvent(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
