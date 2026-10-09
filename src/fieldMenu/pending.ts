// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): o usuario escolheu um item pra editar e o bot esta
// no menu guiado ("O que voce quer mudar?") ou perguntando o valor de cada campo
// escolhido. No maximo um menu por numero; mesmo TTL das confirmacoes de edicao.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { FieldValue } from "./validate";
import type { MenuKind } from "./registry";
import { clearPending, getPending, setPending } from "../pending/store";

export interface PendingFieldMenu {
  kind: MenuKind;
  itemId: number;
  header: string; // 1a linha do menu, tambem usada nas mensagens ("Mercado — R$ 38,00 · 07/10 · Pix")
  label: string; // nome curto do item (avisos de cancelamento)
  stage: "choose_fields" | "ask_value";
  queue: string[]; // campos escolhidos, na ordem do menu
  step: number; // indice em "queue" do campo sendo perguntado
  collected: Record<string, FieldValue>;
  choices: string[]; // opcoes numeradas da pergunta atual (categoria / forma de pagamento)
  createdAt: number;
}

const KIND = "field_menu";
const VERSION = 1;

export function setPendingFieldMenu(fromNumber: string, data: Omit<PendingFieldMenu, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.label, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingFieldMenu(fromNumber: string): PendingFieldMenu | null {
  const stored = getPending<Omit<PendingFieldMenu, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingFieldMenu(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
