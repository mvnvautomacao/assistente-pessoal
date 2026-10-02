import { db } from "../db";

export interface BlockedNumber {
  from_number: string;
  note: string | null;
  blocked_at: string;
}

export function isNumberBlocked(fromNumber: string): boolean {
  const row = db.prepare(`SELECT 1 FROM blocked_numbers WHERE from_number = ?`).get(fromNumber);
  return !!row;
}

// Bloquear tira o numero da lista de autorizados tambem -- o bloqueio vale
// mais que a autorizacao (ver isNumberAllowed) e a lista de autorizados nao
// fica mostrando alguem que na pratica nao recebe nada.
export function blockNumber(fromNumber: string, note?: string) {
  db.prepare(
    `INSERT INTO blocked_numbers (from_number, note, blocked_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(from_number) DO UPDATE SET note = excluded.note`
  ).run(fromNumber, note ?? null);
  db.prepare(`DELETE FROM allowed_numbers WHERE from_number = ?`).run(fromNumber);
}

// Desbloquear NAO autoriza de volta: o numero volta pro estado "nao
// autorizado" e o admin precisa aprovar de novo se quiser.
export function unblockNumber(fromNumber: string): boolean {
  const result = db.prepare(`DELETE FROM blocked_numbers WHERE from_number = ?`).run(fromNumber);
  return result.changes > 0;
}

export function listBlockedNumbers(): BlockedNumber[] {
  return db.prepare(`SELECT * FROM blocked_numbers ORDER BY blocked_at DESC`).all() as unknown as BlockedNumber[];
}
