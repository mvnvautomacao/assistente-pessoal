// Interpretacao de valores digitados pelo usuario numa correcao. Funcoes puras.

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
