import "dotenv/config";
import { parseRetentionDays } from "./activity/retention";

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
  // link do painel, mandado junto da mensagem de boas-vindas e da senha
  dashboardUrl: process.env.DASHBOARD_URL ?? "https://marcusvnv.com.br/dashboard",

  // dias de retencao do activity_log (Card 21): 90 por padrao; 0 desliga a limpeza; valor invalido volta pra 90
  activityLogRetentionDays: parseRetentionDays(process.env.ACTIVITY_LOG_RETENTION_DAYS),

  // Card 24: com "true", uma resposta "ja paguei" interpretada (nao exata) do aviso de conta fixa segue direto pra pergunta do valor, repetindo o que entendeu
  autoApplyInterpretedPaid: process.env.AUTO_APPLY_INTERPRETED_PAID === "true",

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
