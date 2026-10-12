// Numeros em respostas: digitos e por extenso ("um", "dois", "tres"), com ou sem as palavras
// que vem antes ("opcao 2", "o 1"). Tabela unica usada pelo classificador de confirmacao, pela
// lista de escolha e pelo menu de campos. Funcoes puras; importa so a normalizacao.
import { normalizeReply } from "./normalize";

// chaves ja normalizadas (sem acento): "tres" cobre "três"
export const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

// palavras que podem vir antes do numero: "o 2", "opcao 2", "numero 2", "item 2"
export const NUMBER_PREFIXES = new Set(["o", "a", "opcao", "numero", "item"]);

// uma palavra ou digitos -> numero (null se nao for numero)
export function numberFromToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token) ? NUMBER_WORDS[token] : null;
}

// "o 2", "2.", "2️⃣", "02", "opcao 2", "dois", "Um." -> numero (null se a mensagem inteira nao for so um numero)
export function parseChoiceNumber(text: string): number | null {
  const tokens = normalizeReply(text)
    .split(" ")
    .filter((t) => t && !NUMBER_PREFIXES.has(t));
  if (tokens.length !== 1) return null;
  return numberFromToken(tokens[0]);
}

// "1 e 5", "1,2", "um e dois": so numeros (ou "e"), dois ou mais
export function looksLikeMultipleNumbers(text: string): boolean {
  const tokens = normalizeReply(text).split(" ").filter((t) => t && t !== "e");
  return tokens.length >= 2 && tokens.every((t) => numberFromToken(t) !== null);
}
