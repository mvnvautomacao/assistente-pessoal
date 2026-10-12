// Situacao de um evento em relacao a "agora" (futuro, em andamento ou terminado) e o
// sufixo que as mensagens mostram. Funcoes puras, sem banco -- recebem "agora".

// duracao assumida pra evento sem termino gravado (igual ao padrao de createEvent)
export const DEFAULT_EVENT_MINUTES = 60;

export interface EventTimes {
  start: string;
  end?: string | null;
}

export type EventTiming = "upcoming" | "ongoing" | "ended";

export function eventEndMs(event: EventTimes): number {
  const startMs = new Date(event.start).getTime();
  const endMs = event.end ? new Date(event.end).getTime() : Number.NaN;
  return Number.isFinite(endMs) ? endMs : startMs + DEFAULT_EVENT_MINUTES * 60 * 1000;
}

export function eventTiming(event: EventTimes, now: Date = new Date(Date.now())): EventTiming {
  const nowMs = now.getTime();
  if (nowMs < new Date(event.start).getTime()) return "upcoming";
  return nowMs < eventEndMs(event) ? "ongoing" : "ended";
}

// " · em andamento" / " · terminou há pouco" / "" (RN10)
export function eventStatusSuffix(event: EventTimes, now: Date = new Date(Date.now())): string {
  const timing = eventTiming(event, now);
  if (timing === "ongoing") return " · em andamento";
  if (timing === "ended") return " · terminou há pouco";
  return "";
}
