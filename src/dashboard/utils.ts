// O WhatsApp guarda numeros brasileiros sem o "9" extra depois do DDD
// (55 + DDD + 9 + numero = 13 digitos vira 12). Quem digita o proprio numero no
// formato normal (com o 9) precisa continuar achando os dados dele mesmo assim.
export function normalizeBrazilPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(digits)) {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "1234.5" -> "1.234,50" — pro valor inicial do campo mascarado (sem o "R$")
export function formatAmountInput(amount: number): string {
  const cents = Math.round(amount * 100);
  const intPart = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centsPart = String(cents % 100).padStart(2, "0");
  return `${intPart},${centsPart}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// "YYYY-MM-DD" no fuso de Sao Paulo, pro valor padrao de inputs type=date
export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const spDateTimeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ISO (qualquer fuso) -> "YYYY-MM-DDTHH:mm" no horario de Sao Paulo,
// pro valor de um input type="datetime-local"
export function toSPDateTimeLocal(iso: string): string {
  const parts = Object.fromEntries(spDateTimeParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// "YYYY-MM-DDTHH:mm" (digitado como horario de Sao Paulo) -> ISO com offset -03:00.
// Brasil nao tem mais horario de verao desde 2019, entao -03:00 vale o ano todo.
export function fromSPDateTimeLocal(value: string): string {
  return `${value}:00-03:00`;
}
