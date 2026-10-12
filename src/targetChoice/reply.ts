// Interpretacao da resposta a uma lista numerada de candidatos. Funcao pura,
// sem I/O e sem IA: numero escolhe, palavra de cancelamento cancela, qualquer
// outro texto vira uma NOVA busca (refino).
import { classifyConfirmationReply } from "../confirmation/classify";
import { normalizeReply } from "../confirmation/normalize";
import { looksLikeMultipleNumbers, parseChoiceNumber } from "../confirmation/numbers";

// quem importava daqui continua importando (as funcoes moram em confirmation/numbers)
export { looksLikeMultipleNumbers, parseChoiceNumber };

export type TargetReply =
  | { type: "pick"; index: number } // indice 0-based dentro dos candidatos
  | { type: "cancel" }
  | { type: "multiple" } // "1 e 5", "1,2": mais de um numero -- a lista pede um item por vez
  | { type: "refine"; query: string }
  | { type: "invalid" };

const ARTICLES = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das"]);

// remove artigos/preposicoes do inicio ("do remedio" -> "remedio"), preservando
// maiusculas e acentos do resto (a busca de texto, em src/text/search.ts, ignora acento e caixa)
export function stripLeadingArticles(text: string): string {
  const words = text.trim().replace(/[.!?,;:]+$/g, "").split(/\s+/).filter(Boolean);
  while (words.length > 0 && ARTICLES.has(normalizeReply(words[0]))) words.shift();
  return words.join(" ");
}

export function interpretTargetReply(text: string, candidateCount: number): TargetReply {
  const number = parseChoiceNumber(text);
  if (number !== null) {
    if (number >= 1 && number <= candidateCount) return { type: "pick", index: number - 1 };
    // "3" quando 3 nao e uma opcao continua sendo cancelar (mesma regra das confirmacoes)
    if (number === 3) return { type: "cancel" };
    return { type: "invalid" };
  }
  if (classifyConfirmationReply(text) === "cancel") return { type: "cancel" };
  if (looksLikeMultipleNumbers(text)) return { type: "multiple" };
  const query = stripLeadingArticles(text);
  return query ? { type: "refine", query } : { type: "invalid" };
}
