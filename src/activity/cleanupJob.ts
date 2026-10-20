// Card 21 (D-12): rotina diaria das 3h que apaga do activity_log o que passou da retencao. Entra no executor diario (job_runs e /admin).
// atMostOnce: uma limpeza perdida nao precisa ser refeita -- a do dia seguinte apaga o mesmo e mais.
import { config } from "../config";
import { DailyJob, registerDailyJob } from "../scheduler/dailyJobs";
import { purgeActivityLog } from "./service";

export const ACTIVITY_LOG_CLEANUP_JOB_NAME = "limpeza_log";

export const activityLogCleanupJob: DailyJob = {
  name: ACTIVITY_LOG_CLEANUP_JOB_NAME,
  time: "03:00",
  lookbackDays: 0,
  atMostOnce: true,
  async run({ now }) {
    const deleted = purgeActivityLog(config.activityLogRetentionDays, now);
    return { items: deleted, failures: 0 };
  },
};

export function startActivityLogCleanup() {
  registerDailyJob(activityLogCleanupJob);
}
