import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { adminRouter } from "./admin";
import { dashboardRouter } from "./dashboard";
import { startReminderScheduler } from "./reminders/scheduler";
import { startExpenseReportScheduler } from "./expenses/reportScheduler";
import { startEventReminderScheduler } from "./events/reminderScheduler";
import { startRecurringExpenseScheduler } from "./expenses/recurringScheduler";
import "./db";

const app = express();
// necessario pro Express enxergar corretamente req.secure/x-forwarded-proto
// atras do proxy reverso do Coolify (Traefik) -- sem isso, o cookie de sessao
// com secure:true nunca seria aceito pelo navegador em producao.
app.set("trust proxy", 1);
app.use(cookieParser());
// limite padrao do express.json() e so 100kb -- muito pouco pro webhook da
// Evolution API, que manda foto/audio em base64 dentro do proprio JSON (uma
// foto de nota fiscal legivel facilmente passa disso). Sem esse limite maior,
// a requisicao e rejeitada com 413 ANTES de chegar no nosso codigo -- webhook
// nunca roda, sem nenhum log nem resposta (foi exatamente o que aconteceu em
// producao: foto enviada, Evolution API confirmou no log dela "Request failed
// with status code 413", nosso app nunca processou nada).
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
// manifest.json, icones e o service worker do dashboard-como-PWA. process.cwd()
// e a raiz do projeto tanto local (npm run dev) quanto no container (WORKDIR
// /app no Dockerfile) -- a pasta public/ nunca passa pelo build do tsc, so e
// copiada junto no `COPY . .` do Dockerfile.
app.use(express.static(path.join(process.cwd(), "public")));
app.use(webhookRouter);
app.use(adminRouter);
app.use(dashboardRouter);

app.get("/health", (_req, res) => res.send("ok"));

app.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
  startReminderScheduler();
  startExpenseReportScheduler();
  startEventReminderScheduler();
  startRecurringExpenseScheduler();
});
