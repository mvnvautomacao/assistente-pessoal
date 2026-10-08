// TTL unico das confirmacoes de edicao pendentes (gasto, categoria de um gasto,
// evento, lembrete e gasto fixo) -- todos os pendingEdit*.ts usam esta mesma
// constante, em vez de cada um ter o seu.
export const EDIT_PENDING_TTL_MS = 10 * 60 * 1000;
