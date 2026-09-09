// Trava simples de forca bruta pro login do /admin -- mesmo espirito do
// access/rateLimit.ts (contador em memoria, sem dependencia externa), so que
// por chave livre (aqui, IP) em vez de numero de WhatsApp.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Attempts {
  count: number;
  lockedUntil?: number;
}

const attempts = new Map<string, Attempts>();

export function isLoginLocked(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry?.lockedUntil) return false;
  if (Date.now() >= entry.lockedUntil) {
    attempts.delete(key);
    return false;
  }
  return true;
}

export function recordFailedLogin(key: string) {
  const entry = attempts.get(key) ?? { count: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  attempts.set(key, entry);
}

export function recordSuccessfulLogin(key: string) {
  attempts.delete(key);
}
