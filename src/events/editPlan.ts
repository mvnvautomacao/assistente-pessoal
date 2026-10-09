// Plano de edicao de um evento: calcula o termino proposto (RN02), lista as mudancas
// que realmente existem (Quando, Termino, Nome, Local, Aviso) e monta o cabecalho e
// os textos. Tudo funcao pura -- sem banco, sem IA.
import { MAX_EVENT_MINUTES, MIN_EVENT_MINUTES, DURATION_RANGE_TEXT, EndSpec } from "../confirmation/parsers";
import { formatWhen } from "../confirmation/preview";
import { ensureBrazilOffset, spDateString, spTimeString } from "../timeSP";
import { formatMinutesBefore } from "./service";

export type { EndSpec };

export interface EventSnapshot {
  title: string;
  start: string;
  end: string;
  location: string | null;
  reminderMinutes: number;
}

// chave de cada tipo de mudanca, na ordem em que aparecem na previa (RN06)
export type EventChangeKey = "datetime" | "end" | "title" | "location" | "lead";

export interface EventChange {
  key: EventChangeKey;
  label: string;
  from: string;
  to: string;
  text: string; // trecho da mensagem de sucesso ("de ... pra ...", 'título "A" → "B"'...)
}

export function leadLabel(minutes: number): string {
  return minutes === 0 ? "na hora" : `${formatMinutesBefore(minutes)} antes`;
}

// "HH:MM" no relogio de Sao Paulo
export function hhmm(iso: string): string {
  return spTimeString(new Date(iso));
}

// "Consulta — sex 10/10 às 14:00–15:00 · Clínica Sorriso" (RN07)
export function eventHeader(event: { title: string; start: string; end: string; location: string | null }): string {
  const place = event.location ? ` · ${event.location}` : "";
  return `${event.title} — ${formatWhen(event.start)}–${hhmm(event.end)}${place}`;
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

export type ProposedEnd = { ok: true; end: string } | { ok: false; error: string };

// Termino a partir do inicio PROPOSTO (RN02): horario final no mesmo dia (SP) do
// inicio, ou inicio + duracao, ou -- sem nada explicito -- a duracao original.
export function computeProposedEnd(previous: Pick<EventSnapshot, "start" | "end">, proposedStart: string, spec: EndSpec | null): ProposedEnd {
  const start = new Date(proposedStart);
  const localDate = spDateString(start);

  if (spec?.endTime) {
    const end = ensureBrazilOffset(`${localDate}T${spec.endTime}:00`);
    if (new Date(end).getTime() <= start.getTime()) return { ok: false, error: `O término precisa ser depois do início (${spTimeString(start)}).` };
    return { ok: true, end };
  }
  if (spec?.durationMinutes !== undefined) {
    if (spec.durationMinutes < MIN_EVENT_MINUTES || spec.durationMinutes > MAX_EVENT_MINUTES) return { ok: false, error: DURATION_RANGE_TEXT };
    const endDate = new Date(start.getTime() + spec.durationMinutes * 60 * 1000);
    if (spDateString(endDate) !== localDate) return { ok: false, error: "O término precisa ser no mesmo dia do início." };
    return { ok: true, end: `${spDateString(endDate)}T${spTimeString(endDate)}:00-03:00` };
  }
  const durationMs = new Date(previous.end).getTime() - new Date(previous.start).getTime();
  return { ok: true, end: new Date(start.getTime() + durationMs).toISOString() };
}

// So as mudancas que mudam de fato, na ordem Quando, Termino, Nome, Local, Aviso (RN06).
// O termino so vira linha propria quando foi pedido (spec) e difere do que a duracao
// original daria -- remarcar so o inicio nao mostra "Termino".
export function eventChanges(previous: EventSnapshot, proposed: EventSnapshot, spec: EndSpec | null): EventChange[] {
  const changes: EventChange[] = [];
  if (!sameInstant(previous.start, proposed.start)) {
    changes.push({
      key: "datetime",
      label: "Quando",
      from: formatWhen(previous.start),
      to: formatWhen(proposed.start),
      text: `de ${new Date(previous.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} pra ${new Date(proposed.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    });
  }
  const preservedEnd = computeProposedEnd(previous, proposed.start, null);
  const endIsExplicitChange =
    spec !== null && !sameInstant(previous.end, proposed.end) && !(preservedEnd.ok && sameInstant(preservedEnd.end, proposed.end));
  if (endIsExplicitChange) {
    changes.push({ key: "end", label: "Término", from: hhmm(previous.end), to: hhmm(proposed.end), text: `término ${hhmm(previous.end)} → ${hhmm(proposed.end)}` });
  }
  if (previous.title !== proposed.title) {
    changes.push({ key: "title", label: "Nome", from: previous.title, to: proposed.title, text: `título "${previous.title}" → "${proposed.title}"` });
  }
  if ((previous.location ?? null) !== (proposed.location ?? null)) {
    changes.push({
      key: "location",
      label: "Local",
      from: previous.location ?? "sem local",
      to: proposed.location ?? "sem local",
      text: proposed.location ? `local ${previous.location ? `"${previous.location}" → ` : ""}"${proposed.location}"` : "local removido",
    });
  }
  if (previous.reminderMinutes !== proposed.reminderMinutes) {
    changes.push({
      key: "lead",
      label: "Aviso",
      from: leadLabel(previous.reminderMinutes),
      to: leadLabel(proposed.reminderMinutes),
      text: `aviso ${formatMinutesBefore(proposed.reminderMinutes)} antes`,
    });
  }
  return changes;
}

export function eventChangeText(changes: EventChange[]): string {
  return changes.map((c) => c.text).join("; ");
}
