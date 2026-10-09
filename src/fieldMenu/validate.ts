// Validacao imediata de cada resposta do menu guiado (RN05): valor, data,
// dia e hora, antecedencia, dia do mes e texto. Os validadores de texto/numero
// sao funcoes puras; data e "dia e hora" podem chamar a IA (so quando o texto
// livre nao e um formato comum).
import { extractCategoryFromAnswer, extractDateTimeFromAnswer } from "../ai/interpret";
import { EndSpec, parseBrazilianAmountDetailed, parseDayOfMonthAnswer, parseLeadTimeMinutes, parseLocationAnswer, resolveEndSpec } from "../confirmation/parsers";
import { resolveDate } from "../expenses/editItem";
import { invalidDateMessage } from "../expenses/parseDate";
import { findCategoryMentionedIn } from "../expenses/service";
import { spDateString } from "../timeSP";
import { validateAmount } from "../validation";
import { FieldDef } from "./registry";

export const MAX_TEXT_LENGTH = 100;

export type DateTimeAnswer = { newDate?: string; newTime?: string };
export type LocationAnswer = { location: string | null };
export type FieldValue = string | number | DateTimeAnswer | EndSpec | LocationAnswer;
export type FieldAnswer = { ok: true; value: FieldValue } | { ok: false; error: string };

export function validateTextAnswer(text: string): FieldAnswer {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Não recebi nada." };
  if (value.length > MAX_TEXT_LENGTH) return { ok: false, error: `Esse texto está muito longo (máximo ${MAX_TEXT_LENGTH} caracteres).` };
  return { ok: true, value };
}

export function validateAmountAnswer(text: string): FieldAnswer {
  const parsed = parseBrazilianAmountDetailed(text.trim());
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason === "not_positive" ? "O valor precisa ser maior que R$ 0,00." : `Não entendi o valor "${text.trim()}".` };
  }
  const check = validateAmount(parsed.value);
  return check.ok ? { ok: true, value: parsed.value } : { ok: false, error: check.message };
}

export function validateDayAnswer(text: string): FieldAnswer {
  const day = parseDayOfMonthAnswer(text);
  return day === null ? { ok: false, error: "O dia do mês precisa ser de 1 a 31." } : { ok: true, value: day };
}

export function validateLeadAnswer(text: string): FieldAnswer {
  const minutes = parseLeadTimeMinutes(text);
  return minutes === null
    ? { ok: false, error: `Não entendi a antecedência "${text.trim()}". Pode ser de 0 (na hora) até 30 dias antes.` }
    : { ok: true, value: minutes };
}

export async function validateDateAnswer(text: string, today: string = spDateString()): Promise<FieldAnswer> {
  const parsed = await resolveDate(text.trim(), today);
  if (parsed.ok) return { ok: true, value: parsed.date };
  return {
    ok: false,
    error: parsed.reason === "unrecognized" ? `Não entendi a data "${text.trim()}". Me manda o dia, ex: 15/10 ou ontem.` : invalidDateMessage(parsed.shown),
  };
}

export async function validateDateTimeAnswer(text: string): Promise<FieldAnswer> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Não recebi nada." };
  let extracted: DateTimeAnswer | null = null;
  try {
    extracted = await extractDateTimeFromAnswer(trimmed);
  } catch {
    extracted = null;
  }
  if (!extracted || (!extracted.newDate && !extracted.newTime)) {
    return { ok: false, error: `Não entendi a data e hora "${trimmed}".` };
  }
  return { ok: true, value: { newDate: extracted.newDate, newTime: extracted.newTime } };
}

// categoria dita numa frase longa ("é de lazer mesmo"): acha a categoria
// mencionada ou pede pra IA extrair; resposta curta e o proprio nome
async function categoryNameFrom(fromNumber: string, text: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).filter(Boolean).length <= 3) return trimmed;
  return findCategoryMentionedIn(fromNumber, trimmed)?.name ?? (await extractCategoryFromAnswer(trimmed));
}

// termino do evento: depende do INICIO (a mesma resposta "2h" vale horario ou duracao)
export function validateEndAnswer(text: string, startIso: string | undefined): FieldAnswer {
  if (!startIso) return { ok: false, error: "Não consegui ler o início do evento." };
  const resolved = resolveEndSpec(text, startIso);
  return resolved.ok ? { ok: true, value: resolved.spec } : { ok: false, error: resolved.error };
}

export function validateLocationAnswer(text: string): FieldAnswer {
  const parsed = parseLocationAnswer(text);
  return parsed.ok ? { ok: true, value: { location: parsed.location } } : { ok: false, error: parsed.error };
}

// "context.startIso" so e usado pelo termino do evento (inicio ja com a mudanca de dia/hora, se houver)
export async function validateFieldAnswer(def: FieldDef, text: string, fromNumber: string, context: { startIso?: string } = {}): Promise<FieldAnswer> {
  switch (def.question) {
    case "endtime":
      return validateEndAnswer(text, context.startIso);
    case "location":
      return validateLocationAnswer(text);
    case "amount":
      return validateAmountAnswer(text);
    case "day":
      return validateDayAnswer(text);
    case "lead":
      return validateLeadAnswer(text);
    case "date":
      return validateDateAnswer(text);
    case "datetime":
      return validateDateTimeAnswer(text);
    case "category":
      return validateTextAnswer(await categoryNameFrom(fromNumber, text));
    default:
      return validateTextAnswer(text);
  }
}
