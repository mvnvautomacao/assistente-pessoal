// Card 21 (D-12, RN17): por quantos dias o activity_log e guardado. Funcao pura (sem banco nem config) pra config.ts poder usar.
export const DEFAULT_ACTIVITY_LOG_RETENTION_DAYS = 90;

// "90" -> 90; "0" -> 0 (desligado: guarda tudo); vazio, negativo, decimal ou texto -> 90
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
  const days = Number(raw.trim());
  return Number.isSafeInteger(days) ? days : DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
}

export function retentionLabel(days: number): string {
  return days > 0 ? `${days} dias` : "sem limite (limpeza desligada)";
}
