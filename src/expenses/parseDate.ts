// Interpretacao e validacao da data digitada ao editar um gasto. Funcoes puras
// (recebem "hoje" por parametro): resolvem os casos comuns sem chamar IA --
// hoje, ontem, anteontem, dd/mm, dd/mm/aa, dd/mm/aaaa, "dia N" e ISO.
import { addDaysToDateString } from "../timeSP";

// janela de datas aceitas: 5 anos pra tras ate 1 ano pra frente
export const DATE_WINDOW_YEARS_BACK = 5;
export const DATE_WINDOW_YEARS_FORWARD = 1;

export type DateParse =
  | { ok: true; date: string } // YYYY-MM-DD
  | { ok: false; reason: "unrecognized" } // nenhum formato casou (quem chamou pode tentar a IA)
  | { ok: false; reason: "invalid" | "out_of_range"; shown: string }; // "shown" = dd/mm/aaaa tentado

export function invalidDateMessage(shown: string): string {
  return `Essa data não parece certa (${shown}). Me manda o dia de novo, ex: 15/10 ou ontem.`;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// "2026-02-28" -> ano +/- N (29/02 vira 28/02 num ano nao bissexto)
function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const ny = y + years;
  const day = isRealDate(ny, m, d) ? d : Math.min(d, new Date(Date.UTC(ny, m, 0)).getUTCDate());
  return `${ny}-${pad(m)}-${pad(day)}`;
}

function finish(year: number, month: number, day: number, today: string): DateParse {
  const shown = `${pad(day)}/${pad(month)}/${year}`;
  if (!isRealDate(year, month, day)) return { ok: false, reason: "invalid", shown };
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  if (iso < shiftYears(today, -DATE_WINDOW_YEARS_BACK) || iso > shiftYears(today, DATE_WINDOW_YEARS_FORWARD)) {
    return { ok: false, reason: "out_of_range", shown };
  }
  return { ok: true, date: iso };
}

// confere uma data ISO ja pronta (ex: vinda da IA) -- existe e esta na janela
export function validateExpenseDate(date: string, today: string): DateParse {
  const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { ok: false, reason: "unrecognized" };
  return finish(Number(match[1]), Number(match[2]), Number(match[3]), today);
}

export function parseExpenseDate(text: string, today: string): DateParse {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;]+$/g, "")
    .replace(/\s+/g, " ");

  if (t === "hoje") return finish(...splitIso(today), today);
  if (t === "ontem") return finish(...splitIso(addDaysToDateString(today, -1)), today);
  if (t === "anteontem") return finish(...splitIso(addDaysToDateString(today, -2)), today);

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return validateExpenseDate(t, today);

  const dm = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (dm) {
    const [ty] = splitIso(today);
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : ty;
    return finish(year, Number(dm[2]), Number(dm[1]), today);
  }

  const dayOnly = t.match(/^dia (\d{1,2})$/);
  if (dayOnly) {
    const [ty, tm, td] = splitIso(today);
    const n = Number(dayOnly[1]);
    // "dia N" = dia N do mes atual; se N ainda nao chegou, e do mes anterior
    if (n <= td) return finish(ty, tm, n, today);
    return tm === 1 ? finish(ty - 1, 12, n, today) : finish(ty, tm - 1, n, today);
  }

  return { ok: false, reason: "unrecognized" };
}

function splitIso(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}
