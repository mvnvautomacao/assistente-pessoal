// Monta a previa de edicao de UMA entrada: valida cada mudanca pedida (valor,
// descricao, data) e calcula o "antes -> depois". NADA e gravado aqui.
import { expenseHeader, formatBRL, formatShortDate } from "../confirmation/preview";
import { validateAmountAnswer, validateDateAnswer, validateTextAnswer } from "../fieldMenu/validate";
import { spDateString } from "../timeSP";
import {
  INCOME_FIELD_LABEL,
  IncomeChangeView,
  IncomeParams,
  IncomeRawChange,
} from "./pendingEditIncome";

export type BuildIncomeEditResult =
  | { ok: true; proposed: IncomeParams; rawChanges: IncomeRawChange[]; views: IncomeChangeView[] }
  | { ok: false; error: string };

export function incomeHeader(params: IncomeParams): string {
  return expenseHeader({ description: params.description, amount: params.amount, date: params.date });
}

// mesma regra de validacao do gasto: se qualquer mudanca for invalida, nada vira previa
export async function buildIncomeEditItem(
  previous: IncomeParams,
  rawChanges: IncomeRawChange[],
  today: string = spDateString()
): Promise<BuildIncomeEditResult> {
  const proposed: IncomeParams = { ...previous };
  const views: IncomeChangeView[] = [];
  const kept: IncomeRawChange[] = [];

  for (const change of rawChanges) {
    const label = INCOME_FIELD_LABEL[change.field];
    if (change.field === "amount") {
      const answer = validateAmountAnswer(change.value);
      if (!answer.ok) return answer;
      const value = answer.value as number;
      if (value === previous.amount) continue;
      proposed.amount = value;
      views.push({ field: "amount", label, from: formatBRL(previous.amount), to: formatBRL(value) });
    } else if (change.field === "date") {
      const answer = await validateDateAnswer(change.value, today);
      if (!answer.ok) return answer;
      const value = answer.value as string;
      if (value === previous.date) continue;
      proposed.date = value;
      views.push({ field: "date", label, from: formatShortDate(previous.date), to: formatShortDate(value) });
    } else {
      const answer = validateTextAnswer(change.value);
      if (!answer.ok) return answer;
      const value = answer.value as string;
      if (value === previous.description) continue;
      proposed.description = value;
      views.push({ field: "description", label, from: previous.description, to: value });
    }
    kept.push(change);
  }
  return { ok: true, proposed, rawChanges: kept, views };
}
