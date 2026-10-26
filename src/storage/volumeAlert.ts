// Na subida (Card 22, RN16): confere o volume do banco; sem volume persistente (ou com o banco recem-criado vazio), registra no console e avisa o
// dono por WhatsApp (uma vez por hora). O status fica pronto na hora (o /admin le dele); o WhatsApp espera a Evolution API subir e tenta de novo
// se falhar, sem gastar o cooldown em tentativa que nao chegou. Nunca bloqueia a subida nem lanca para fora (RN17).
import { releaseOwnerAlert, shouldAlertOwner } from "../access/ownerAlert";
import { config } from "../config";
import { databaseCreatedAtStartup } from "../db";
import { INITIAL_CATCHUP_DELAY_MS } from "../scheduler/dailyJobs";
import { sendText } from "../whatsapp/client";
import { freshDatabaseText, needsVolumeAlert, runStartupVolumeCheck, volumeWarningText, type VolumeCheck } from "./volumeCheck";

export const VOLUME_ALERT_ATTEMPTS = 3;
export const VOLUME_ALERT_RETRY_MS = 60 * 1000;

export interface VolumeAlertOptions {
  dbPath?: string;
  inContainer?: boolean;
  deviceOf?: (path: string) => number;
  freshDatabase?: boolean;
  send?: (to: string, text: string) => Promise<unknown>;
  ownerNumber?: string;
  initialDelayMs?: number; // espera antes do 1o envio (a Evolution API precisa estar de pe)
  retryDelayMs?: number;
  attempts?: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// manda com nova tentativa; o cooldown de 1h so vale se algum envio saiu (falha total libera a chave)
async function alertOwner(key: string, text: string, options: VolumeAlertOptions) {
  if (!shouldAlertOwner(key)) return;
  const send = options.send ?? sendText;
  const attempts = options.attempts ?? VOLUME_ALERT_ATTEMPTS;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await send(options.ownerNumber ?? config.myWhatsappNumber, text);
      return;
    } catch (err) {
      console.error(`Erro ao avisar o dono sobre o volume do banco (tentativa ${attempt} de ${attempts}):`, err);
      if (attempt < attempts) await sleep(options.retryDelayMs ?? VOLUME_ALERT_RETRY_MS);
    }
  }
  releaseOwnerAlert(key);
}

export async function checkVolumeAtStartup(options: VolumeAlertOptions = {}): Promise<VolumeCheck> {
  const check = runStartupVolumeCheck(options.dbPath ?? config.dbPath, options.inContainer, options.deviceOf, options.freshDatabase ?? databaseCreatedAtStartup);
  try {
    if (check.status === "unknown") console.warn(`Volume do banco não verificado: ${check.detail}`);
    const messages: { key: string; text: string }[] = [];
    if (needsVolumeAlert(check)) {
      console.error(`${volumeWarningText(check)} (${check.detail})`);
      messages.push({ key: "volume-sem-persistencia", text: volumeWarningText(check) });
    }
    const fresh = freshDatabaseText(check);
    if (fresh) {
      console.warn(fresh);
      messages.push({ key: "banco-criado-vazio", text: fresh });
    }
    if (messages.length) await sleep(options.initialDelayMs ?? INITIAL_CATCHUP_DELAY_MS);
    for (const message of messages) await alertOwner(message.key, message.text, options);
  } catch (err) {
    console.error("Erro ao avisar o dono sobre o volume do banco:", err);
  }
  return check;
}
