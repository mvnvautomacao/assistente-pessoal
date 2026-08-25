import { google } from "googleapis";
import { getOAuthClient } from "./auth";
import { config } from "../config";

export async function createCalendarEvent(params: { title: string; start: string; end?: string; location?: string }) {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  const end = params.end ?? new Date(new Date(params.start).getTime() + 60 * 60 * 1000).toISOString();

  const { data } = await calendar.events.insert({
    calendarId: config.google.calendarId,
    requestBody: {
      summary: params.title,
      location: params.location,
      start: { dateTime: params.start, timeZone: "America/Sao_Paulo" },
      end: { dateTime: end, timeZone: "America/Sao_Paulo" },
    },
  });
  return data;
}

// Busca so nos proximos 60 dias: o caso de uso e cancelar um compromisso futuro,
// nao vasculhar o historico inteiro da agenda.
export async function findUpcomingEvents(query: string) {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  const { data } = await calendar.events.list({
    calendarId: config.google.calendarId,
    q: query,
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 10,
  });
  return data.items ?? [];
}

export async function listUpcomingEvents(days: number) {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  const { data } = await calendar.events.list({
    calendarId: config.google.calendarId,
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return data.items ?? [];
}

export async function deleteCalendarEvent(eventId: string) {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  await calendar.events.delete({ calendarId: config.google.calendarId, eventId });
}
