import { db } from "../db";

export interface AllowedNumber {
  from_number: string;
  note: string | null;
  added_at: string;
}

export function isNumberAllowed(fromNumber: string): boolean {
  const row = db.prepare(`SELECT 1 FROM allowed_numbers WHERE from_number = ?`).get(fromNumber);
  return !!row;
}

export function allowNumber(fromNumber: string, note?: string) {
  db.prepare(
    `INSERT INTO allowed_numbers (from_number, note, added_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(from_number) DO UPDATE SET note = excluded.note`
  ).run(fromNumber, note ?? null);
}

export function revokeNumber(fromNumber: string): boolean {
  const result = db.prepare(`DELETE FROM allowed_numbers WHERE from_number = ?`).run(fromNumber);
  return result.changes > 0;
}

export function listAllowedNumbers(): AllowedNumber[] {
  return db.prepare(`SELECT * FROM allowed_numbers ORDER BY added_at DESC`).all() as unknown as AllowedNumber[];
}
