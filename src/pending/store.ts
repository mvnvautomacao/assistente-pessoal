// Armazenamento persistente (SQLite) do estado de conversa: confirmacoes de edicao,
// escolha de item, menu guiado e desfazer. Antes cada um vivia num Map em memoria e
// um reinicio/deploy do servidor apagava tudo. Interface pequena e generica -- os
// demais pendentes podem migrar pra ca depois sem mudar nada aqui.
//
// Regras: no maximo UMA linha por (numero, tipo); a leitura sempre vai ao banco (sem
// cache proprio); pendencia vencida nao e apagada na leitura -- fica por uma janela
// (EXPIRED_NOTICE_WINDOW_MS) so pra o bot poder explicar que expirou (ver
// expiredNotice.ts) e depois a limpeza (purgeOld) remove.
import { db } from "../db";

// tipos de pendencia guardados aqui (RN01)
export type PendingKind =
  | "edit_expense"
  | "edit_event"
  | "edit_reminder"
  | "edit_recurring"
  | "edit_income"
  | "delete_income"
  | "field_menu"
  | "target_choice"
  | "edit_target"
  | "undo";

// quanto tempo depois do vencimento a linha ainda existe so pro aviso de expiracao
export const EXPIRED_NOTICE_WINDOW_MS = 60 * 60 * 1000;

export interface StoredPending<T> {
  payload: T;
  label: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface SetPendingOptions {
  payload: unknown;
  label?: string;
  ttlMs: number;
  version: number;
  now?: number;
}

// o payload vira JSON: Date, Map, Set e funcoes nao sobrevivem (virariam {} ou sumiriam)
// e esconderiam um bug so depois de um reinicio -- por isso sao rejeitados ja na gravacao.
export function assertSerializable(value: unknown, path = "payload"): void {
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === "function" || type === "symbol" || type === "bigint") throw new Error(`${path}: tipo "${type}" nao e serializavel`);
  if (type === "number" && !Number.isFinite(value as number)) throw new Error(`${path}: numero nao finito`);
  if (type !== "object") return;
  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throw new Error(`${path}: ${(value as object).constructor.name} nao e serializavel (use string ISO ou epoch ms)`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertSerializable(item, `${path}[${idx}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) assertSerializable(child, `${path}.${key}`);
}

function logStoreError(message: string, kind: string, err?: unknown) {
  // sem o payload (pode ter texto do usuario): so o tipo e o motivo
  console.error(`[pending] ${message} (tipo=${kind})`, err instanceof Error ? err.message : err ?? "");
}

// Grava (ou substitui) a pendencia. Nunca lanca: uma falha vira log e o fluxo segue
// sem pendencia -- o usuario cai na mensagem normal de "nao achei o que confirmar".
export function setPending(fromNumber: string, kind: PendingKind, options: SetPendingOptions): void {
  const now = options.now ?? Date.now();
  try {
    assertSerializable(options.payload);
    db.prepare(
      `INSERT OR REPLACE INTO pending_state (from_number, kind, payload, version, label, created_at, expires_at, expired_notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(fromNumber, kind, JSON.stringify(options.payload), options.version, options.label ?? null, now, now + options.ttlMs);
  } catch (err) {
    logStoreError("falha ao gravar pendencia", kind, err);
  }
}

interface Row {
  payload: string;
  version: number;
  label: string | null;
  created_at: number;
  expires_at: number;
}

// Pendencia ATIVA (nao vencida) ou null. Versao diferente ou JSON invalido: descarta com log.
export function getPending<T>(fromNumber: string, kind: PendingKind, version: number, now: number = Date.now()): StoredPending<T> | null {
  let row: Row | undefined;
  try {
    row = db
      .prepare(`SELECT payload, version, label, created_at, expires_at FROM pending_state WHERE from_number = ? AND kind = ?`)
      .get(fromNumber, kind) as Row | undefined;
  } catch (err) {
    logStoreError("falha ao ler pendencia", kind, err);
    return null;
  }
  if (!row) return null;
  if (row.expires_at < now) return null; // vencida: fica guardada so pro aviso de expiracao
  if (row.version !== version) {
    logStoreError(`versao ${row.version} descartada (atual ${version})`, kind);
    clearPending(fromNumber, kind);
    return null;
  }
  try {
    return { payload: JSON.parse(row.payload) as T, label: row.label, createdAt: row.created_at, expiresAt: row.expires_at };
  } catch (err) {
    logStoreError("JSON invalido descartado", kind, err);
    clearPending(fromNumber, kind);
    return null;
  }
}

export function clearPending(fromNumber: string, kind: PendingKind): void {
  try {
    db.prepare(`DELETE FROM pending_state WHERE from_number = ? AND kind = ?`).run(fromNumber, kind);
  } catch (err) {
    logStoreError("falha ao apagar pendencia", kind, err);
  }
}

export function clearAllPending(fromNumber: string): void {
  try {
    db.prepare(`DELETE FROM pending_state WHERE from_number = ?`).run(fromNumber);
  } catch (err) {
    logStoreError("falha ao apagar pendencias do numero", "*", err);
  }
}

export interface ExpiredPending {
  kind: PendingKind;
  label: string | null;
  expiresAt: number;
}

// Pendencias VENCIDAS (dentro da janela de aviso) ainda nao avisadas, a mais recente primeiro.
export function findExpiredUnnotified(fromNumber: string, now: number = Date.now()): ExpiredPending[] {
  try {
    const rows = db
      .prepare(
        `SELECT kind, label, expires_at FROM pending_state
         WHERE from_number = ? AND expired_notified = 0 AND expires_at < ? AND expires_at >= ?
         ORDER BY expires_at DESC`
      )
      .all(fromNumber, now, now - EXPIRED_NOTICE_WINDOW_MS) as { kind: PendingKind; label: string | null; expires_at: number }[];
    return rows.map((r) => ({ kind: r.kind, label: r.label, expiresAt: r.expires_at }));
  } catch (err) {
    logStoreError("falha ao ler pendencias vencidas", "*", err);
    return [];
  }
}

// marca TODAS as vencidas do numero como avisadas (um segundo "1" nao gera outro aviso)
export function markExpiredNotified(fromNumber: string, now: number = Date.now()): void {
  try {
    db.prepare(`UPDATE pending_state SET expired_notified = 1 WHERE from_number = ? AND expires_at < ?`).run(fromNumber, now);
  } catch (err) {
    logStoreError("falha ao marcar pendencias avisadas", "*", err);
  }
}

// Apaga o que venceu ha mais que a janela de aviso. Devolve quantas linhas removeu.
export function purgeOld(now: number = Date.now()): number {
  try {
    const result = db.prepare(`DELETE FROM pending_state WHERE expires_at < ?`).run(now - EXPIRED_NOTICE_WINDOW_MS);
    return Number(result.changes);
  } catch (err) {
    logStoreError("falha na limpeza", "*", err);
    return 0;
  }
}

// so pra testes: esvazia a tabela inteira
export function resetPendingStoreForTests(): void {
  db.exec(`DELETE FROM pending_state`);
}
