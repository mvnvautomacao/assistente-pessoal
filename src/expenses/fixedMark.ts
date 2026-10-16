// Marca de "conta fixa" nos gastos (Card 15). Todo gasto nasce NAO fixo (fixed_source = NULL); so vira fixo quando o
// usuario declara ("conta fixa", "gasto fixo"...), quando vem do aviso de conta fixa ou do cron dos gastos fixos.
// Funcoes puras, sem banco.

export type FixedSource = "user" | "bill_alert" | "recurring";

export interface FixedMark {
  source: FixedSource;
  // id do alerta (bill_alert) ou do gasto fixo automatico (recurring); nulo quando o usuario declarou
  refId?: number | null;
}

export const USER_FIXED: FixedMark = { source: "user" };

export const FIXED_LABEL = "conta fixa";

// rotulo curto de uma linha de lista (RN06)
export const FIXED_LIST_SUFFIX = " 🔁";

export function isFixedSource(value: unknown): value is FixedSource {
  return value === "user" || value === "bill_alert" || value === "recurring";
}

// colunas do banco -> marca (null = nao fixo)
export function markFromColumns(source: string | null | undefined, refId: number | null | undefined): FixedMark | null {
  if (!isFixedSource(source)) return null;
  return { source, refId: refId ?? null };
}

// marca -> colunas do banco
export function columnsFromMark(mark: FixedMark | null | undefined): { source: FixedSource | null; refId: number | null } {
  if (!mark) return { source: null, refId: null };
  return { source: mark.source, refId: mark.refId ?? null };
}

// "(conta fixa)" quando o usuario declarou que o gasto e fixo (RN15); gasto avulso nao ganha rotulo
export function fixedConfirmationSuffix(mark: FixedMark | null | undefined): string {
  return mark ? ` (${FIXED_LABEL})` : "";
}

// resposta do usuario sobre o tipo do gasto ("fixo", "conta fixa", "avulso", "nao e fixo"...) -> true (fixo), false (avulso) ou null
const FIXED_YES = new Set(["fixo", "fixa", "conta fixa", "gasto fixo", "despesa fixa", "e fixo", "e fixa", "sim", "s", "true", "e conta fixa"]);
const FIXED_NO = new Set(["avulso", "avulsa", "comum", "nao", "n", "false", "nao e fixo", "nao e fixa", "nao e conta fixa", "nao fixo", "nao fixa", "gasto avulso", "gasto comum", "normal"]);

export function parseFixedAnswer(text: string): boolean | null {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (FIXED_YES.has(normalized)) return true;
  if (FIXED_NO.has(normalized)) return false;
  return null;
}
