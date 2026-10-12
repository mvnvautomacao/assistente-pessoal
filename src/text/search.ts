// Busca por texto sem acento, sem diferenciar caixa e sem curingas. Funcoes puras, sem banco:
// os servicos trazem as linhas candidatas (ja filtradas por numero e janela de tempo) e o
// filtro de texto roda aqui, porque o LIKE do SQLite so ignora maiusculas ASCII e trata % e _
// como curingas. Mesmo criterio de normalizacao dos gastos, entradas e gastos fixos.

// teto de resultados devolvidos por busca (aplicado DEPOIS do filtro de texto)
export const MAX_SEARCH_RESULTS = 10;

// teto de linhas varridas em memoria por busca
export const SEARCH_SCAN_LIMIT = 500;

// artigos e preposicoes: ignorados na consulta, a menos que sejam as unicas palavras
const STOP_WORDS = new Set(["o", "a", "os", "as", "do", "da", "de", "dos", "das"]);

// sem acentos (NFD), minusculas; pontuacao, simbolos, emoji e espacos (inclusive NBSP) viram
// um espaco so; sem espacos nas pontas. "%" e "_" sao simbolos comuns, nunca curingas.
export function normalizeSearch(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// verdadeiro quando TODAS as palavras da consulta aparecem no texto (qualquer ordem, como
// pedaco de palavra). Consulta vazia = sem filtro. Consulta so de simbolos ("%") compara o
// texto literal, pra nao virar "casa com tudo".
export function matchesQuery(text: string | null | undefined, query: string | null | undefined): boolean {
  const raw = (query ?? "").trim();
  if (!raw) return true;
  let words = normalizeSearch(raw).split(" ").filter(Boolean);
  if (words.length === 0) return (text ?? "").toLowerCase().includes(raw.toLowerCase());
  const significant = words.filter((w) => !STOP_WORDS.has(w));
  if (significant.length > 0) words = significant;
  const haystack = normalizeSearch(text);
  return words.every((w) => haystack.includes(w));
}

// filtra as linhas pelo texto, preservando a ordem; varre no maximo SEARCH_SCAN_LIMIT e
// devolve no maximo "limit" (o limite vale DEPOIS do filtro)
export function filterByQuery<T>(rows: T[], getText: (row: T) => string | null | undefined, query: string | null | undefined, limit: number): T[] {
  const out: T[] = [];
  const scan = Math.min(rows.length, SEARCH_SCAN_LIMIT);
  for (let i = 0; i < scan && out.length < limit; i++) {
    if (matchesQuery(getText(rows[i]), query)) out.push(rows[i]);
  }
  return out;
}
