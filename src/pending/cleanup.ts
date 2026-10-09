// Limpeza das pendencias vencidas (RN12): roda uma vez na inicializacao e a cada 10
// minutos. Remove o que venceu ha mais que a janela de aviso de expiracao (60 min), entao
// nenhuma linha vive mais que TTL (10 min) + janela (60 min) = 70 min.
import cron from "node-cron";
import { purgeOld } from "./store";

export function startPendingCleanup() {
  purgeOld();
  cron.schedule("*/10 * * * *", () => {
    purgeOld();
  });
}
