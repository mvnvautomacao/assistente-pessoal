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

// A IA devolve horario de evento/lembrete em ISO local de Brasilia (instruida no
// system prompt), mas as vezes sem o offset explicito (ex: "2026-08-27T15:00:00"
// em vez de "...T15:00:00-03:00"). Sem o offset, new Date(str) e o datetime() do
// SQLite tratam a string como se ja fosse UTC -- funciona por acaso num dev local
// configurado em America/Sao_Paulo, mas em producao (container roda em UTC) isso
// adianta todo evento/lembrete em 3h (ex: "15h" vira "12h" na tela). Garante o
// offset -03:00 quando a IA nao mandar um explicito, pra funcionar igual em
// qualquer timezone de servidor.
export function ensureBrazilOffset(iso: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(iso)) return iso;
  return `${iso}-03:00`;
}
