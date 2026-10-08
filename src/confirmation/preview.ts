// Mensagens da confirmacao de edicao: previa "antes -> depois" com opcoes
// numeradas 1/2/3, e as perguntas do estado "aguardando correcao". Tudo funcao
// pura que devolve texto.

export interface PreviewChange {
  label: string;
  from: string;
  to: string;
}

export const PREVIEW_OPTIONS = "1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar";

export const NOT_UNDERSTOOD_TEXT = "Não entendi 🤔 Responde *1* pra confirmar, *2* pra corrigir ou *3* pra cancelar.";

// "R$ 38,00", "R$ 1.500,50"
export function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "2026-10-07" (data-calendario pura) -> "07/10"
export function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.slice(0, 10).split("-");
  return `${day}/${month}`;
}

const whenFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// ISO com horario -> "sex 10/10 às 14:00" (fuso de Sao Paulo)
export function formatWhen(iso: string): string {
  const parts = Object.fromEntries(whenFormatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday ?? "").replace(".", "");
  return `${weekday} ${parts.day}/${parts.month} às ${parts.hour}:${parts.minute}`;
}

export function formatEditPreview(header: string, changes: PreviewChange[]): string {
  const lines = changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("\n");
  return `✏️ ${header}\n${lines}\n\n${PREVIEW_OPTIONS}`;
}

// "Mercado — R$ 38,00 · 07/10 · Pix" (forma de pagamento so se houver)
export function expenseHeader(params: { description: string; amount: number; date: string; paymentMethodName?: string | null }): string {
  const parts = [`${params.description} — ${formatBRL(params.amount)}`, formatShortDate(params.date)];
  if (params.paymentMethodName) parts.push(params.paymentMethodName);
  return parts.join(" · ");
}

// "Academia — R$ 89,90 · todo dia 5"
export function recurringHeader(params: { description: string; amount: number; dayOfMonth: number }): string {
  return `${params.description} — ${formatBRL(params.amount)} · todo dia ${params.dayOfMonth}`;
}

export type CorrectionKind = "amount" | "date" | "datetime" | "day" | "lead" | "text";

// pergunta feita quando o usuario escolhe a opcao 2 (corrigir). "noun" so muda
// a palavra nas perguntas de texto ("nome", "categoria", "forma de pagamento"...).
export function correctionQuestion(kind: CorrectionKind, noun = "nome"): string {
  switch (kind) {
    case "amount":
      return "Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.";
    case "datetime":
      return "Qual é a data e hora certas? (ex: sexta às 16h) Ou responde *cancelar*.";
    case "date":
      return "Qual é a data certa? (ex: sexta ou 15/10) Ou responde *cancelar*.";
    case "day":
      return "Qual é o dia do mês certo? (1 a 31) Ou responde *cancelar*.";
    case "lead":
      return "Quanto tempo antes devo avisar? (ex: 30 minutos, 2 horas, 1 dia) Ou responde *cancelar*.";
    default: {
      const feminine = noun === "categoria" || noun === "forma de pagamento" || noun === "descrição";
      return `Qual é ${feminine ? "a" : "o"} nov${feminine ? "a" : "o"} ${noun}? Ou responde *cancelar*.`;
    }
  }
}

// repete a pergunta quando o valor da correcao nao serviu, com o motivo
export function correctionRetry(reason: string, kind: CorrectionKind, noun = "nome"): string {
  return `${reason}\n${correctionQuestion(kind, noun)}`;
}
