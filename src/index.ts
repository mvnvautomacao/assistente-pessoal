import express from "express";
import { config } from "./config";
import { webhookRouter } from "./whatsapp/webhook";
import { startReminderScheduler } from "./reminders/scheduler";
import "./db";

const app = express();
app.use(express.json());
app.use(webhookRouter);

app.get("/health", (_req, res) => res.send("ok"));

app.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
  startReminderScheduler();
});
