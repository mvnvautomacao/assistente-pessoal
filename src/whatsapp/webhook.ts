import { Router } from "express";
import { handleIncomingMessage } from "../router";

export const webhookRouter = Router();

webhookRouter.post("/webhook", (req, res) => {
  // Responde 200 imediatamente: evita que a Evolution API fique reenviando o evento.
  res.sendStatus(200);

  const { event, data } = req.body ?? {};
  if (event !== "messages.upsert" || !data || data.key?.fromMe) return;

  handleIncomingMessage(data).catch((err) => {
    console.error("Erro ao processar mensagem recebida:", err);
  });
});
