import { db } from "../db";

export interface DashboardAccount {
  phone_number: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_password_sent_at: string | null;
}

export function getDashboardAccount(phoneNumber: string): DashboardAccount | null {
  const row = db.prepare(`SELECT * FROM dashboard_accounts WHERE phone_number = ?`).get(phoneNumber) as DashboardAccount | undefined;
  return row ?? null;
}

// Cria a conta se for a primeira vez, ou so troca a senha se ja existir --
// mesmo caminho serve tanto pro primeiro acesso quanto pro "esqueci a senha"
// (ver Contexto do plano: nunca ha senha escolhida pelo usuario).
export function upsertDashboardPassword(phoneNumber: string, passwordHash: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dashboard_accounts (phone_number, password_hash, created_at, updated_at, last_password_sent_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phone_number) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, last_password_sent_at = excluded.last_password_sent_at`
  ).run(phoneNumber, passwordHash, now, now, now);
}

const RESEND_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora

// Autoatendimento (usuario pedindo pra si mesmo) respeita o limite de 1h;
// reset pelo /admin ignora esse limite (ver sendNewDashboardPassword).
export function canSendPasswordNow(phoneNumber: string): boolean {
  const account = getDashboardAccount(phoneNumber);
  if (!account?.last_password_sent_at) return true;
  return Date.now() - new Date(account.last_password_sent_at).getTime() >= RESEND_COOLDOWN_MS;
}

export function listDashboardAccounts(): DashboardAccount[] {
  return db.prepare(`SELECT * FROM dashboard_accounts ORDER BY created_at DESC`).all() as unknown as DashboardAccount[];
}
