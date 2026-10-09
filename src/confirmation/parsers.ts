// Interpretacao de valores digitados pelo usuario numa correcao. Funcoes puras.
import { spDateString, spTimeString } from "../timeSP";

export type AmountParse = { ok: true; value: number } | { ok: false; reason: "invalid" | "not_positive" };

// Valor em formato brasileiro: "45", "45,90", "R$ 45", "45 reais", "1.500" (=1500),
// "1.500,50" (=1500,50). Com virgula, a virgula e o decimal e o ponto e milhar.
// So com ponto: e milhar se tiver exatamente 3 digitos depois do ponto
// (ex: "1.500"); senao e decimal (ex: "1.50" = 1,5). Maior que zero.
export function parseBrazilianAmountDetailed(text: string): AmountParse {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/r\$/g, "")
    .replace(/\b(reais|real|conto|contos)\b/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) return { ok: false, reason: "invalid" };

  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;

  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(body)) normalized = body.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(body)) normalized = body.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(body)) normalized = body.replace(/\./g, "");
  else if (/^\d+\.\d+$/.test(body)) normalized = body;
  else if (/^\d+$/.test(body)) normalized = body;
  else return { ok: false, reason: "invalid" };

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "invalid" };
  if (negative || value <= 0) return { ok: false, reason: "not_positive" };
  return { ok: true, value };
}

export function parseBrazilianAmount(text: string): number | null {
  const result = parseBrazilianAmountDetailed(text);
  return result.ok ? result.value : null;
}

// "30 minutos", "2 horas", "1 dia", "na hora" -> minutos (0 a 30 dias)
export function parseLeadTimeMinutes(text: string): number | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (/^(na hora|sem antecedencia)$/.test(t)) return 0;
  const match = t.match(/^(\d+)\s*(min|minuto|minutos|m|h|hora|horas|d|dia|dias)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2];
  const minutes = unit.startsWith("d") ? n * 1440 : unit.startsWith("h") ? n * 60 : n;
  return minutes >= 0 && minutes <= 43200 ? minutes : null;
}

// "8" ou "dia 8" -> 8 (1 a 31)
export function parseDayOfMonthAnswer(text: string): number | null {
  const match = text.trim().toLowerCase().match(/^(dia\s+)?(\d{1,2})$/);
  if (!match) return null;
  const day = Number(match[2]);
  return day >= 1 && day <= 31 ? day : null;
}

// ---------------------------------------------------------------------------
// Termino de evento (horario final OU duracao) e local
// ---------------------------------------------------------------------------

export const MIN_EVENT_MINUTES = 5;
export const MAX_EVENT_MINUTES = 24 * 60;
export const MAX_LOCATION_LENGTH = 100;

export const END_NOT_UNDERSTOOD_TEXT = "Não entendi 🤔 Me diz a hora (ex: 17h) ou quanto tempo dura (ex: 2 horas).";
export const DURATION_RANGE_TEXT = "A duração precisa ser entre 5 minutos e 24 horas.";

// o que o usuario disse sobre o termino: um horario final ("HH:MM") OU uma duracao
export interface EndSpec {
  endTime?: string;
  durationMinutes?: number;
}

