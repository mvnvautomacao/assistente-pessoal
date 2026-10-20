// Contagem de mensagens por numero e por mes (SP): o que o cliente mandou (inbound) e o que o bot enviou (outbound).
// Alimenta a coluna "Média de mensagens/mês" dos numeros autorizados no /admin. Contar nunca pode derrubar o atendimento: erros sao engolidos.
import { db } from "../db";
import { spDateString } from "../timeSP";

export type MessageDirection = "inbound" | "outbound";

export function currentMonthKey(now: Date = new Date(Date.now())): string {
  return spDateString(now).slice(0, 7);
}

export function recordMessage(fromNumber: string, direction: MessageDirection, now: Date = new Date(Date.now())) {
  const column = direction === "inbound" ? "inbound" : "outbound";
  try {
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

// celula da coluna: "—" sem registro; senao "42 /mês" e, embaixo, "cliente 20 · bot 22"
export function renderMessageAverageCell(stats: MessageStats | undefined): string {
  if (!stats) return "—";
  const tip = `Total: ${stats.inbound} do cliente + ${stats.outbound} do bot em ${stats.months} mês(es) (desde o primeiro registro)`;
  return `<span title="${tip}">${formatAverage(stats.avgTotal)}/mês</span><br><span style="color:var(--muted);font-size:0.8em">cliente ${formatAverage(stats.avgInbound)} · bot ${formatAverage(stats.avgOutbound)}</span>`;
}
