// Adiar um lembrete que ja tocou (RN11-RN14): calcula o novo horario e monta a
// mensagem de confirmacao. Funcoes puras (recebem "agora" por parametro).
import { formatWhen } from "../confirmation/preview";
import { formatMinutesBefore } from "../events/service";
import { addDaysToDateString, spDateString, spTimeString } from "../timeSP";

export const MAX_SNOOZE_MINUTES = 43200; // 30 dias
const MIN_AHEAD_MS = 60 * 1000; // o novo horario precisa estar pelo menos 1 minuto a frente
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export const SNOOZE_PAST_TEXT = "Esse horário já passou. Me diz um horário futuro, ex: daqui a 30 min ou amanhã 9h.";
export const SNOOZE_TOO_FAR_TEXT = "Esse horário está longe demais (máximo 1 ano à frente).";
export const SNOOZE_NEEDS_TIME_TEXT = 'Pra quando você quer adiar? Ex: "adia 30 min" ou "adia pra amanhã 9h".';
export const SNOOZE_TOO_MANY_MINUTES_TEXT = "Por minutos consigo adiar até 30 dias. Pra mais que isso, diga a data, ex: adia pra 15/12 às 9h.";
export const SNOOZE_NOT_FOUND_TEXT = 'Não achei nenhum lembrete que tenha tocado agora há pouco. Diga o nome dele, ex: "adia o remédio pra amanhã 9h".';

export interface SnoozeRequest {
  minutes?: number;
  newDate?: string; // "YYYY-MM-DD" (aceita ISO com hora; so a data vale)
  newTime?: string; // "HH:MM"
}

export type SnoozeResult = { ok: true; dueAt: string } | { ok: false; error: string };

// ISO com offset -03:00 no relogio de Sao Paulo (mesmo formato dos lembretes criados)
function toSpIso(date: string, time: string): string {
  return `${date}T${time}:00-03:00`;
}

export function computeSnoozeDue(originalDueAt: string, request: SnoozeRequest, now: Date = new Date()): SnoozeResult {
  let dueAt: string;
  const hasDateOrTime = Boolean(request.newDate || request.newTime);

  if (hasDateOrTime) {
    const original = new Date(originalDueAt);
    if (request.newDate && request.newTime) {
      dueAt = toSpIso(request.newDate.slice(0, 10), request.newTime);
    } else if (request.newDate) {
      // so o dia: mantem a hora do lembrete original
      dueAt = toSpIso(request.newDate.slice(0, 10), spTimeString(original));
    } else {
      // so a hora: hoje se ainda for futura (pelo menos 1 minuto), senao amanha
      const today = spDateString(now);
      dueAt = toSpIso(today, request.newTime!);
      if (new Date(dueAt).getTime() < now.getTime() + MIN_AHEAD_MS) dueAt = toSpIso(addDaysToDateString(today, 1), request.newTime!);
    }
  } else if (request.minutes !== undefined) {
    if (request.minutes > MAX_SNOOZE_MINUTES) return { ok: false, error: SNOOZE_TOO_MANY_MINUTES_TEXT };
    if (request.minutes < 1) return { ok: false, error: SNOOZE_PAST_TEXT };
    const target = new Date(now.getTime() + request.minutes * 60 * 1000);
    dueAt = toSpIso(spDateString(target), spTimeString(target));
  } else {
    return { ok: false, error: SNOOZE_NEEDS_TIME_TEXT };
  }

  const ms = new Date(dueAt).getTime();
  if (Number.isNaN(ms) || ms < now.getTime() + MIN_AHEAD_MS) return { ok: false, error: SNOOZE_PAST_TEXT };
  if (ms > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: SNOOZE_TOO_FAR_TEXT };
  return { ok: true, dueAt };
}

// "às 09:30" (hoje), "amanhã às 09:00" ou "sex 10/10 às 09:00"
export function snoozeWhenLabel(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  const time = spTimeString(due);
  const day = spDateString(due);
  const today = spDateString(now);
  if (day === today) return `às ${time}`;
  if (day === addDaysToDateString(today, 1)) return `amanhã às ${time}`;
  return formatWhen(dueAt);
}

export function formatSnoozeConfirmation(message: string, dueAt: string, minutes: number | undefined, now: Date = new Date()): string {
  const ahead = minutes !== undefined ? ` (daqui a ${formatMinutesBefore(minutes)})` : "";
  return `⏰ Adiado! Te lembro de "${message}" de novo ${snoozeWhenLabel(dueAt, now)}${ahead}. Errou? Responde *desfazer*.`;
}

// "ainda nao tocou": o usuario pediu pra adiar um lembrete que ainda esta pendente
export function formatNotPlayedYet(message: string, dueAt: string, query: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  const day = spDateString(due);
  const today = spDateString(now);
  const when = day === today ? `hoje às ${spTimeString(due)}` : day === addDaysToDateString(today, 1) ? `amanhã às ${spTimeString(due)}` : formatWhen(dueAt);
  return `"${message}" ainda não tocou (é ${when}). Pra mudar o horário, diga "muda o lembrete do ${query} pra …".`;
}

// lembrete que ja tocou e o usuario tentou editar (RN17)
export function formatAlreadyPlayed(message: string, dueAt: string): string {
  return `O lembrete "${message}" já tocou (${formatWhen(dueAt)}). Pra tocar de novo, diga "adia o remédio pra amanhã 9h".`;
}
