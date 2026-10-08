// Mensagens da confirmacao de edicao de gasto(s): previa de um gasto, previa de
// lote, seletor de "qual corrigir" e mensagem de sucesso. Funcoes puras.
import type { ExpenseChangeView, ExpenseEditItem } from "../expenses/pendingEditExpense";
import type { ExpenseEditField } from "../expenses/editChanges";
import { PREVIEW_OPTIONS } from "./preview";

export function viewLine(view: ExpenseChangeView): string {
  return `${view.label}: ${view.from} → ${view.to}${view.isNew ? " (nova)" : ""}`;
}

// 1 gasto: cabecalho + uma linha por mudanca. 2+ gastos: lista numerada de alteracoes.
export function formatExpenseEditPreview(items: ExpenseEditItem[]): string {
  if (items.length === 1) {
    const item = items[0];
    return `✏️ ${item.headerText}\n${item.views.map(viewLine).join("\n")}\n\n${PREVIEW_OPTIONS}`;
  }
  const lines = items.map((item, idx) => `${idx + 1}. ${item.description} — ${item.views.map(viewLine).join("; ")}`);
  return `✏️ Vou fazer ${items.length} alterações:\n${lines.join("\n")}\n\n1 ✅ Confirmar tudo\n2 ✏️ Corrigir\n3 ❌ Cancelar`;
}

export interface CorrectionOption {
  itemIndex: number;
  field: ExpenseEditField;
  label: string;
}

// todas as mudancas corrigiveis, na ordem em que aparecem na previa
export function correctionOptions(items: ExpenseEditItem[]): CorrectionOption[] {
  const options: CorrectionOption[] = [];
  items.forEach((item, itemIndex) => {
    for (const view of item.views) {
      options.push({ itemIndex, field: view.field, label: items.length > 1 ? `${item.description} — ${view.label}` : view.label });
    }
  });
  return options;
}

export function formatCorrectionPicker(options: CorrectionOption[]): string {
  return `Qual você quer corrigir?\n${options.map((o, idx) => `${idx + 1} ${o.label}`).join("\n")}\n\nOu responde *cancelar*.`;
}

const SUCCESS_PREFIX: Record<ExpenseEditField, string> = {
  amount: "valor",
  date: "data",
  description: "nome",
  payment_method: "pagamento",
  category: "categoria",
};

export function formatExpenseEditSuccess(items: ExpenseEditItem[]): string {
  if (items.length > 1) return `✏️ ${items.length} gastos atualizados.`;
  const item = items[0];
  return `✏️ "${item.description}" atualizado: ${item.views.map((v) => `${SUCCESS_PREFIX[v.field]} ${v.to}`).join("; ")}.`;
}
