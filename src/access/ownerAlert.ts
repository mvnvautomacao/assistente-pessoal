// Evita alertar o dono repetidamente pro mesmo motivo (ex: o mesmo numero
// bloqueado mandando varias mensagens seguidas) -- um alerta por chave a cada
// hora e suficiente pra avisar sem virar spam no proprio numero do dono.
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const lastAlertedAt = new Map<string, number>();

export function shouldAlertOwner(key: string): boolean {
  const last = lastAlertedAt.get(key);
  const now = Date.now();
  if (last && now - last < ALERT_COOLDOWN_MS) return false;
  lastAlertedAt.set(key, now);
  return true;
}

// so pra testes: mesmo motivo do resetRateLimitForTests em rateLimit.ts.
export function resetOwnerAlertForTests() {
  lastAlertedAt.clear();
}
