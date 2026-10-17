// Cadastro de gasto fixo e alerta de conta pelo WhatsApp (Card 13): regras puras, sem banco e sem I/O.
// O router guarda o rascunho em pending_state (recurrence/pending.ts) e usa estas funcoes pra decidir o
// tipo, o que ainda falta, se e duplicata e se o dia deste mes ja passou.
import { parseBrazilianAmountDetailed } from "../confirmation/parsers";
import { normalizeSearch } from "../text/search";
import { daysInMonth, effectiveDayOfMonth } from "../timeSP";

export type RecurrenceKind = "recurring_expense" | "bill_alert";
// "unclear" = ainda nao da pra dizer se e gasto fixo ou so um aviso (RN04)
export type RecurrenceMode = RecurrenceKind | "unclear";

export interface RecurrenceDraft {
  description?: string;
  amount?: number;
  categoryName?: string;
  paymentMethodName?: string;
  dayOfMonth?: number;
  intervalDays?: number;
  // valor que o usuario falou junto de um intervalo: nao e guardado (RN03), so avisado na previa
  ignoredAmount?: number;
}

// o que ainda pode faltar no rascunho, na ordem em que e perguntado (RN06)
export type RecurrenceField = "description" | "amount" | "schedule";

export const MAX_INTERVAL_DAYS = 3650;
export const DAY_RANGE_TEXT = "O dia precisa ser de 1 a 31.";
export const INTERVAL_RANGE_TEXT = "O intervalo precisa ser de pelo menos 1 dia.";
export const AMOUNT_RANGE_TEXT = "O valor precisa ser maior que R$ 0,00.";

// hora (SP) a partir da qual o cron das 7h ja passou no dia do vencimento
export const RECURRING_CRON_HOUR = 7;

// ---------------------------------------------------------------------------
// tipo e o que falta
// ---------------------------------------------------------------------------

// RN01/RN03: com intervalo e SEMPRE alerta (o valor, se veio, e descartado); sem intervalo vale o que a
// IA/usuario indicou. Devolve o rascunho ajustado junto do tipo.
export function reconcileKind(mode: RecurrenceMode, draft: RecurrenceDraft): { mode: RecurrenceMode; draft: RecurrenceDraft } {
  if (draft.intervalDays !== undefined) {
    const next: RecurrenceDraft = { ...draft };
    if (next.amount !== undefined) {
      next.ignoredAmount = next.amount;
      delete next.amount;
    }
    return { mode: "bill_alert", draft: next };
  }
  return { mode, draft };
}

// RN02: de um palpite ("conta fixa") pro tipo, quando os dados ja decidem
export function decideMode(hint: RecurrenceMode, draft: RecurrenceDraft): RecurrenceMode {
  if (draft.intervalDays !== undefined) return "bill_alert";
  if (hint !== "unclear") return hint;
  if (draft.amount !== undefined) return "recurring_expense";
  return "unclear";
}

// RN05/RN06: o que falta, na ordem nome -> valor -> dia/intervalo. "unclear" nao pede valor (ainda nao se sabe se tem).
export function missingFields(mode: RecurrenceMode, draft: RecurrenceDraft): RecurrenceField[] {
  const missing: RecurrenceField[] = [];
  if (!draft.description?.trim()) missing.push("description");
  if (mode === "recurring_expense" && draft.amount === undefined) missing.push("amount");
  if (draft.dayOfMonth === undefined && draft.intervalDays === undefined) missing.push("schedule");
  return missing;
}

// ---------------------------------------------------------------------------
// leitura do texto livre (mensagem ou resposta de preenchimento)
// ---------------------------------------------------------------------------

export interface Extracted {
  description?: string;
  amount?: number;
  dayOfMonth?: number;
  intervalDays?: number;
  problems: string[];
}

const UNIT_DAYS: Record<string, number> = { dia: 1, dias: 1, semana: 7, semanas: 7, mes: 30, meses: 30 };
const WORD_NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// palavras que nao fazem parte do nome quando aparecem nas pontas
const EDGE_WORDS = new Set([
  "todo", "toda", "todos", "todas", "dia", "gasto", "gastos", "fixo", "fixa", "despesa", "despesas", "pago", "pagar", "paga", "pagando", "pagamento",
  "de", "do", "da", "no", "na", "em", "reais", "real", "r", "um", "uma", "e", "por", "mensal", "mensalmente", "lanca", "lancar", "debita", "cadastrar",
  "cadastre", "criar", "cria", "mes", "ao", "a", "o", "pra", "para", "com", "que", "se", "chama", "chamado", "nome", "valor", "conto", "contos",
]);

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

function wordToNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return Object.prototype.hasOwnProperty.call(WORD_NUMBERS, token) ? WORD_NUMBERS[token] : null;
}

// "a cada 45 dias", "de 15 em 15 dias", "a cada 2 meses", "a cada 2 semanas" -> dias (mes = 30)
function extractInterval(plain: string): { days: number; span: [number, number] } | null {
  let match = /\bde\s+(\d+)\s+em\s+\1\s+dias?\b/.exec(plain);
  if (match) return { days: Number(match[1]), span: [match.index, match.index + match[0].length] };
  match = /\ba\s+cada\s+(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(dias?|semanas?|mes(?:es)?)\b/.exec(plain);
  if (match) {
    const n = wordToNumber(match[1]);
    if (n !== null) return { days: n * (UNIT_DAYS[match[2]] ?? 1), span: [match.index, match.index + match[0].length] };
  }
  return null;
}

// troca os trechos [inicio, fim) por espacos, mantendo o tamanho do texto (os indices continuam valendo)
function blank(text: string, spans: [number, number][]): string {
  let out = text;
  for (const [start, end] of spans) out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
  return out;
}

// minusculas e sem acento, caractere a caractere: o resultado tem o MESMO tamanho do original, entao
// as posicoes achadas no texto limpo servem pra cortar o texto original (que guarda acento e caixa)
function foldSameLength(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const folded = stripAccents(ch).toLowerCase();
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

export function extractFromText(raw: string): Extracted {
  const problems: string[] = [];
  const result: Extracted = { problems };
  const plain = foldSameLength(raw);
  const spans: [number, number][] = [];

  const interval = extractInterval(plain);
  if (interval) {
    spans.push(interval.span);
    if (interval.days < 1) problems.push(INTERVAL_RANGE_TEXT);
    else if (interval.days > MAX_INTERVAL_DAYS) problems.push(`O intervalo precisa ser de no máximo ${MAX_INTERVAL_DAYS} dias.`);
    else result.intervalDays = interval.days;
  } else {
    const dayMatch = /\b(?:todo\s+)?dia\s+(\d{1,3})\b/.exec(plain);
    if (dayMatch) {
      spans.push([dayMatch.index, dayMatch.index + dayMatch[0].length]);
      const day = Number(dayMatch[1]);
      if (day >= 1 && day <= 31) result.dayOfMonth = day;
      else problems.push(DAY_RANGE_TEXT);
    }
  }

  // valor: o primeiro numero que sobrou, com "R$", "reais", "mil" opcionais
  const rest = blank(plain, spans);
  const amountMatch = /(-\s*)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*mil\b)?/.exec(rest);
  if (amountMatch) {
    spans.push([amountMatch.index, amountMatch.index + amountMatch[0].length]);
    const parsed = parseBrazilianAmountDetailed(amountMatch[2]);
    if (amountMatch[1] || !parsed.ok) problems.push(AMOUNT_RANGE_TEXT);
    else {
      const value = amountMatch[3] ? parsed.value * 1000 : parsed.value;
      if (value > 0) result.amount = value;
      else problems.push(AMOUNT_RANGE_TEXT);
    }
  }

  // nome: o texto ORIGINAL sem os trechos de dia/intervalo/valor e sem palavras de enfeite nas pontas
  const words = blank(raw, spans)
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const isEdge = (w: string) => EDGE_WORDS.has(stripAccents(w).toLowerCase());
  while (words.length > 0 && isEdge(words[0])) words.shift();
  while (words.length > 0 && isEdge(words[words.length - 1])) words.pop();
  const name = words.join(" ").trim();
  if (name) result.description = name.charAt(0).toUpperCase() + name.slice(1);
  return result;
}

// resposta a UMA pergunta de preenchimento. Devolve o que foi entendido (pode vir mais de um dado, RN06)
// e, se a resposta nao serviu pra pergunta feita, o motivo (RN07).
export interface FillResult {
  patch: Partial<RecurrenceDraft>;
  problem?: string;
}

export function parseFillAnswer(field: RecurrenceField, answer: string): FillResult {
  const text = answer.trim();
  if (field === "schedule") {
    // so um numero: e o dia do mes
    const bare = /^(?:dia\s+)?(\d{1,3})$/i.exec(text);
    if (bare) {
      const day = Number(bare[1]);
      return day >= 1 && day <= 31 ? { patch: { dayOfMonth: day } } : { patch: {}, problem: DAY_RANGE_TEXT };
    }
  }
  if (field === "amount") {
    const bare = parseBrazilianAmountDetailed(text.replace(/^r\$\s*/i, "").replace(/\s*reais?$/i, ""));
    if (bare.ok) return { patch: { amount: bare.value } };
    if (bare.reason === "not_positive") return { patch: {}, problem: AMOUNT_RANGE_TEXT };
  }

  const found = extractFromText(text);
  const patch: Partial<RecurrenceDraft> = {};
  if (found.description !== undefined) patch.description = found.description;
  if (found.amount !== undefined) patch.amount = found.amount;
  if (found.dayOfMonth !== undefined) patch.dayOfMonth = found.dayOfMonth;
  if (found.intervalDays !== undefined) patch.intervalDays = found.intervalDays;

  // a pergunta feita tem de ter sido respondida
  if (field === "description") {
    if (patch.description === undefined) {
      // resposta que e so numero/dia ("100"): o nome nao veio, mas o resto vale
      return { patch, problem: found.problems[0] ?? "Não entendi o nome." };
    }
    return { patch };
  }
  if (field === "amount") {
    if (patch.amount === undefined) return { patch, problem: found.problems[0] ?? `Não entendi o valor "${text}".` };
    return { patch };
  }
  if (patch.dayOfMonth === undefined && patch.intervalDays === undefined) {
    return { patch, problem: found.problems[0] ?? `Não entendi o dia ou o intervalo "${text}".` };
  }
  return { patch };
}

// o rascunho com o que a IA devolveu, tirando valores invalidos (que viram nova pergunta, RN07)
export function sanitizeDraft(draft: RecurrenceDraft): { draft: RecurrenceDraft; problems: string[] } {
  const clean: RecurrenceDraft = { ...draft };
  const problems: string[] = [];
  if (clean.description !== undefined && !clean.description.trim()) delete clean.description;
  if (clean.description) clean.description = clean.description.trim();
  if (clean.amount !== undefined && !(Number.isFinite(clean.amount) && clean.amount > 0)) {
    problems.push(AMOUNT_RANGE_TEXT);
    delete clean.amount;
  }
  if (clean.dayOfMonth !== undefined && !(Number.isInteger(clean.dayOfMonth) && clean.dayOfMonth >= 1 && clean.dayOfMonth <= 31)) {
    problems.push(DAY_RANGE_TEXT);
    delete clean.dayOfMonth;
  }
  if (clean.intervalDays !== undefined && !(Number.isInteger(clean.intervalDays) && clean.intervalDays >= 1 && clean.intervalDays <= MAX_INTERVAL_DAYS)) {
    problems.push(INTERVAL_RANGE_TEXT);
    delete clean.intervalDays;
  }
  // dia e intervalo juntos: vale o intervalo (RN01)
  if (clean.intervalDays !== undefined) delete clean.dayOfMonth;
  return { draft: clean, problems };
}

// ---------------------------------------------------------------------------
// duplicata (RN09)
// ---------------------------------------------------------------------------

export const MIN_DUPLICATE_LETTERS = 3;

export interface NamedItem {
  id: number;
  name: string;
}

// nome normalizado igual, ou um contem o outro (com no minimo 3 letras)
export function namesOverlap(a: string, b: string): boolean {
  const x = normalizeSearch(a);
  const y = normalizeSearch(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.replace(/\s/g, "").length >= MIN_DUPLICATE_LETTERS && longer.includes(shorter);
}

export function findDuplicate<T extends NamedItem>(items: T[], name: string): T | null {
  return items.find((item) => namesOverlap(item.name, name)) ?? null;
}

// ---------------------------------------------------------------------------
// mes corrente (RN12)
// ---------------------------------------------------------------------------

export function daysInMonthOf(dateStr: string): number {
  const [year, month] = dateStr.split("-").map(Number);
  return daysInMonth(year, month);
}

// dia do mes em que o gasto cai neste mes (dia 31 num mes de 30 dias cai no ultimo dia)
export function effectiveDay(dayOfMonth: number, todayDate: string): number {
  return effectiveDayOfMonth(dayOfMonth, todayDate.slice(0, 7));
}

// o dia deste mes ja passou? (anterior a hoje, ou hoje e o cron das 7h ja rodou)
export function dayAlreadyPassed(dayOfMonth: number, todayDate: string, hourSP: number): boolean {
  const eff = effectiveDay(dayOfMonth, todayDate);
  const today = Number(todayDate.slice(8, 10));
  return eff < today || (eff === today && hourSP >= RECURRING_CRON_HOUR);
}

// "YYYY-MM-DD" do dia do vencimento neste mes
export function dueDateThisMonth(dayOfMonth: number, todayDate: string): string {
  return `${todayDate.slice(0, 7)}-${String(effectiveDay(dayOfMonth, todayDate)).padStart(2, "0")}`;
}
