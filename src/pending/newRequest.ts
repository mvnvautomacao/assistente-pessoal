// Segunda chance de uma confirmacao aberta (Card 12, D-07): quando o resolvedor NAO entende a
// mensagem, o bot a interpreta com a IA e, se for um pedido novo claro e seguro, troca a
// confirmacao pelo pedido. Funcoes puras, sem I/O: quem chama (router) faz a IA e os envios.
import type { Interpretation } from "../ai/interpret";

// segunda linha de todo "nao entendi" das confirmacoes (RN06)
export const PENDING_EXIT_HINT = "Se quer fazer outra coisa, responde *3* e me manda o pedido de novo.";

// "Nao entendi ..." + a dica de saida
export function withExitHint(text: string): string {
  return `${text}\n${PENDING_EXIT_HINT}`;
}

// pedidos que podem trocar uma confirmacao aberta (RN03): registrar, criar e consultar. Nada que
// abra outra confirmacao (editar, apagar, remover, adiar), mude configuracao (set_*) ou seja desfazer.
// "list_reminders" nao e um tipo hoje; fica na lista pra valer se a IA passar a devolve-lo.
export const SAFE_NEW_REQUEST_TYPES: ReadonlySet<string> = new Set([
  "expense",
  "installment_expense",
  "income",
  "event",
  "reminder",
  "list_expenses",
  "expense_report",
  "income_report",
  "list_incomes",
  "balance",
  "report",
  "list_reminders",
  "total_last_list",
  "list_budgets",
  "list_categories",
  "list_recurring_expenses",
  "list_bill_alerts",
  "help",
]);

// palavra solta ("pix", "hoje") nunca troca a confirmacao (RN04)
export const MIN_WORDS_FOR_NEW_REQUEST = 2;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const filled = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";

// o pedido tem o minimo que o fluxo normal precisa pra atender sem perguntar de novo
function hasRequiredFields(interpretation: Interpretation): boolean {
  switch (interpretation.type) {
    case "expense":
      return Number.isFinite(interpretation.amount) && interpretation.amount > 0 && filled(interpretation.description);
    case "event":
      return filled(interpretation.title) && filled(interpretation.start);
    case "reminder":
      return filled(interpretation.message) && filled(interpretation.due_at);
    default:
      return true;
  }
}

// RN03 + RN04: todos os itens da lista segura (e completos) e a mensagem com 2+ palavras
export function isSafeNewRequest(interpretations: Interpretation[] | null | undefined, text: string): boolean {
  if (!interpretations || interpretations.length === 0) return false;
  if (countWords(text) < MIN_WORDS_FOR_NEW_REQUEST) return false;
  return interpretations.every((i) => SAFE_NEW_REQUEST_TYPES.has(i.type) && hasRequiredFields(i));
}

// RN05: uma linha avisando da troca
export function replacedPendingText(label?: string | null): string {
  return label
    ? `Deixei a alteração de "${label}" de lado e entendi seu novo pedido.`
    : "Deixei a pergunta anterior de lado e entendi seu novo pedido.";
}

// RN07: "desfaz isso" com confirmacao aberta cancela a confirmacao, sem desfazer a ultima acao
export function undoWithPendingText(label?: string | null): string {
  const what = label ? `a alteração de "${label}"` : "a pergunta anterior";
  return `Cancelei ${what} — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.`;
}
