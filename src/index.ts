import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { adminRouter } from "./admin";
import { dashboardRouter } from "./dashboard";
import { startReminderScheduler } from "./reminders/scheduler";
import { startExpenseReportScheduler } from "./expenses/reportScheduler";
import { startEventReminderScheduler } from "./events/reminderScheduler";
import { startRecurringExpenseScheduler } from "./expenses/recurringScheduler";
import { startBillAlertScheduler } from "./bills/scheduler";
import "./db";

const app = express();
// necessario pro Express enxergar corretamente req.secure/x-forwarded-proto
// atras do proxy reverso do Coolify (Traefik) -- sem isso, o cookie de sessao
// com secure:true nunca seria aceito pelo navegador em producao.
app.set("trust proxy", 1);
// achado da auditoria: sem CSP/HSTS/X-Frame-Options/X-Content-Type-Options
// nas respostas, e o header X-Powered-By vazando a stack. CSP fica desligado
// de proposito -- o dashboard usa <style> e atributos onsubmit/onclick
// inline por todo canto, e a politica padrao do helmet bloquearia tudo isso
// (quebraria o site inteiro pra ganhar uma protecao que exigiria reescrever
// o dashboard inteiro pra nonce/hash). As outras protecoes (HSTS, no-sniff,
// no-frame, esconder X-Powered-By) vem de graca, sem risco de quebrar nada.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
// limite padrao (100kb) serve bem pros formularios do dashboard/admin -- o
// limite maior de 25mb (pra foto/audio em base64 vindo da Evolution API) fica
// SO na rota do webhook (ver whatsapp/webhook.ts), nao mais global. Antes,
// /dashboard/login, /admin/login e toda rota do dashboard tambem aceitavam
// payload de ate 25mb sem motivo, ampliando a superficie de negacao de
// servico por banda/memoria justamente nas rotas de autenticacao.
app.use(express.urlencoded({ extended: true }));
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
  startBillAlertScheduler();
});
