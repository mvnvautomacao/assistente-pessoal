// Consultas de agenda do bot (Card 16): "o que tenho hoje", "agenda da semana", "meus lembretes". Junta o recorte
// (range.ts), a busca (events/reminders service) e o texto (format.ts). Sempre filtrado por numero.
import { config } from "../config";
import type { AgendaShownItem } from "../lists/lastShown";
import { listEventsBetween } from "../events/service";
import { countPendingReminders, listNextPendingReminders, listRemindersBetween } from "../reminders/service";
import { spDateString } from "../timeSP";
import { formatAgenda, MAX_AGENDA_ITEMS } from "./format";
import { agendaTitlePrefix, AgendaParams, AgendaScope, resolveAgendaRange } from "./range";

export const NEXT_REMINDERS_LIMIT = 10;

export interface AgendaOutput {
  text: string;
  log: string;
  shown: AgendaShownItem[]; // itens numerados na resposta (o roteador guarda pra "cancela o 3")
}

const EMPTY_TEXT: Record<AgendaScope, string> = { all: "Nada agendado.", events: "Nenhum evento.", reminders: "Nenhum lembrete." };

export function runAgendaReport(fromNumber: string, params: AgendaParams, now: Date = new Date(Date.now()), link: string = config.dashboardUrl): AgendaOutput {
  const resolved = resolveAgendaRange(params, now);
  if (!resolved.ok) return { text: resolved.error, log: "recorte invalido", shown: [] };
  const range = resolved.range;

  const events = range.scope === "reminders" ? [] : listEventsBetween(fromNumber, range.startIso, range.endIso, { onlyNotEnded: range.onlyUpcoming, now });
  const reminders =
    range.scope === "events" ? [] : listRemindersBetween(fromNumber, range.startIso, range.endIso, { includeSent: !range.onlyUpcoming });

  const { text, shown } = formatAgenda({
    title: `${agendaTitlePrefix(range.scope)} — ${range.label}`,
    events,
    reminders,
    mode: range.mode,
    now,
    startDate: range.startDate,
    link,
    emptyText: EMPTY_TEXT[range.scope],
    notice: range.notice,
  });
  return { text, shown, log: `${range.label} (${range.scope}): ${events.length} eventos, ${reminders.length} lembretes` };
}

// "meus lembretes": os proximos 10 pendentes; "todos os lembretes": todos os futuros (ate o teto de 30 com link)
export function runListReminders(fromNumber: string, all: boolean, now: Date = new Date(Date.now()), link: string = config.dashboardUrl): AgendaOutput {
  const total = countPendingReminders(fromNumber, now);
  const limit = all ? MAX_AGENDA_ITEMS : NEXT_REMINDERS_LIMIT;
  const reminders = listNextPendingReminders(fromNumber, limit, 0, now);
  const remaining = total - limit;
  const footer =
    remaining <= 0
      ? undefined
      : all
        ? `…e mais ${remaining} ${remaining === 1 ? "item" : "itens"}. Veja tudo no painel: ${link}`
        : `…e mais ${remaining}. Diga "todos os meus lembretes" pra ver tudo.`;
  const { text, shown } = formatAgenda({
    title: all ? "⏰ Lembretes — todos" : `⏰ Lembretes — próximos ${NEXT_REMINDERS_LIMIT}`,
    events: [],
    reminders,
    mode: "period",
    now,
    startDate: spDateString(now),
    link,
    emptyText: EMPTY_TEXT.reminders,
    footer,
  });
  return { text, shown, log: `${all ? "todos" : "proximos"}: ${reminders.length} de ${total} lembretes pendentes` };
}
