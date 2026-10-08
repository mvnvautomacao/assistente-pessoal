// Monta UM item de edicao de gasto: valida cada mudanca pedida (valor, data,
// nome, forma de pagamento, categoria) e calcula o "antes -> depois". NADA e
// gravado aqui -- categoria e forma de pagamento que ainda nao existem so sao
// marcadas como "nova" e criadas na confirmacao (ver router.ts).
import { extractDateTimeFromAnswer } from "../ai/interpret";
import { expenseHeader, formatBRL, formatShortDate } from "../confirmation/preview";
import { parseBrazilianAmountDetailed } from "../confirmation/parsers";
import { validateAmount } from "../validation";
import { spDateString } from "../timeSP";
import { EXPENSE_FIELD_LABEL, RawChange } from "./editChanges";
import { parseExpenseDate, validateExpenseDate, invalidDateMessage, DateParse } from "./parseDate";
import { EditExpenseParams, ExpenseChangeView, ExpenseEditItem } from "./pendingEditExpense";
import { findCategoryByName, findPaymentMethodByName, getCategoryById, getPaymentMethodById } from "./service";

export type BuildEditItemResult = { item: ExpenseEditItem } | { error: string };

const clean = (text: string) => text.trim().replace(/\s+/g, " ");

function paymentMethodName(from: string, id: number | null): string | null {
  return id !== null ? (getPaymentMethodById(from, id)?.name ?? null) : null;
}

export function headerFor(from: string, params: EditExpenseParams): string {
  return expenseHeader({
    description: params.description,
    amount: params.amount,
    date: params.date,
    paymentMethodName: paymentMethodName(from, params.paymentMethodId),
  });
}

export async function resolveDate(value: string, today: string): Promise<DateParse> {
  const parsed = parseExpenseDate(value, today);
  if (parsed.ok || parsed.reason !== "unrecognized") return parsed;
  // nenhum formato comum casou: ultima tentativa com a IA ja usada nos eventos
  try {
    const extracted = await extractDateTimeFromAnswer(value);
    return extracted?.newDate ? validateExpenseDate(extracted.newDate, today) : parsed;
  } catch {
    return parsed;
  }
}

export async function buildExpenseEditItem(
  from: string,
  expenseId: number,
  previous: EditExpenseParams,
  rawChanges: RawChange[],
  today: string = spDateString()
): Promise<BuildEditItemResult> {
  const proposed: EditExpenseParams = { ...previous };
  const views: ExpenseChangeView[] = [];
  const kept: RawChange[] = [];
  let newCategoryName: string | null = null;
  let newPaymentMethodName: string | null = null;

  for (const change of rawChanges) {
    const value = clean(change.value);
    const label = EXPENSE_FIELD_LABEL[change.field];

    if (change.field === "amount") {
      const parsed = parseBrazilianAmountDetailed(value);
      if (!parsed.ok) return { error: parsed.reason === "not_positive" ? "O valor precisa ser maior que R$ 0,00." : `Não entendi o valor "${value}".` };
      const check = validateAmount(parsed.value);
      if (!check.ok) return { error: check.message };
      if (parsed.value === previous.amount) continue;
      proposed.amount = parsed.value;
      views.push({ field: "amount", label, from: formatBRL(previous.amount), to: formatBRL(parsed.value), isNew: false });
    } else if (change.field === "date") {
      const parsed = await resolveDate(value, today);
      if (!parsed.ok) {
        return { error: parsed.reason === "unrecognized" ? `Não entendi a data "${value}". Me manda o dia, ex: 15/10 ou ontem.` : invalidDateMessage(parsed.shown) };
      }
      if (parsed.date === previous.date) continue;
      proposed.date = parsed.date;
      views.push({ field: "date", label, from: formatShortDate(previous.date), to: formatShortDate(parsed.date), isNew: false });
    } else if (change.field === "description") {
      if (value === previous.description) continue;
      proposed.description = value;
      views.push({ field: "description", label, from: previous.description, to: value, isNew: false });
    } else if (change.field === "payment_method") {
      const found = findPaymentMethodByName(from, value);
      if (found && found.id === previous.paymentMethodId) continue;
      const fromName = paymentMethodName(from, previous.paymentMethodId) ?? "—";
      if (found) {
        proposed.paymentMethodId = found.id;
        views.push({ field: "payment_method", label, from: fromName, to: found.name, isNew: false });
      } else {
        newPaymentMethodName = value;
        proposed.paymentMethodId = null;
        views.push({ field: "payment_method", label, from: fromName, to: value, isNew: true });
      }
    } else {
      const found = findCategoryByName(from, value);
      if (found && found.id === previous.categoryId) continue;
      const fromName = (previous.categoryId !== null ? getCategoryById(from, previous.categoryId)?.name : null) ?? "sem categoria";
      if (found) {
        proposed.categoryId = found.id;
        views.push({ field: "category", label, from: fromName, to: found.name, isNew: false });
      } else {
        newCategoryName = value;
        proposed.categoryId = null;
        views.push({ field: "category", label, from: fromName, to: value, isNew: true });
      }
    }
    kept.push(change);
  }

  return {
    item: {
      expenseId,
      description: previous.description,
      headerText: headerFor(from, previous),
      previous,
      proposed,
      rawChanges: kept,
      newCategoryName,
      newPaymentMethodName,
      views,
    },
  };
}
