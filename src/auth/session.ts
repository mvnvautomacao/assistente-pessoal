import { randomBytes } from "crypto";

// Sessao de login (dashboard e /admin): token opaco aleatorio, guardado num Map
// em memoria server-side -- mesma ideia dos outros caches efemeros do projeto
// (pendingUndo.ts, pendingCompletion.ts), sem precisar de express-session nem
// tabela de sessao no banco. Perder o Map num redeploy so desloga todo mundo,
// que e um custo aceitavel pra esse porte de projeto.
export type SessionData = { type: "dashboard"; phone: string } | { type: "admin" };

interface SessionEntry {
  data: SessionData;
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();

export function createSession(data: SessionData, ttlMs: number): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { data, expiresAt: Date.now() + ttlMs });
  return token;
}

export function getSession(token: string | undefined): SessionData | null {
  if (!token) return null;
  const entry = sessions.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return entry.data;
}

export function destroySession(token: string | undefined) {
  if (token) sessions.delete(token);
}

// Usado ao revogar o acesso de um numero ao dashboard pelo /admin (ver
// deleteDashboardAccount) -- sem isso, uma sessao ja aberta (valida por ate 30
// dias) continuaria funcionando normalmente mesmo depois da conta ser
// apagada, ja que a sessao em si nao checa a tabela dashboard_accounts de novo.
export function destroyDashboardSessionsForPhone(phone: string) {
  for (const [token, entry] of sessions) {
    if (entry.data.type === "dashboard" && entry.data.phone === phone) sessions.delete(token);
  }
}

export const DASHBOARD_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
