import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVALID_MONTH_TEXT,
  INVALID_RANGE_TEXT,
  MAX_RANGE_DAYS,
  currentMonthRange,
  currentWeekRange,
  lastNDaysRange,
  monthLabel,
  previousMonthRange,
  previousWeekRange,
  relativeDayLabel,
  resolveQueryRange,
  singleDayRange,
} from "../../src/expenses/queryRange";
import { spDateString } from "../../src/timeSP";

const TODAY = "2026-10-14"; // quarta-feira

function range(params: Parameters<typeof resolveQueryRange>[0], today = TODAY) {
  const result = resolveQueryRange(params, today);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

test("periodos nomeados (no fuso de SP): semana = ultimos 7 dias incluindo hoje, mes, mes passado, ultimos N dias", () => {
  assert.deepEqual(currentWeekRange(TODAY), { start: "2026-10-08", end: "2026-10-15", label: "essa semana" });
  assert.deepEqual(previousWeekRange(TODAY), { start: "2026-10-07", end: "2026-10-14", label: "semana passada" });
  assert.deepEqual(currentMonthRange(TODAY), { start: "2026-10-01", end: "2026-11-01", label: "esse mês (outubro de 2026)" });
  assert.deepEqual(previousMonthRange(TODAY), { start: "2026-09-01", end: "2026-10-01", label: "setembro de 2026" });
  assert.deepEqual(lastNDaysRange(3, TODAY), { start: "2026-10-12", end: "2026-10-15", label: "últimos 3 dias" });
  assert.deepEqual(singleDayRange("2026-10-14", "hoje"), { start: "2026-10-14", end: "2026-10-15", label: "hoje" });
  // viradas de mes e de ano
  assert.deepEqual(currentMonthRange("2026-12-20"), { start: "2026-12-01", end: "2027-01-01", label: "esse mês (dezembro de 2026)" });
  assert.deepEqual(previousMonthRange("2027-01-05"), { start: "2026-12-01", end: "2027-01-01", label: "dezembro de 2026" });
  assert.deepEqual(currentWeekRange("2026-03-01"), { start: "2026-02-23", end: "2026-03-02", label: "essa semana" });
});

test("22h em Sao Paulo (01h UTC do dia seguinte): 'hoje', semana e mes seguem a data de SP, nao a do servidor", () => {
  const night = new Date("2026-10-15T01:30:00Z"); // 22:30 de 14/10 em SP
  const today = spDateString(night);
  assert.equal(today, "2026-10-14");
  assert.deepEqual(singleDayRange(today, "hoje"), { start: "2026-10-14", end: "2026-10-15", label: "hoje" });
  assert.deepEqual(currentWeekRange(today), { start: "2026-10-08", end: "2026-10-15", label: "essa semana" });
  // virada de mes: 22h do dia 31 em SP ja e dia 1 em UTC
  const endOfMonth = spDateString(new Date("2026-11-01T01:30:00Z"));
  assert.equal(endOfMonth, "2026-10-31");
  assert.deepEqual(currentMonthRange(endOfMonth), { start: "2026-10-01", end: "2026-11-01", label: "esse mês (outubro de 2026)" });
  assert.equal(relativeDayLabel("2026-10-14", today), "hoje");
});

test("os periodos nao dependem do fuso do processo (TZ=UTC e TZ=America/Sao_Paulo dao o mesmo resultado)", () => {
  const original = process.env.TZ;
  try {
    const results: string[] = [];
    for (const tz of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      results.push(JSON.stringify([currentWeekRange(TODAY), currentMonthRange(TODAY), lastNDaysRange(5, TODAY), previousMonthRange(TODAY), singleDayRange(TODAY, "hoje")]));
    }
    assert.equal(new Set(results).size, 1);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("relativeDayLabel: hoje, ontem e dd/MM (com ano quando e outro ano)", () => {
  assert.equal(relativeDayLabel("2026-10-14", TODAY), "hoje");
  assert.equal(relativeDayLabel("2026-10-13", TODAY), "ontem");
  assert.equal(relativeDayLabel("2026-10-08", TODAY), "08/10");
  assert.equal(relativeDayLabel("2025-12-31", TODAY), "31/12/2025");
  assert.equal(relativeDayLabel("2026-10-14T10:00:00", TODAY), "hoje", "ignora a hora");
  assert.equal(relativeDayLabel("2026-01-01", "2026-01-02"), "ontem", "virada de ano");
});

test("resolveQueryRange: sem nenhum campo -> range nulo (quem chama escolhe o padrao)", () => {
  assert.deepEqual(range({}), { ok: true, range: null, source: null });
});

test("resolveQueryRange: mes nomeado (RN06) com rotulo 'setembro/2026', mes futuro e virada de ano", () => {
  assert.deepEqual(range({ month: "2026-09" }), { ok: true, source: "month", range: { start: "2026-09-01", end: "2026-10-01", label: "setembro/2026" } });
  assert.deepEqual(range({ month: "2025-12" }).range, { start: "2025-12-01", end: "2026-01-01", label: "dezembro/2025" });
  assert.deepEqual(range({ month: "2026-12" }).range, { start: "2026-12-01", end: "2027-01-01", label: "dezembro/2026" });
  assert.deepEqual(range({ month: "2026-02" }).range, { start: "2026-02-01", end: "2026-03-01", label: "fevereiro/2026" });
  assert.equal(range({ month: " 2026-09 " }).range?.label, "setembro/2026", "espacos nas pontas");
  assert.equal(range({ month: "2026-09-15" }).range?.label, "setembro/2026", "so olha ano-mes");
  assert.equal(monthLabel("2026-03"), "março/2026");
  for (const bad of ["setembro", "2026-13", "2026-00", "26-09", "abc"]) {
    assert.deepEqual(resolveQueryRange({ month: bad }, TODAY), { ok: false, error: INVALID_MONTH_TEXT }, bad);
  }
});

test("resolveQueryRange: intervalo (RN07) com rotulo '10/09 a 20/09', ano diferente e limites de 366 dias", () => {
  assert.deepEqual(range({ date_start: "2026-09-10", date_end: "2026-09-20" }), {
    ok: true,
    source: "interval",
    range: { start: "2026-09-10", end: "2026-09-21", label: "10/09 a 20/09" },
  });
  // outro ano / virada de ano: rotulo com o ano
  assert.equal(range({ date_start: "2025-12-20", date_end: "2026-01-05" }).range?.label, "20/12/2025 a 05/01/2026");
  assert.equal(range({ date_start: "2025-03-01", date_end: "2025-03-10" }).range?.label, "01/03/2025 a 10/03/2025");
  // um dia so
  assert.deepEqual(range({ date_start: "2026-09-10", date_end: "2026-09-10" }).range, { start: "2026-09-10", end: "2026-09-11", label: "10/09 a 10/09" });
  // meses de 28/29/30/31 dias
  assert.equal(range({ date_start: "2028-02-27", date_end: "2028-03-01" }).range?.end, "2028-03-02");
  // 366 dias valem; 367 nao
  assert.equal(MAX_RANGE_DAYS, 366);
  assert.ok(resolveQueryRange({ date_start: "2026-01-01", date_end: "2026-12-31" }, TODAY).ok, "365 dias");
  assert.ok(resolveQueryRange({ date_start: "2028-01-01", date_end: "2028-12-31" }, TODAY).ok, "366 dias (ano bissexto)");
  assert.deepEqual(resolveQueryRange({ date_start: "2026-01-01", date_end: "2027-01-02" }, TODAY), { ok: false, error: INVALID_RANGE_TEXT });
  // inicio depois do fim, datas invalidas, so uma ponta
  assert.deepEqual(resolveQueryRange({ date_start: "2026-09-20", date_end: "2026-09-10" }, TODAY), { ok: false, error: INVALID_RANGE_TEXT });
  assert.deepEqual(resolveQueryRange({ date_start: "2026-02-30", date_end: "2026-03-10" }, TODAY), { ok: false, error: INVALID_RANGE_TEXT });
  assert.deepEqual(resolveQueryRange({ date_start: "ontem", date_end: "hoje" }, TODAY), { ok: false, error: INVALID_RANGE_TEXT });
  assert.equal(INVALID_RANGE_TEXT, 'Esse período não dá certo. Me diz um intervalo de até 1 ano, ex: "de 10/09 a 20/09".');
  assert.deepEqual(range({ date_start: "2026-09-10" }), { ok: true, range: null, source: null }, "so o inicio: ignora");
  // aceita ISO com hora
  assert.equal(range({ date_start: "2026-09-10T00:00:00", date_end: "2026-09-12T23:59:59" }).range?.end, "2026-09-13");
});

test("resolveQueryRange: prioridade intervalo > mes > dia > dias > periodo (RN08)", () => {
  const all = { date_start: "2026-09-10", date_end: "2026-09-20", month: "2026-08", date: "2026-10-01", days: 5, period: "week" as const };
  assert.equal(range(all).source, "interval");
  const { date_start, date_end, ...noInterval } = all;
  void date_start;
  void date_end;
  assert.equal(range(noInterval).source, "month");
  const { month, ...noMonth } = noInterval;
  void month;
  assert.equal(range(noMonth).source, "date");
  assert.equal(range(noMonth).range?.label, "01/10/2026");
  const { date, ...noDate } = noMonth;
  void date;
  assert.equal(range(noDate).source, "days");
  assert.equal(range(noDate).range?.label, "últimos 5 dias");
  assert.equal(range({ period: "week" }).range?.label, "essa semana");
  assert.equal(range({ period: "month" }).range?.label, "esse mês (outubro de 2026)");
});

test("resolveQueryRange: um dia (hoje/ontem/data) e 'days' (1 = hoje, invalido ignorado, teto de 366)", () => {
  assert.deepEqual(range({ date: "2026-10-14" }).range, { start: "2026-10-14", end: "2026-10-15", label: "hoje" });
  assert.deepEqual(range({ date: "2026-10-13" }).range, { start: "2026-10-13", end: "2026-10-14", label: "ontem" });
  assert.deepEqual(range({ date: "2026-10-01T09:00:00" }).range, { start: "2026-10-01", end: "2026-10-02", label: "01/10/2026" });
  assert.deepEqual(resolveQueryRange({ date: "2026-13-45" }, TODAY), { ok: false, error: INVALID_RANGE_TEXT });
  assert.deepEqual(range({ days: 1 }).range, { start: "2026-10-14", end: "2026-10-15", label: "hoje" });
  assert.deepEqual(range({ days: 7 }).range, { start: "2026-10-08", end: "2026-10-15", label: "últimos 7 dias" });
  assert.equal(range({ days: 0 }).range, null);
  assert.equal(range({ days: -3 }).range, null);
  assert.equal(range({ days: Number.NaN }).range, null);
  assert.equal(range({ days: 9999 }).range?.label, "últimos 366 dias");
  assert.equal(range({ days: 2.9 }).range?.label, "últimos 2 dias");
});
