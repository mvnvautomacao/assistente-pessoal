// Utilitarios de data anclados em America/Sao_Paulo, independente do fuso do servidor
// (importante pro cron: se o container roda em UTC, "hoje"/"ultimo dia do mes" calculado
// com Date local do processo pode dar diferenca de horas perto da virada do dia).

const spDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const spWeekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });

const WEEKDAY_TO_NUMBER: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// "YYYY-MM-DD" no calendario de Sao Paulo
export function spDateString(d: Date = new Date()): string {
  return spDateFormatter.format(d);
}

// 0=domingo .. 6=sabado, igual Date.getDay(), mas calculado no fuso de Sao Paulo
export function spDayOfWeek(d: Date = new Date()): number {
  return WEEKDAY_TO_NUMBER[spWeekdayFormatter.format(d)];
}

export function isLastDayOfMonthSP(d: Date = new Date()): boolean {
  const [y, m, day] = spDateString(d).split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, day + 1));
  return nextDay.getUTCMonth() !== m - 1;
}
