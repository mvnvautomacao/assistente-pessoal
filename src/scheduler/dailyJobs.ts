// Executor unico das rotinas diarias (Card 19). Cada rotina tem uma hora ("a partir de"), roda no maximo uma vez por dia de
// calendario (SP) e, se o servidor estava fora na hora, recupera ao voltar -- sem duplicar (a trava fica em cada ITEM) e
// deixando tudo registrado em job_runs. O relogio entra por parametro: nada aqui espera o cron de verdade.
import cron from "node-cron";
import { config } from "../config";
import { logActivity } from "../activity/service";
import { addDaysToDateString, spDateString, spTimeString } from "../timeSP";
import { beat, detectDowntime, DowntimePeriod, getLastBeat } from "./heartbeat";
import { claimJobRun, failJobRun, finishJobRun, getJobRun, markJobRunMissed } from "./jobRuns";

// espera depois de subir antes do primeiro catch-up (a Evolution API precisa estar de pe pra enviar)
export const INITIAL_CATCHUP_DELAY_MS = 20 * 1000;
// quantos dias pra tras a marcacao de "perdida" olha depois de uma queda
const MAX_MISSED_LOOKBACK_DAYS = 31;

export interface JobContext {
  runDate: string; // a data da execucao (YYYY-MM-DD): normalmente hoje; o relatorio mensal atrasado usa o ultimo dia do mes que acabou
  today: string;
  now: Date;
}

export interface JobResult {
  items: number; // quantas coisas foram feitas (lancamentos, avisos, relatorios)
  failures: number; // quantas falharam e valem uma nova tentativa
}

export interface DailyJob {
  name: string;
  time: string; // "HH:MM" -- a partir daqui o dia conta
  lookbackDays: number; // janela de recuperacao usada pela propria rotina (documentacao e /admin)
  atMostOnce: boolean; // relatorios: uma execucao abandonada nunca e repetida
  // datas de execucao que valem agora; padrao: so hoje, depois da hora
  runDates?(now: Date): string[];
  // o dia da execucao ainda pode ser recuperado hoje? (padrao: so se for hoje)
  recoverable?(runDate: string, today: string): boolean;
  // a rotina estava agendada nesta data? (padrao: todo dia; o mensal so no ultimo dia do mes)
  scheduledOn?(date: string): boolean;
  run(ctx: JobContext): Promise<JobResult>;
}

const jobs = new Map<string, DailyJob>();

export function registerDailyJob(job: DailyJob) {
  jobs.set(job.name, job);
}

export function listDailyJobs(): DailyJob[] {
  return [...jobs.values()];
}

export function resetDailyJobsForTests() {
  jobs.clear();
}

export interface JobRunSummary {
  job: string;
  runDate: string;
  status: "done" | "failed";
  items: number;
  failures: number;
}

function defaultRunDates(job: DailyJob, now: Date): string[] {
  return spTimeString(now) >= job.time ? [spDateString(now)] : [];
}

// Roda o que esta na hora (ou atrasado) e ainda nao foi feito hoje. Seguro de chamar varias vezes: so uma chamada reivindica cada (rotina, dia).
export async function runDueDailyJobs(now: Date): Promise<JobRunSummary[]> {
  const summaries: JobRunSummary[] = [];
  const today = spDateString(now);
  for (const job of listDailyJobs()) {
    const dates = job.runDates ? job.runDates(now) : defaultRunDates(job, now);
    for (const runDate of dates) {
      if (!claimJobRun(job.name, runDate, now, { atMostOnce: job.atMostOnce })) continue;
      try {
        const result = await job.run({ runDate, today, now });
        // relatorio ja enviado pra alguem nao repete (quem falhou fica sem); sem ninguem atendido, tenta de novo
        const retry = result.failures > 0 && (result.items === 0 || !job.atMostOnce);
        if (retry) {
          failJobRun(job.name, runDate, new Date(), result.items);
          const attempts = getJobRun(job.name, runDate)?.attempts ?? 1;
          console.error(`[agendador] rotina ${job.name} de ${runDate}: ${result.failures} falha(s) (tentativa ${attempts}); ${attempts >= 3 ? "sem novas tentativas hoje" : "tenta de novo no proximo minuto"}`);
          summaries.push({ job: job.name, runDate, status: "failed", items: result.items, failures: result.failures });
        } else {
          finishJobRun(job.name, runDate, new Date(), result.items);
          if (result.failures > 0) console.error(`[agendador] rotina ${job.name} de ${runDate}: ${result.failures} envio(s) falharam e nao serao repetidos`);
          summaries.push({ job: job.name, runDate, status: "done", items: result.items, failures: result.failures });
        }
      } catch (err) {
        failJobRun(job.name, runDate, new Date(), 0);
        console.error(`[agendador] rotina ${job.name} de ${runDate} falhou:`, err);
        summaries.push({ job: job.name, runDate, status: "failed", items: 0, failures: 1 });
      }
    }
  }
  return summaries;
}

