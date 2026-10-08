// Interpretacao da resposta ao menu de campos ("1 e 5", "valor pagamento",
// "1,5"). Funcao pura, sem I/O e sem IA. Qualquer item invalido invalida a
// resposta inteira (RN03).
import { FIELD_REGISTRY, FieldDef, MenuKind } from "./registry";

export type FieldSelection = { ok: true; keys: string[] } | { ok: false };

const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };

// no maximo isso de palavras seguidas formam um apelido ("forma de pagamento")
const MAX_ALIAS_WORDS = 4;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[,;+/&]|\be\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFieldSelection(text: string, kind: MenuKind): FieldSelection {
  const fields = FIELD_REGISTRY[kind];
  const byAlias = new Map<string, FieldDef>();
  for (const field of fields) {
    byAlias.set(normalize(field.label), field);
    for (const alias of field.aliases) byAlias.set(normalize(alias), field);
  }

  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length === 0) return { ok: false };

  const picked = new Set<FieldDef>();
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    const number = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (number !== undefined) {
      const field = fields[number - 1];
      if (!field) return { ok: false };
      picked.add(field);
      i++;
      continue;
    }
    let matched = false;
    for (let len = Math.min(MAX_ALIAS_WORDS, words.length - i); len >= 1; len--) {
      const field = byAlias.get(words.slice(i, i + len).join(" "));
      if (field) {
        picked.add(field);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) return { ok: false };
  }
  // ordem do menu, sem repetidos
  return { ok: true, keys: fields.filter((f) => picked.has(f)).map((f) => f.key) };
}
