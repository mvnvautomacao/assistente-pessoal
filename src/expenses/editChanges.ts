// Mudancas pedidas na edicao de um gasto: normalizacao e agrupamento. Funcoes
// puras -- a IA devolve ou a lista nova "changes" ou o par antigo field/value, e
// tudo daqui pra frente so enxerga a lista.

export const EXPENSE_EDIT_FIELDS = ["amount", "date", "description", "payment_method", "category"] as const;
export type ExpenseEditField = (typeof EXPENSE_EDIT_FIELDS)[number];

export interface RawChange {
  field: ExpenseEditField;
  value: string;
}

// limites (RN01 / RN07): ate 5 mudancas por gasto (so existem 5 campos) e ate 5
// gastos por confirmacao
export const MAX_EDIT_CHANGES = 5;
export const MAX_EDIT_BATCH = 5;

export const EXPENSE_FIELD_LABEL: Record<ExpenseEditField, string> = {
  amount: "Valor",
  date: "Data",
  description: "Nome",
  payment_method: "Pagamento",
  category: "Categoria",
};

export function isExpenseEditField(value: unknown): value is ExpenseEditField {
  return typeof value === "string" && (EXPENSE_EDIT_FIELDS as readonly string[]).includes(value);
}

// junta listas de mudancas: campo repetido vale o ultimo valor (a posicao e a da
// primeira aparicao do campo)
export function mergeRawChanges(...lists: RawChange[][]): RawChange[] {
  const byField = new Map<ExpenseEditField, string>();
  for (const list of lists) for (const change of list) byField.set(change.field, change.value);
  return Array.from(byField, ([field, value]) => ({ field, value })).slice(0, MAX_EDIT_CHANGES);
}

// ponto unico de normalizacao (RF02): "changes" tem prioridade; sem ele, usa o
// par antigo field/value. Descarta campo desconhecido e valor vazio.
export function normalizeExpenseChanges(input: {
  changes?: { field?: unknown; value?: unknown }[];
  field?: unknown;
  value?: unknown;
}): RawChange[] {
  const candidates = Array.isArray(input.changes) && input.changes.length > 0 ? input.changes : [{ field: input.field, value: input.value }];
  const valid: RawChange[] = [];
  for (const c of candidates) {
    if (!isExpenseEditField(c.field)) continue;
    const value = c.value === undefined || c.value === null ? "" : String(c.value).trim();
    if (value) valid.push({ field: c.field, value });
  }
  return mergeRawChanges(valid);
}
