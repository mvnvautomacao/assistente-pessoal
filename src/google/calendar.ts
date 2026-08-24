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
