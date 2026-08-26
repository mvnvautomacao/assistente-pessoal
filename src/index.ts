import express from "express";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { adminRouter } from "./admin";
import { dashboardRouter } from "./dashboard";
import { startReminderScheduler } from "./reminders/scheduler";
import { startExpenseReportScheduler } from "./expenses/reportScheduler";
import "./db";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(webhookRouter);
app.use(adminRouter);
app.use(dashboardRouter);

app.get("/health", (_req, res) => res.send("ok"));

app.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
  startReminderScheduler();
  startExpenseReportScheduler();
});
