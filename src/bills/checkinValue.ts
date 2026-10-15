// Etapa "quanto foi?" do aviso de conta fixa (Card 15, RN01). Puro, sem banco. Nesta etapa 1, 2 e 3 NAO sao opcoes:
// qualquer numero e o valor. Respostas validas: um valor (120, 120,50, R$ 1.250,90, "cento e vinte"), "igual" (repete
// o ultimo valor lancado por este alerta) ou "pular" (so marca como feito, sem gasto).
import { parseBrazilianAmountDetailed } from "../confirmation/parsers";
import { normalizeReply } from "../confirmation/normalize";
import { formatBRL } from "../confirmation/preview";

export type BillValueReply =
  | { kind: "amount"; amount: number }
  | { kind: "same" }
  | { kind: "skip" }
  | { kind: "invalid"; problem: string } // parece valor, mas nao serve (zero, negativo)
  | { kind: "other" }; // nao e valor: pedido novo ou texto que nao entendi

export const BILL_VALUE_POSITIVE_TEXT = "O valor precisa ser maior que R$ 0,00.";

const SAME_PHRASES = new Set(["igual", "o mesmo", "mesmo", "mesmo valor", "igual ao anterior", "igual a ultima", "igual da ultima", "igual ao ultimo", "o mesmo valor", "repete"]);
const SKIP_PHRASES = new Set(["pular", "pula", "pulei", "pula essa", "pular essa", "so marcar", "so marca"]);

const UNITS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
};

// "cento e vinte" -> 120, "dois mil e quinhentos" -> 2500 (null se tiver qualquer palavra que nao seja numero)
export function parseSpokenNumber(text: string): number | null {
  const tokens = normalizeReply(text).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const token of tokens) {
    if (token === "e") continue;
    if (token === "mil") {
      total += (current || 1) * 1000;
      current = 0;
      sawNumber = true;
      continue;
    }
    if (token in UNITS) {
      current += UNITS[token];
      sawNumber = true;
      continue;
    }
    return null;
  }
  return sawNumber ? total + current : null;
}

export function interpretBillValueReply(text: string): BillValueReply {
  const normalized = normalizeReply(text);
  if (!normalized) return { kind: "other" };
  if (SAME_PHRASES.has(normalized)) return { kind: "same" };
  if (SKIP_PHRASES.has(normalized)) return { kind: "skip" };

  // "R$ 120", "120 reais", "120,50", "1.250,90"
  const cleaned = text
    .replace(/r\$/gi, " ")
    .replace(/\b(reais|real|conto|contos)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = parseBrazilianAmountDetailed(cleaned);
  if (parsed.ok) return { kind: "amount", amount: parsed.value };
  if (parsed.reason === "not_positive") return { kind: "invalid", problem: BILL_VALUE_POSITIVE_TEXT };

  const spoken = parseSpokenNumber(cleaned);
  if (spoken !== null) return spoken > 0 ? { kind: "amount", amount: spoken } : { kind: "invalid", problem: BILL_VALUE_POSITIVE_TEXT };
  return { kind: "other" };
}

// "Boa! Quanto foi *Conta de água*? ..." (com o ultimo valor, se houver)
export function billValueQuestion(name: string, lastAmount: number | null): string {
  const head = `Boa! Quanto foi *${name}*? (ex: 120 ou 120,50)`;
  if (lastAmount !== null) {
    return `${head}\nDa última vez: ${formatBRL(lastAmount)} — responde *igual* pra repetir. Ou *pular* pra só marcar como feito.`;
  }
  return `${head}\nOu responde *pular* pra só marcar como feito.`;
}

export function billValueRetry(problem: string, name: string, lastAmount: number | null): string {
  return `${problem}\n${billValueQuestion(name, lastAmount)}`;
}

export const BILL_NO_PREVIOUS_VALUE_TEXT = "Ainda não tenho um valor anterior dessa conta — me diz quanto foi (ex: 120 ou 120,50).";