// Depois de uma queda: as execucoes dos dias fora do ar que NAO tem mais como ser recuperadas ficam registradas como "perdidas"
// (log do dono + job_runs) -- nunca em silencio. Devolve quantas foram marcadas.
export function markUnrecoverableRuns(period: DowntimePeriod, now: Date): number {
  const today = spDateString(now);
  let marked = 0;
  const first = spDateString(period.from);
  for (let i = 0; i <= MAX_MISSED_LOOKBACK_DAYS; i++) {
    const date = addDaysToDateString(first, i);
    if (date >= today) break;
    for (const job of listDailyJobs()) {
      if (!job.atMostOnce) continue; // as de janela se recuperam sozinhas
      if (job.scheduledOn && !job.scheduledOn(date)) continue;
      const recoverable = job.recoverable ? job.recoverable(date, today) : date === today;
      if (recoverable || getJobRun(job.name, date)) continue;
      if (markJobRunMissed(job.name, date, now)) {
        marked++;
        logActivity(config.myWhatsappNumber, "job_missed", `rotina ${job.name} de ${date} perdida: servidor fora do ar e fora da janela de recuperacao`);
        console.warn(`[agendador] rotina ${job.name} de ${date} perdida (servidor fora do ar)`);
      }
    }
  }
  return marked;
}

// Primeira subida do novo agendador (sem nenhum batimento antes): o agendador antigo (cron por rotina) pode ja ter enviado os relatorios de
// hoje. Os de uma vez so que ja passaram da hora ficam como tratados, em vez de sair em dobro. Gastos fixos e alertas nao precisam disso (a trava e do item).
export function markLegacyRuns(now: Date): number {
  let marked = 0;
  for (const job of listDailyJobs()) {
    if (!job.atMostOnce) continue;
    const dates = job.runDates ? job.runDates(now) : defaultRunDates(job, now);
    for (const date of dates) {
      if (!getJobRun(job.name, date) && markJobRunMissed(job.name, date, now)) {
        marked++;
        console.warn(`[agendador] primeira subida: rotina ${job.name} de ${date} considerada ja tratada pelo agendador anterior`);
      }
    }
  }
  return marked;
}

let started = false;

// Um cron por minuto no fuso de SP: batimento + rotinas diarias. Tambem roda uma vez ~20 s depois de subir (catch-up).
export function startDailyJobRunner(options: { initialDelayMs?: number } = {}) {
  if (started) return;
  started = true;
  const boot = new Date();
  const firstBoot = getLastBeat() === null;
  const downtime = detectDowntime(boot);
  beat(boot);
  if (firstBoot) markLegacyRuns(boot);
  if (downtime) markUnrecoverableRuns(downtime, boot);

  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      beat(now);
      await runDueDailyJobs(now);
    } catch (err) {
      console.error("[agendador] erro no ciclo das rotinas diarias:", err);
    } finally {
      running = false;
    }
  };
  const timer = setTimeout(cycle, options.initialDelayMs ?? INITIAL_CATCHUP_DELAY_MS);
  timer.unref?.();
  cron.schedule("* * * * *", cycle, { timezone: "America/Sao_Paulo" });
}

export function resetDailyJobRunnerForTests() {
  started = false;
}
