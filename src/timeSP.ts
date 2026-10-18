// Utilitarios de data anclados em America/Sao_Paulo, independente do fuso do servidor
// (importante pro cron: se o container roda em UTC, "hoje"/"ultimo dia do mes" calculado
// com Date local do processo pode dar diferenca de horas perto da virada do dia).

const spDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const spWeekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
const spTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_TO_NUMBER: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// "YYYY-MM-DD" no calendario de Sao Paulo
export function spDateString(d: Date = new Date()): string {
  return spDateFormatter.format(d);
}

// 0=domingo .. 6=sabado, igual Date.getDay(), mas calculado no fuso de Sao Paulo
export function spDayOfWeek(d: Date = new Date()): number {
  return WEEKDAY_TO_NUMBER[spWeekdayFormatter.format(d)];
}

// "HH:MM" (24h) no relogio de Sao Paulo, independente do fuso do servidor.
export function spTimeString(d: Date = new Date()): string {
  return spTimeFormatter.format(d);
}

export function isLastDayOfMonthSP(d: Date = new Date()): boolean {
  const [y, m, day] = spDateString(d).split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, day + 1));
  return nextDay.getUTCMonth() !== m - 1;
}

// "YYYY-MM-DD" + N dias (N pode ser negativo) -- pura aritmetica de calendario
// (sem fuso nenhum de verdade envolvido, so soma dias corridos numa data-calendario).
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
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
  // so data, sem hora nenhuma (ex: a IA nao achou horario na mensagem) -- soma
  // "-03:00" direto na data quebraria o formato ISO (vira "2026-09-10-03:00",
  // Invalid Date). Assume meia-noite nesse caso.
  if (!iso.includes("T")) return `${iso}T00:00:00-03:00`;
  return `${iso}-03:00`;
}

// ---- dia efetivo do mes (Card 16, RN12) ----------------------------------------------------------------------
// UMA implementacao da regra "dia 31 num mes de 30 dias cai no ultimo dia": usada pelo gasto fixo, pelo alerta de
// conta, pelo cadastro de recorrencia e pelo ajuste de data inexistente de lembrete e evento.

// quantos dias tem o mes (month de 1 a 12); considera ano bissexto
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// dia em que "todo dia N" cai no mes "YYYY-MM" (ou numa data "YYYY-MM-DD"): min(N, dias do mes)
export function effectiveDayOfMonth(dayOfMonth: number, yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  return Math.min(dayOfMonth, daysInMonth(year, month));
}

// o cadastro dizia dia N e o disparo caiu antes (hoje e o ultimo dia de um mes mais curto)? Devolve N, senao null (RN17).
export function monthEndShiftFrom(dayOfMonth: number, todayDate: string): number | null {
  const [year, month, day] = todayDate.split("-").map(Number);
  return dayOfMonth > day && day === daysInMonth(year, month) ? dayOfMonth : null;
}

const MONTH_NAMES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthNamePt(month: number): string {
  return MONTH_NAMES_PT[month - 1];
}

export interface ClampResult {
  iso: string; // a data (e hora) a gravar, no mesmo formato da entrada
  adjusted: boolean;
  warning?: string; // texto pronto pro usuario ("Abril so tem 30 dias, ...")
  from?: string; // data pedida (YYYY-MM-DD)
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const shortDate = (month: number, day: number) => `${pad2(day)}/${pad2(month)}`;

// Data unica inexistente no mes (31/04, 30/02, 29/02 fora de ano bissexto) vira o ULTIMO dia desse mes, com o mesmo
// horario (RN13). Se o momento ajustado ja passou, vale o ultimo dia do PROXIMO mes que tenha o dia pedido (RN14).
// Dia 32+, mes 13+ e texto sem data nao sao tocados. Roda ANTES de ensureBrazilOffset.
export function clampToMonthEnd(isoLocal: string, now: Date = new Date()): ClampResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(isoLocal.trim());
  if (!match) return { iso: isoLocal, adjusted: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const rest = match[4];
  if (month < 1 || month > 12 || day < 1 || day > 31) return { iso: isoLocal, adjusted: false };
  const last = daysInMonth(year, month);
  if (day <= last) return { iso: isoLocal, adjusted: false };

  const build = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}${rest}`;
  const from = `${year}-${pad2(month)}-${pad2(day)}`;
  const monthName = monthNamePt(month);
  const head = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} só tem ${last} dias`;

  let iso = build(year, month, last);
  const moment = rest ? Date.parse(ensureBrazilOffset(iso)) : Date.parse(`${iso}T23:59:59-03:00`);
  if (Number.isFinite(moment) && moment <= now.getTime()) {
    // ja passou: proximo mes (virando o ano em dezembro) com o dia efetivo
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
    iso = build(nextYear, nextMonth, nextDay);
    return {
      iso,
      adjusted: true,
      from,
      warning: `${head}, e o dia ${shortDate(month, last)} já passou, então marquei pro dia ${shortDate(nextMonth, nextDay)}.`,
    };
  }
  return { iso, adjusted: true, from, warning: `${head}, então marquei pro dia ${shortDate(month, last)}.` };
}
