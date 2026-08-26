import { Router } from "express";
import { handleIncomingMessage } from "../router";
import { config } from "../config";

export const webhookRouter = Router();

webhookRouter.post("/webhook", (req, res) => {
  // Se WEBHOOK_SECRET estiver configurado, so aceita chamadas que conhecam o
  // segredo (?secret=... na URL cadastrada na Evolution API via
  // `npm run evolution:webhook -- https://sua-url/webhook?secret=...`).
  // Sem essa variavel (caso de hoje, dev local), o endpoint fica aberto como
  // sempre foi -- nao muda nada ate o segredo ser definido antes de ir pra producao.
  // 404 em vez de 401/403 pra nao revelar que o endpoint existe pra quem nao sabe o segredo.
  if (config.webhookSecret && req.query.secret !== config.webhookSecret) {
    res.sendStatus(404);
    return;
  }

  // Responde 200 imediatamente: evita que a Evolution API fique reenviando o evento.
  res.sendStatus(200);

  const { event, data } = req.body ?? {};
  if (event !== "messages.upsert" || !data || data.key?.fromMe) return;

  handleIncomingMessage(data).catch((err) => {
    console.error("Erro ao processar mensagem recebida:", err);
  });
});
