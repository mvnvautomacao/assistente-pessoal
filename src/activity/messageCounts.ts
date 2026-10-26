// Contagem de mensagens por numero e por mes (SP): o que o cliente mandou (inbound) e o que o bot enviou (outbound).
// Alimenta a coluna "Média de mensagens/mês" dos numeros autorizados no /admin. Contar nunca pode derrubar o atendimento: erros sao engolidos.
import { db } from "../db";
import { daysInMonth, spDateString } from "../timeSP";

export type MessageDirection = "inbound" | "outbound";

export function currentMonthKey(now: Date = new Date(Date.now())): string {
  return spDateString(now).slice(0, 7);
}

// ---- inicio da contagem (Card 22, RN10): guardado uma vez em app_meta, pra tela dizer desde quando os numeros valem ----
export const MESSAGE_COUNTS_SINCE_KEY = "message_counts_since";
// com menos de 30 dias de contagem a tela mostra o total e o periodo, nao uma media mensal (RN12)
export const RECENT_COUNT_DAYS = 30;

export interface CountSince {
  date: string; // YYYY-MM-DD (SP)
  approximate: boolean; // dados anteriores ao registro do inicio: vale o dia 1 do menor mes com registro
}

function parseSince(value: string): CountSince {
  return value.startsWith("~") ? { date: value.slice(1), approximate: true } : { date: value, approximate: false };
}

// Le o inicio SEM escrever (a tela do admin e uma leitura). Sem a data gravada mas com contagens de antes deste card, devolve o dia 1 do menor
// mes (aproximado); quem grava e o recordMessage, na primeira mensagem.
export function getMessageCountsSince(): CountSince | null {
  const stored = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(MESSAGE_COUNTS_SINCE_KEY) as { value: string } | undefined;
  if (stored) return parseSince(stored.value);
  const first = db.prepare(`SELECT MIN(month) AS month FROM message_counts`).get() as { month: string | null };
  return first.month ? { date: `${first.month}-01`, approximate: true } : null;
}

// depois de gravado, nao precisa reler a cada mensagem
let sinceEnsured = false;

export function resetMessageCountsCacheForTests() {
  sinceEnsured = false;
}

