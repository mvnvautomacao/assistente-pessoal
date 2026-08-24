import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data.sqlite",

  meta: {
    accessToken: required("META_ACCESS_TOKEN"),
    phoneNumberId: required("META_PHONE_NUMBER_ID"),
    verifyToken: required("META_VERIFY_TOKEN"),
  },
  myWhatsappNumber: required("MY_WHATSAPP_NUMBER"),

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  groqApiKey: required("GROQ_API_KEY"),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    sheetsSpreadsheetId: required("GOOGLE_SHEETS_SPREADSHEET_ID"),
    sheetsTabName: process.env.GOOGLE_SHEETS_TAB_NAME ?? "Gastos",
  },
};
