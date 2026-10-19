// Texto da consulta de agenda (Card 16, RN04, RN06, RN09, RN10; numeracao no Card 20). Puro: recebe eventos, lembretes e "agora".
// Eventos e lembretes juntos, por dia, em ordem de horario; so HH:MM (nada de "15/10/2026, 10:00:00"). Cada item recebe um numero
// (sequencia continua, os dias sao so cabecalhos) e a funcao devolve tambem quais itens foram numerados, pro roteador guardar.
import { addDaysToDateString, spDateString, spTimeString } from "../timeSP";
import type { AgendaShownItem } from "../lists/lastShown";
import { dayMonth, weekdayShort } from "./range";

export const MAX_AGENDA_ITEMS = 30;
export const MAX_AGENDA_TITLE_CHARS = 60;

// dica no fim de toda lista com pelo menos um item (Card 20, RN05); string vazia desliga
export const AGENDA_ACTION_HINT = 'Pra mexer em um item: "edita o 2" ou "cancela o 3".';

export interface AgendaEvent {
  id: number;
  title: string;
  start: string;
  end?: string | null;
  location?: string | null;
}

export interface AgendaReminder {
  id: number;
  message: string;
  due_at: string;
  sent: number;
}

export interface AgendaFormatInput {
  title: string; // "📅 Agenda — amanhã (sex 09/10)"
  events: AgendaEvent[];
  reminders: AgendaReminder[];
  mode: "day" | "period"; // "day" = um dia so: sem cabecalho por dia
  now: Date;
  startDate: string; // primeiro dia do recorte (evento que comecou antes entra neste dia)
  link: string; // painel, usado quando passa do teto
  emptyText: string; // "Nada agendado." / "Nenhum lembrete."
  max?: number;
  notice?: string; // linha antes do titulo (dia inexistente, RN16)
  footer?: string; // depois da lista (ex: "…e mais 6. Diga ...")
  actionHint?: string; // dica de acao no fim da lista (padrao AGENDA_ACTION_HINT; "" desliga)
}

export interface AgendaFormatted {
  text: string;
  shown: AgendaShownItem[]; // os itens numerados, na ordem (o numero N e shown[N - 1])
}

interface Item {
  kind: 0 | 1; // 0 = evento, 1 = lembrete (evento antes no mesmo minuto)
  at: number;
  id: number;
  date: string;
  line: string; // sem o numero da frente
}

export function truncateTitle(text: string, max = MAX_AGENDA_TITLE_CHARS): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const EFFECTIVE_DURATION_MS = 60 * 60 * 1000;

function eventEndMs(event: AgendaEvent): number {
  const end = event.end ? new Date(event.end).getTime() : NaN;
  return Number.isFinite(end) ? end : new Date(event.start).getTime() + EFFECTIVE_DURATION_MS;
}

// "09:00–10:00 Reunião · Sala 2" (sem fim gravado, so o inicio; sem local, sem " · ")
function eventLine(event: AgendaEvent, now: Date): string {
  const startMs = new Date(event.start).getTime();
  const hasEnd = Boolean(event.end) && Number.isFinite(new Date(event.end!).getTime());
  const time = hasEnd ? `${spTimeString(new Date(startMs))}–${spTimeString(new Date(event.end!))}` : spTimeString(new Date(startMs));
  const live = startMs <= now.getTime() && now.getTime() < eventEndMs(event) ? "agora " : "";
  const place = event.location?.trim() ? ` · ${event.location.trim()}` : "";
  return `${live}${time} ${truncateTitle(event.title)}${place}`;
}

function reminderLine(reminder: AgendaReminder): string {
  const mark = reminder.sent ? "✔️" : "⏰";
  return `${mark} ${spTimeString(new Date(reminder.due_at))} ${truncateTitle(reminder.message)}`;
}

// "Qui 15/10", "Hoje · qui 15/10", "Amanhã · sex 16/10"
export function dayHeader(date: string, today: string): string {
  const shown = `${weekdayShort(date)} ${dayMonth(date, today)}`;
  if (date === today) return `Hoje · ${shown}`;
  if (date === addDaysToDateString(today, 1)) return `Amanhã · ${shown}`;
  return `${shown.charAt(0).toUpperCase()}${shown.slice(1)}`;
}

export function formatAgenda(input: AgendaFormatInput): AgendaFormatted {
  const max = input.max ?? MAX_AGENDA_ITEMS;
  const today = spDateString(input.now);
  const prefix = input.notice ? `${input.notice}\n\n` : "";

  const items: Item[] = [
    ...input.events.map((e) => {
      const at = new Date(e.start).getTime();
      const startDay = spDateString(new Date(at));
      return { kind: 0 as const, at, id: e.id, date: startDay < input.startDate ? input.startDate : startDay, line: eventLine(e, input.now) };
    }),
    ...input.reminders.map((r) => {
      const at = new Date(r.due_at).getTime();
      return { kind: 1 as const, at, id: r.id, date: spDateString(new Date(at)), line: reminderLine(r) };
    }),
  ].sort((a, b) => a.at - b.at || a.kind - b.kind || a.id - b.id);

  if (items.length === 0) return { text: `${prefix}${input.title}\n\n${input.emptyText}${input.footer ? `\n\n${input.footer}` : ""}`, shown: [] };

  const shown = items.slice(0, max);
  const lines: string[] = [];
  let currentDay = "";
  let number = 0;
  for (const item of shown) {
    if (input.mode === "period" && item.date !== currentDay) {
      lines.push(dayHeader(item.date, today));
      currentDay = item.date;
    }
    lines.push(`${++number}. ${item.line}`);
  }

  const hidden = items.length - shown.length;
  const more = hidden > 0 ? `\n\n…e mais ${hidden} ${hidden === 1 ? "item" : "itens"}. Veja tudo no painel: ${input.link}` : "";
  const hint = input.actionHint ?? AGENDA_ACTION_HINT;
  const text = `${prefix}${input.title}\n\n${lines.join("\n")}${more}${input.footer ? `\n\n${input.footer}` : ""}${hint ? `\n\n${hint}` : ""}`;
  return { text, shown: shown.map((item) => ({ kind: item.kind === 0 ? ("event" as const) : ("reminder" as const), id: item.id })) };
}
