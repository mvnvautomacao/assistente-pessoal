// Cache curto e em memoria: guarda que um numero foi perguntado "confirma essas
// alteracoes?" antes de editar uma entrada de verdade, pra resolver a resposta
// (1/2/3, sim/nao ou uma correcao) na proxima mensagem. Espelha
// expenses/pendingEditExpense.ts, so que sempre com UMA entrada e ate 3 mudancas.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { normalizeExpenseChanges } from "../expenses/editChanges";

export const INCOME_EDIT_FIELDS = ["amount", "description", "date"] as const;
export type IncomeEditField = (typeof INCOME_EDIT_FIELDS)[number];

export const INCOME_FIELD_LABEL: Record<IncomeEditField, string> = {
  amount: "Valor",
  description: "Descrição",
  date: "Data",
};

export interface IncomeRawChange {
  field: IncomeEditField;
  value: string;
}

// mesma normalizacao do gasto (changes tem prioridade, depois field/value antigo,
// ultimo valor de um campo repetido vale), so que descartando categoria e pagamento
export function normalizeIncomeChanges(input: { changes?: { field?: unknown; value?: unknown }[]; field?: unknown; value?: unknown }): IncomeRawChange[] {
  return normalizeExpenseChanges(input).filter((c): c is IncomeRawChange => (INCOME_EDIT_FIELDS as readonly string[]).includes(c.field));
}

export interface IncomeParams {
  amount: number;
  description: string;
  date: string;
}

export interface IncomeChangeView {
  field: IncomeEditField;
  label: string;
  from: string;
  to: string;
}

export interface PendingEditIncome {
  incomeId: number;
  description: string; // nome atual da entrada (mensagens)
  headerText: string; // "Salário — R$ 3.000,00 · 05/09", fixa durante a confirmacao
  previous: IncomeParams; // instantaneo da entrada quando a previa foi criada (RN09)
  proposed: IncomeParams;
  rawChanges: IncomeRawChange[]; // o que o usuario pediu (ja sem o que nao muda nada)
  views: IncomeChangeView[];
  awaitingCorrection: boolean;
  // com mais de uma mudanca a opcao 2 primeiro pergunta QUAL corrigir ("pick")
  correctionStage: "pick" | "value";
  correctionTarget: IncomeEditField | null;
  createdAt: number;
}

const pending = new Map<string, PendingEditIncome>();

export function setPendingEditIncome(fromNumber: string, data: Omit<PendingEditIncome, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingEditIncome(fromNumber: string): PendingEditIncome | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > EDIT_PENDING_TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEditIncome(fromNumber: string) {
  pending.delete(fromNumber);
}
