import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data.sqlite",
  // opcional: se definido, o endpoint /webhook so aceita chamadas com ?secret=
  // igual a esse valor. Recomendado antes de expor o servidor publicamente.
  webhookSecret: process.env.WEBHOOK_SECRET,

  evolution: {
    apiUrl: required("EVOLUTION_API_URL"),
    apiKey: required("EVOLUTION_API_KEY"),
    instanceName: required("EVOLUTION_INSTANCE_NAME"),
  },
  myWhatsappNumber: required("MY_WHATSAPP_NUMBER"),

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  groqApiKey: required("GROQ_API_KEY"),

  // login fixo do /admin (painel de atividade e aprovacao de numeros).
  admin: {
    username: required("ADMIN_USERNAME"),
    password: required("ADMIN_PASSWORD"),
  },

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
  },
};
