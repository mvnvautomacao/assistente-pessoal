import { Router } from "express";
import { config } from "../config";
import { handleIncomingMessage } from "../router";

export const webhookRouter = Router();

// Meta chama esse GET uma vez, para validar a URL do webhook.
webhookRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.meta.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

webhookRouter.post("/webhook", (req, res) => {
  // Responde 200 imediatamente: a Meta reenvia o webhook se demorar/der erro.
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return;

  handleIncomingMessage(message).catch((err) => {
    console.error("Erro ao processar mensagem recebida:", err);
  });
});
