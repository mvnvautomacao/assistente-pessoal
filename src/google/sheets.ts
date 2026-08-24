import { google } from "googleapis";
import { getOAuthClient } from "./auth";
import { config } from "../config";

export async function appendExpense(params: { date: string; category: string; description: string; amount: number }) {
  const sheets = google.sheets({ version: "v4", auth: getOAuthClient() });

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetsSpreadsheetId,
    range: `${config.google.sheetsTabName}!A:D`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[params.date, params.category, params.description, params.amount]],
    },
  });
}
