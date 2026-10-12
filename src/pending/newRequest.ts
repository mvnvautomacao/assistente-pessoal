// Segunda chance de uma confirmacao aberta (Card 12, D-07): quando o resolvedor NAO entende a
// mensagem, o bot a interpreta com a IA e, se for um pedido novo claro e seguro, troca a
// confirmacao pelo pedido. Funcoes puras, sem I/O: quem chama (router) faz a IA e os envios.
import type { Interpretation } from "../ai/interpret";

// segunda linha de todo "nao entendi" das confirmacoes 1/2/3 e 1/3 (RN06): la o "3" cancela
export const PENDING_EXIT_HINT = "Se quer fazer outra coisa, responde *3* e me manda o pedido de novo.";

// no menu de campos o "3" e um campo (Categoria...), entao a saida e a palavra "cancelar"
export const MENU_EXIT_HINT = "Se quer fazer outra coisa, responde *cancelar* e me manda o pedido de novo.";

// "Nao entendi ..." + a dica de saida
export function withExitHint(text: string, hint: string = PENDING_EXIT_HINT): string {
  return `${text}\n${hint}`;
}

// pedidos de CONSULTA que podem trocar uma confirmacao aberta (RN03): so leem, nunca gravam nada
const QUERY_TYPES = [
  "list_expenses",
  "expense_report",
  "income_report",
  "list_incomes",
  "balance",
  "report",
  "total_last_list",
  "list_budgets",
  "list_categories",
  "list_recurring_expenses",
  "list_bill_alerts",
  "help",
];

// pedidos de REGISTRO que podem trocar uma confirmacao aberta: gravam algo, entao exigem uma frase
// mais completa (uma resposta curta e ambigua como "mercado 40" nao registra nada sozinha)
const CREATE_TYPES = ["expense", "installment_expense", "income", "event", "reminder"];

// nada que abra outra confirmacao (editar, apagar, remover, adiar), mude configuracao (set_*) ou seja desfazer
export const SAFE_NEW_REQUEST_TYPES: ReadonlySet<string> = new Set([...CREATE_TYPES, ...QUERY_TYPES]);

// palavra solta ("pix", "hoje") nunca troca a confirmacao (RN04)
export const MIN_WORDS_FOR_NEW_REQUEST = 2;
// registrar/criar pede 3 palavras ou mais ("gastei 30 no uber"); "mercado 40" nao basta
export const MIN_WORDS_FOR_CREATION = 3;

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

// RN03 + RN04: todos os itens da lista segura (e completos) e a mensagem com palavras suficientes
export function isSafeNewRequest(interpretations: Interpretation[] | null | undefined, text: string): boolean {
  if (!interpretations || interpretations.length === 0) return false;
  const words = countWords(text);
  if (words < MIN_WORDS_FOR_NEW_REQUEST) return false;
  return interpretations.every(
    (i) => SAFE_NEW_REQUEST_TYPES.has(i.type) && hasRequiredFields(i) && (!CREATE_TYPES.includes(i.type) || words >= MIN_WORDS_FOR_CREATION)
  );
}

// o que estava aberto: uma "edit" (alteracao de um item) ou uma "question" (pergunta de apagar etc.)
export type PendingKind = "edit" | "question";

function describePending(label: string | null | undefined, kind: PendingKind): string {
  if (!label) return "a pergunta anterior";
  return kind === "edit" ? `a alteração de "${label}"` : `a pergunta sobre "${label}"`;
}

// RN05: uma linha avisando da troca
export function replacedPendingText(label?: string | null, kind: PendingKind = "edit"): string {
  return `Deixei ${describePending(label, kind)} de lado e entendi seu novo pedido.`;
}

// RN07: "desfaz isso" com confirmacao aberta cancela a confirmacao, sem desfazer a ultima acao
export function undoWithPendingText(label?: string | null, kind: PendingKind = "edit"): string {
  return `Cancelei ${describePending(label, kind)} — nada foi mudado. Se quer desfazer a última ação que já fiz, diga "desfaz isso" de novo.`;
}

// Limite de segundas chances por numero (cada uma e uma chamada da IA): quem fica preso numa
// confirmacao respondendo coisas que o bot nao entende nao gera uma chamada por mensagem.
export const SECOND_CHANCE_MAX_CALLS = 3;
export const SECOND_CHANCE_WINDOW_MS = 10 * 60 * 1000;

export function takeSecondChance(history: number[], now: number): { allowed: boolean; history: number[] } {
  const recent = history.filter((at) => now - at < SECOND_CHANCE_WINDOW_MS);
  if (recent.length >= SECOND_CHANCE_MAX_CALLS) return { allowed: false, history: recent };
  return { allowed: true, history: [...recent, now] };
}