export type EndSpecParse = { ok: true; spec: EndSpec } | { ok: false; error: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

function stripAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// duracao dita com palavras: "2 horas", "45 min", "1 hora e meia", "meia hora", "dura 2h"
function parseDurationWords(t: string): number | null {
  if (/^(dura\s+)?meia hora$/.test(t)) return 30;
  const half = t.match(/^(?:dura\s+)?(\d+)\s*(?:hora|horas|h)\s+e\s+meia$/);
  if (half) return Number(half[1]) * 60 + 30;
  const hm = t.match(/^(?:dura\s+)?(\d+)\s*(?:hora|horas)\s+e\s+(\d+)\s*(?:min|minuto|minutos)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const single = t.match(/^(?:dura\s+|por\s+)?(\d+)\s*(min|minuto|minutos|hora|horas)$/);
  if (single) return single[2].startsWith("min") ? Number(single[1]) : Number(single[1]) * 60;
  const dura = t.match(/^dura\s+(\d+)\s*h$/);
  if (dura) return Number(dura[1]) * 60;
  return null;
}

// Interpreta a resposta de "que horas termina ou quanto tempo dura?" sem decidir se o
// resultado e valido (isso depende do inicio -- ver validateEndSpec). Devolve a forma
// pedida e, quando ambigua ("2h", "1h30"), os dois candidatos: horario final primeiro.
export function parseEndOrDuration(text: string): { endTime?: string; durationMinutes?: number; ambiguous?: { endTime: string; durationMinutes: number } } | null {
  const t = stripAccents(text).replace(/[.!?]+$/g, "");
  const duration = parseDurationWords(t);
  if (duration !== null) return { durationMinutes: duration };

  // horario final explicito: "HH:MM", ou com palavra-chave ("as 17", "ate 17h", "termina 17h30")
  const keyword = t.match(/^(?:(?:ate|as|termina|termina as|fim|fim as|ate as)\s+)(\d{1,2})(?:\s*h\s*(\d{2})?|:(\d{2}))?$/);
  if (keyword) return endTimeOf(Number(keyword[1]), Number(keyword[2] ?? keyword[3] ?? 0));
  const clock = t.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return endTimeOf(Number(clock[1]), Number(clock[2]));

  // "17h" / "17h30" / "2h" / "1h30": horario final primeiro, duracao se nao fizer sentido
  const hour = t.match(/^(\d{1,2})\s*h\s*(\d{2})?$/);
  if (hour) {
    const hh = Number(hour[1]);
    const mm = Number(hour[2] ?? 0);
    const asEnd = endTimeOf(hh, mm);
    if (!asEnd) return { durationMinutes: hh * 60 + mm };
    return { ...asEnd, ambiguous: { endTime: asEnd.endTime!, durationMinutes: hh * 60 + mm } };
  }
  return null;
}

function endTimeOf(hh: number, mm: number): { endTime: string } | null {
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 ? { endTime: `${pad2(hh)}:${pad2(mm)}` } : null;
}

// "HH:MM" local de Sao Paulo de um instante ISO
function spHHMM(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: spDateString(d), time: spTimeString(d) };
}

// Resolve a resposta de termino contra o INICIO do evento (RN02-RN04): devolve a
// especificacao final (horario OU duracao) e o termino resultante em ISO -03:00.
export function resolveEndSpec(text: string, startIso: string): (EndSpecParse & { end?: string }) {
  const parsed = parseEndOrDuration(text);
  if (!parsed) return { ok: false, error: END_NOT_UNDERSTOOD_TEXT };
  const start = new Date(startIso);
  const local = spHHMM(startIso);

  const tryEnd = (endTime: string) => {
    const end = `${local.date}T${endTime}:00-03:00`;
    return new Date(end).getTime() > start.getTime() ? end : null;
  };
  const tryDuration = (minutes: number): { end?: string; error?: string } => {
    if (minutes < MIN_EVENT_MINUTES || minutes > MAX_EVENT_MINUTES) return { error: DURATION_RANGE_TEXT };
    const endDate = new Date(start.getTime() + minutes * 60 * 1000);
    if (spDateString(endDate) !== local.date) return { error: "O término precisa ser no mesmo dia do início." };
    return { end: `${spDateString(endDate)}T${spTimeString(endDate)}:00-03:00` };
  };

  if (parsed.endTime !== undefined) {
    const end = tryEnd(parsed.endTime);
    if (end) return { ok: true, spec: { endTime: parsed.endTime }, end };
    // "17h"/"2h" so cai pra duracao quando a leitura como horario final nao fecha
    if (parsed.ambiguous) {
      const alt = tryDuration(parsed.ambiguous.durationMinutes);
      if (alt.end) return { ok: true, spec: { durationMinutes: parsed.ambiguous.durationMinutes }, end: alt.end };
    }
    return { ok: false, error: `O término precisa ser depois do início (${local.time}).` };
  }
  const result = tryDuration(parsed.durationMinutes!);
  return result.end ? { ok: true, spec: { durationMinutes: parsed.durationMinutes }, end: result.end } : { ok: false, error: result.error! };
}

// "tira o local", "remover", "sem local"... (aceita a frase inteira ou so a palavra)
const LOCATION_REMOVAL = /^(?:(?:remov(?:er|e)|tir(?:ar|a)|limp(?:ar|a)|apag(?:ar|a)|sem|nenhum|nao tem)(?:\s+(?:o|a))?(?:\s+local)?|sem local|nao tem local)$/;

export type LocationParse = { ok: true; location: string | null } | { ok: false; error: string };

export function parseLocationAnswer(text: string): LocationParse {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Não recebi nada." };
  if (LOCATION_REMOVAL.test(stripAccents(value).replace(/[.!?]+$/g, ""))) return { ok: true, location: null };
  if (value.length > MAX_LOCATION_LENGTH) return { ok: false, error: `Esse texto está muito longo (máximo ${MAX_LOCATION_LENGTH} caracteres).` };
  return { ok: true, location: value };
}
