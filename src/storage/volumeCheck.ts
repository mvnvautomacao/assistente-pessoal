// Verificacao do volume persistente do banco (Card 22, RN14 a RN17). O SQLite so sobrevive a um deploy se a pasta do banco for um volume
// montado (no Coolify: Storages -> /app/data). O codigo nao cria o volume, mas percebe quando ele falta: em container, se a pasta do banco
// esta no MESMO dispositivo de disco que "/", ela mora no sistema de arquivos efemero do container. checkDataVolume e pura (recebe o
// dispositivo por parametro); so runStartupVolumeCheck toca o disco, e nunca lanca nem bloqueia a subida.
import { existsSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";

export const EXPECTED_DATA_DIR = "/app/data";

export type VolumeStatus = "ok" | "no_volume" | "wrong_path" | "not_applicable" | "unknown";

export interface VolumeCheck {
  status: VolumeStatus;
  dbPath: string;
  detail: string;
  freshDatabase?: boolean; // o arquivo do banco foi criado (vazio) nesta subida
}

export interface VolumeCheckInput {
  dbPath: string; // caminho absoluto do arquivo do banco
  rootPath?: string; // raiz do sistema de arquivos do container (padrao "/")
  inContainer: boolean;
  deviceOf: (path: string) => number; // stat.dev de uma pasta (injetado: o teste nao precisa de container)
  freshDatabase?: boolean;
}

export function checkDataVolume(input: VolumeCheckInput): VolumeCheck {
  const { dbPath } = input;
  if (!input.inContainer) return { status: "not_applicable", dbPath, detail: "fora de container (desenvolvimento): verificação não se aplica" };
  const dir = posix.dirname(dbPath);
  const freshDatabase = input.freshDatabase === true;
  try {
    // a pasta do banco no mesmo disco que "/" e sem volume, em qualquer caminho
    if (input.deviceOf(dir) === input.deviceOf(input.rootPath ?? "/")) {
      return { status: "no_volume", dbPath, freshDatabase, detail: `${dir} está no mesmo disco do container (sem volume persistente montado)` };
    }
    // ha volume, mas fora do caminho documentado: so informa (pode ser um volume legitimo em outro lugar)
    if (dir !== EXPECTED_DATA_DIR) {
      return { status: "wrong_path", dbPath, freshDatabase, detail: `${dir} é um volume montado, mas o documentado é ${EXPECTED_DATA_DIR}` };
    }
    return { status: "ok", dbPath, freshDatabase, detail: `${dir} é um volume montado separado do container` };
  } catch (err) {
    return { status: "unknown", dbPath, freshDatabase, detail: `não foi possível verificar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// o que merece alerta (RN16): so a falta de volume; volume em outro caminho apenas informa
export function needsVolumeAlert(check: VolumeCheck): boolean {
  return check.status === "no_volume";
}

// banco criado vazio nesta subida (em container): primeira instalacao ou DB_PATH/volume trocado; o arquivo antigo nao e migrado sozinho
export function freshDatabaseText(check: VolumeCheck): string | null {
  if (!check.freshDatabase || check.status === "not_applicable") return null;
  return `ℹ️ O banco (${check.dbPath}) foi criado vazio nesta subida. Se você esperava encontrar dados, confira o DB_PATH e o volume em ${EXPECTED_DATA_DIR}: um caminho novo começa um banco novo, e o arquivo antigo não é migrado sozinho.`;
}

// texto do aviso vermelho do /admin e da mensagem ao dono (RN16)
export function volumeWarningText(check: VolumeCheck): string {
  return `⚠️ O banco (${check.dbPath}) não está em volume persistente. A cada deploy, mensagens contadas, rotinas, lembretes e pendências se perdem. No Coolify: Storages → volume persistente em ${EXPECTED_DATA_DIR}.`;
}

// linha discreta do /admin quando esta tudo certo, ou o motivo de nao ter verificado
export function volumeInfoText(check: VolumeCheck): string | null {
  if (check.status === "ok") return `Banco: ${check.dbPath} · volume persistente verificado`;
  if (check.status === "wrong_path") return `Banco: ${check.dbPath} · volume montado, mas fora de ${EXPECTED_DATA_DIR} (confira se é o volume persistente)`;
  if (check.status === "unknown") return `Banco: ${check.dbPath} · volume não verificado (${check.detail})`;
  return null; // not_applicable: nada a mostrar
}

let current: VolumeCheck | null = null;

export function getVolumeStatus(): VolumeCheck | null {
  return current;
}

export function setVolumeStatusForTests(check: VolumeCheck | null) {
  current = check;
}

// Chamada na subida. Nunca lanca (RN17): qualquer falha vira status "unknown" com o motivo.
export function runStartupVolumeCheck(
  dbPath: string,
  inContainer: boolean = existsSync("/.dockerenv"),
  deviceOf: (path: string) => number = (path) => statSync(path).dev,
  freshDatabase: boolean = false
): VolumeCheck {
  let absolute = dbPath;
  try {
    absolute = dbPath.startsWith("/") ? posix.normalize(dbPath) : resolve(dbPath).replace(/\\/g, "/");
    current = checkDataVolume({ dbPath: absolute, inContainer, deviceOf, freshDatabase });
  } catch (err) {
    current = { status: "unknown", dbPath: absolute, detail: `não foi possível verificar: ${err instanceof Error ? err.message : String(err)}` };
  }
  return current;
}
