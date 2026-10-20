// Na subida (Card 22, RN16): confere o volume do banco; sem volume persistente ou fora de /app/data, registra no console e avisa o dono
// por WhatsApp (uma vez por hora, pelo cooldown de ownerAlert). Nunca bloqueia a subida nem lanca para fora (RN17).
import { shouldAlertOwner } from "../access/ownerAlert";
import { config } from "../config";
import { sendText } from "../whatsapp/client";
import { needsVolumeAlert, runStartupVolumeCheck, volumeWarningText, type VolumeCheck } from "./volumeCheck";

export interface VolumeAlertOptions {
  dbPath?: string;
  inContainer?: boolean;
  deviceOf?: (path: string) => number;
  send?: (to: string, text: string) => Promise<unknown>;
  ownerNumber?: string;
}

export async function checkVolumeAtStartup(options: VolumeAlertOptions = {}): Promise<VolumeCheck> {
  const check = runStartupVolumeCheck(options.dbPath ?? config.dbPath, options.inContainer, options.deviceOf);
  try {
    if (check.status === "unknown") console.warn(`Volume do banco não verificado: ${check.detail}`);
    if (!needsVolumeAlert(check)) return check;
    console.error(`${volumeWarningText(check)} (${check.detail})`);
    if (shouldAlertOwner("volume-sem-persistencia")) {
      const send = options.send ?? sendText;
      await send(options.ownerNumber ?? config.myWhatsappNumber, volumeWarningText(check));
    }
  } catch (err) {
    console.error("Erro ao avisar o dono sobre o volume do banco:", err);
  }
  return check;
}