// antes da primeira contagem nova: fixa o inicio (aproximado se ja havia dados; senao, hoje)
function ensureSince(now: Date) {
  if (sinceEnsured) return;
  const existing = getMessageCountsSince();
  const value = existing ? `${existing.approximate ? "~" : ""}${existing.date}` : spDateString(now);
  db.prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)`).run(MESSAGE_COUNTS_SINCE_KEY, value);
  sinceEnsured = true;
}

export function recordMessage(fromNumber: string, direction: MessageDirection, now: Date = new Date(Date.now())) {
  const column = direction === "inbound" ? "inbound" : "outbound";
  try {
    ensureSince(now);
    db.prepare(
      `INSERT INTO message_counts (from_number, month, ${column}) VALUES (?, ?, 1)
       ON CONFLICT(from_number, month) DO UPDATE SET ${column} = ${column} + 1`
    ).run(fromNumber, currentMonthKey(now));
  } catch (err) {
    console.error("Erro ao contar mensagem:", err);
  }
}

export interface MessageStats {
  inbound: number;
  outbound: number;
  months: number; // do primeiro mes com registro ate o mes atual, inclusive
  avgInbound: number;
  avgOutbound: number;
  avgTotal: number;
}

// meses entre dois "YYYY-MM", contando os dois (2026-08 ate 2026-10 = 3)
export function monthsSpan(firstMonth: string, lastMonth: string): number {
  const [fy, fm] = firstMonth.split("-").map(Number);
  const [ly, lm] = lastMonth.split("-").map(Number);
  return Math.max(1, (ly - fy) * 12 + (lm - fm) + 1);
}

// Media por mes = total / meses decorridos desde o primeiro registro ate o mes atual (o mes em andamento conta inteiro, entao no
// primeiro mes a media e o total ate agora). Numero sem nenhum registro nao entra no mapa.
export function getMessageStats(now: Date = new Date(Date.now())): Map<string, MessageStats> {
  const rows = db
    .prepare(`SELECT from_number, SUM(inbound) AS inbound, SUM(outbound) AS outbound, MIN(month) AS first_month FROM message_counts GROUP BY from_number`)
    .all() as unknown as { from_number: string; inbound: number; outbound: number; first_month: string }[];
  const thisMonth = currentMonthKey(now);
  const stats = new Map<string, MessageStats>();
  for (const row of rows) {
    const months = monthsSpan(row.first_month, thisMonth);
    stats.set(row.from_number, {
      inbound: row.inbound,
      outbound: row.outbound,
      months,
      avgInbound: row.inbound / months,
      avgOutbound: row.outbound / months,
      avgTotal: (row.inbound + row.outbound) / months,
    });
  }
  return stats;
}

// "42" / "3,5" (uma casa so quando nao e inteiro)
export function formatAverage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

// "2026-10-20" -> "20/10/2026"; aproximado: "~01/10/2026"
export function formatSince(since: CountSince): string {
  const [year, month, day] = since.date.split("-");
  return `${since.approximate ? "~" : ""}${day}/${month}/${year}`;
}

// quantos dias tem o mes de uma data YYYY-MM-DD
function monthLength(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return daysInMonth(year, month);
}

// dias de calendario entre duas datas YYYY-MM-DD
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / (24 * 60 * 60 * 1000));
}

// Texto acima da tabela e no cabecalho da coluna (RN10)
export function sinceNotice(since: CountSince | null): string {
  if (!since) return "A contagem de mensagens começa na próxima mensagem (não há histórico anterior).";
  return since.approximate
    ? `Contagem de mensagens iniciada por volta de ${formatSince(since)} (data aproximada; não há histórico anterior).`
    : `Contagem de mensagens iniciada em ${formatSince(since)} (não há histórico anterior).`;
}

// celula da coluna (RN11, RN12): nunca "—". Sem mensagens, "0" em cinza com o tooltip do inicio da contagem; com menos de 30 dias de
// contagem, "42 em 5 dias" (total e periodo); com 30 dias ou mais, a media "42/mês". Embaixo, "cliente 20 · bot 22".
export function renderMessageAverageCell(stats: MessageStats | undefined, since: CountSince | null = null, today: string = spDateString(new Date(Date.now()))): string {
  if (!stats) {
    const tip = `Nenhuma mensagem desde o início da contagem${since ? ` (${formatSince(since)})` : ""}`;
    return `<span style="color:var(--muted)" title="${tip}">0</span>`;
  }
  const muted = (text: string) => `<br><span style="color:var(--muted);font-size:0.8em">${text}</span>`;
  // Data aproximada (dia 1 do menor mes): a contagem comecou em algum dia daquele mes, entao so ha garantia de periodo a partir do FIM dele.
  // A media mensal so entra quando essa garantia chega a 30 dias; ate la, o periodo e mostrado como "ate N dias".
  const upperDays = since ? daysBetween(since.date, today) : null;
  const guaranteedDays = since ? (since.approximate ? daysBetween(`${since.date.slice(0, 7)}-${String(monthLength(since.date)).padStart(2, "0")}`, today) : upperDays) : null;
  if (since && upperDays !== null && guaranteedDays !== null && guaranteedDays < RECENT_COUNT_DAYS) {
    const days = Math.max(1, upperDays);
    const tip = `Total: ${stats.inbound} do cliente + ${stats.outbound} do bot desde ${formatSince(since)}. Com menos de ${RECENT_COUNT_DAYS} dias de contagem não mostro média mensal.`;
    return `<span title="${tip}">${stats.inbound + stats.outbound} em ${since.approximate ? "até " : ""}${days} ${days === 1 ? "dia" : "dias"}</span>${muted(`cliente ${stats.inbound} · bot ${stats.outbound}`)}`;
  }
  const tip = `Total: ${stats.inbound} do cliente + ${stats.outbound} do bot em ${stats.months} mês(es) (desde o primeiro registro; o mês em andamento conta inteiro)`;
  return `<span title="${tip}">${formatAverage(stats.avgTotal)}/mês</span>${muted(`cliente ${formatAverage(stats.avgInbound)} · bot ${formatAverage(stats.avgOutbound)}`)}`;
}
