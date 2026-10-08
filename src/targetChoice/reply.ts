// Interpretacao da resposta a uma lista numerada de candidatos. Funcao pura,
// sem I/O e sem IA: numero escolhe, palavra de cancelamento cancela, qualquer
// outro texto vira uma NOVA busca (refino).
import { classifyConfirmationReply, normalizeReply } from "../confirmation/classify";

export type TargetReply =
  | { type: "pick"; index: number } // indice 0-based dentro dos candidatos
  | { type: "cancel" }
  | { type: "multiple" } // "1 e 5", "1,2": mais de um numero -- a lista pede um item por vez
  | { type: "refine"; query: string }
  | { type: "invalid" };

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
};

// palavras que podem vir antes do numero: "o 2", "opcao 2", "numero 2", "item 2"
const NUMBER_PREFIXES = new Set(["o", "a", "opcao", "numero", "item"]);

const ARTICLES = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das"]);

// "o 2", "2.", "2️⃣", "02", "opcao 2", "dois" -> 2 (null se nao for um numero)
export function parseChoiceNumber(text: string): number | null {
  const tokens = normalizeReply(text)
    .split(" ")
    .filter((t) => t && !NUMBER_PREFIXES.has(t));
  if (tokens.length !== 1) return null;
  const token = tokens[0];
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

// remove artigos/preposicoes do inicio ("do remedio" -> "remedio"), preservando
// maiusculas e acentos do resto (a busca por LIKE no banco e sensivel a acento)
export function stripLeadingArticles(text: string): string {
  const words = text.trim().replace(/[.!?,;:]+$/g, "").split(/\s+/).filter(Boolean);
  while (words.length > 0 && ARTICLES.has(normalizeReply(words[0]))) words.shift();
  return words.join(" ");
}

// "1 e 5", "1,2", "um e dois": so numeros (ou "e"), dois ou mais
export function looksLikeMultipleNumbers(text: string): boolean {
  const tokens = normalizeReply(text).split(" ").filter((t) => t && t !== "e");
  return tokens.length >= 2 && tokens.every((t) => /^\d+$/.test(t) || t in NUMBER_WORDS);
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
