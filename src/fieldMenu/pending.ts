// Cache curto e em memoria: o usuario escolheu um item pra editar e o bot esta
// no menu guiado ("O que voce quer mudar?") ou perguntando o valor de cada campo
// escolhido. No maximo um menu por numero; mesmo TTL das confirmacoes de edicao.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { FieldValue } from "./validate";
import type { MenuKind } from "./registry";

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

const pending = new Map<string, PendingFieldMenu>();

export function setPendingFieldMenu(fromNumber: string, data: Omit<PendingFieldMenu, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingFieldMenu(fromNumber: string): PendingFieldMenu | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > EDIT_PENDING_TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingFieldMenu(fromNumber: string) {
  pending.delete(fromNumber);
}
