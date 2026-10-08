// Mensagens de entrada (receita) pelo WhatsApp: lista, prévia de edição, sucesso
// e confirmação de exclusão. Funções puras.
import type { IncomeChangeView, IncomeEditField } from "../incomes/pendingEditIncome";
import { formatBRL, formatShortDate, formatEditPreview } from "./preview";
import { CorrectionOption } from "./expensePreview";

export interface IncomeListItem {
  description: string;
  amount: number;
  date: string;
}

// "Salário — R$ 3.000,00 · 05/09"
export function incomeLine(income: IncomeListItem): string {
  return `${income.description} — ${formatBRL(income.amount)} · ${formatShortDate(income.date)}`;
}

export const MAX_INCOME_LIST = 20;

// lista numerada do periodo, com o total do PERIODO inteiro (mesmo se so as 20 mais recentes aparecem)
export function formatIncomeList(params: { label: string; items: IncomeListItem[]; total: number; totalCount: number; dashboardUrl: string }): string {
  const { label, items, total, totalCount, dashboardUrl } = params;
  const lines = items.map((item, idx) => `${idx + 1}. ${incomeLine(item)}`).join("\n");
  const more = totalCount > items.length ? `\nMostrando as ${items.length} mais recentes. Veja todas no painel: ${dashboardUrl}\n` : "";
  return `💵 Entradas — ${label}\n\n${lines}\n${more}\n💰 Total: ${formatBRL(total)}\n\nPra editar ou apagar, é só dizer, ex: "muda o valor do 2 pra 850" ou "apaga o 2".`;
}

export function formatIncomeEditPreview(headerText: string, views: IncomeChangeView[]): string {
  return formatEditPreview(headerText, views);
}

export function incomeCorrectionOptions(views: IncomeChangeView[]): CorrectionOption[] {
  return views.map((v) => ({ itemIndex: 0, field: v.field, label: v.label }));
}

const SUCCESS_PREFIX: Record<IncomeEditField, string> = { amount: "valor", description: "descrição", date: "data" };

export function formatIncomeEditSuccess(description: string, views: IncomeChangeView[]): string {
  return `✏️ Entrada "${description}" atualizada: ${views.map((v) => `${SUCCESS_PREFIX[v.field]} ${v.to}`).join("; ")}.`;
}

export function formatIncomeDeletePrompt(header: string): string {
  return `🗑️ Vou apagar a entrada: ${header}\n\n1 ✅ Apagar\n3 ❌ Cancelar`;
}

export const INCOME_DELETE_NOT_UNDERSTOOD = "Não entendi 🤔 Responde *1* pra apagar ou *3* pra cancelar.";

export function incomeDeletedText(description: string): string {
  return `🗑️ Entrada "${description}" apagada.`;
}

export const INCOME_GONE_TEXT = "Essa entrada não existe mais.";

export function incomeChangedText(description: string, currentAmount: number): string {
  return `A entrada "${description}" mudou enquanto a gente conversava (agora está ${formatBRL(currentAmount)}). Me pede de novo.`;
}
