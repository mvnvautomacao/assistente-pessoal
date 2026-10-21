import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { logActivity } from "../activity/service";
import { spDateString, spTimeString, spDayOfWeek } from "../timeSP";
import {
  getNoExpenseReminderSubscribers,
  hasExpenseForDate,
  markNoExpenseReminderSent,
  getNoExpenseReminderDays,
  getNoExpenseReminderState,
  hasUserActivitySince,
  markNoExpensePauseLogged,
  NO_EXPENSE_MAX_UNANSWERED,
  recordNoExpenseReminderSent,
  resetNoExpenseReminder,
} from "./service";

export { NO_EXPENSE_MAX_UNANSWERED };

// 1o aviso: a explicacao dos dias da semana; 2o (ultimo): avisa que vai parar se nao houver registro (Card 23, RN05)
export function buildReminderMessage(time: string, isLastAlert = false): string {
  const base = `👋 Vi que você ainda não registrou nenhum gasto hoje. Será que esqueceu de anotar alguma coisa? Se lembrar de algo, só me mandar por aqui mesmo 🙂`;
  if (isLastAlert) {
    return `${base}\n\nEsse é o último aviso desse tipo: se você não registrar nada, eu paro de mandar. Quando quiser voltar, é só me contar um gasto. 🙂`;
  }
  return `${base}\n\n(Esse aviso pode vir em alguns dias da semana às ${time} se você não registrar nada. Se quiser, posso desativar ou mudar o horário -- é só pedir.)`;
}

// Uma rodada do aviso (o cron chama a cada minuto): extraida para poder ser testada com o relogio simulado.
export async function runNoExpenseReminderRound(
  now: Date = new Date(Date.now()),
  send: (to: string, text: string) => Promise<unknown> = (to, text) => sendText(to, text),
  onlyNumbers?: string[] // so esses numeros (testes e reprocessamento pontual); sem isso, todos os assinantes
): Promise<{ sent: number; paused: number }> {
  // dias da semana em que o aviso roda e configuracao GLOBAL (definida
  // pelo admin no /admin, nao pelo usuario final) -- fora desses dias,
  // ninguem recebe nada, independente do horario/ativado de cada numero.
  if (!getNoExpenseReminderDays().includes(spDayOfWeek(now))) return { sent: 0, paused: 0 };

  const today = spDateString(now);
  const time = spTimeString(now);
  const subscribers = getNoExpenseReminderSubscribers().filter((s) => s.sent_date !== today && time >= s.time && (!onlyNumbers || onlyNumbers.includes(s.from_number)));

  let sent = 0;
  let paused = 0;
  for (const s of subscribers) {
    try {
      let state = getNoExpenseReminderState(s.from_number);
      // o cliente registrou algo depois do ultimo aviso: o contador recomeca (RN02)
      if (state.unanswered > 0 && state.lastAlertAt && hasUserActivitySince(s.from_number, state.lastAlertAt)) {
        resetNoExpenseReminder(s.from_number);
        state = { unanswered: 0, lastAlertAt: null };
      }

      // 2 avisos sem nenhum registro: cliente inativo, o aviso para ate ele voltar (RN01, RN07)
      if (state.unanswered >= NO_EXPENSE_MAX_UNANSWERED) {
        markNoExpenseReminderSent(s.from_number, today);
        if (state.unanswered === NO_EXPENSE_MAX_UNANSWERED) {
          markNoExpensePauseLogged(s.from_number);
          logActivity(s.from_number, "no_expense_reminder", `cliente pausado por inatividade (${NO_EXPENSE_MAX_UNANSWERED} avisos sem registro)`);
        }
        paused++;
        continue;
      }

      if (hasExpenseForDate(s.from_number, today)) {
        markNoExpenseReminderSent(s.from_number, today); // ja registrou algo hoje -- nao precisa avisar
        continue;
      }
      const isLastAlert = state.unanswered + 1 >= NO_EXPENSE_MAX_UNANSWERED;
      await send(s.from_number, buildReminderMessage(s.time, isLastAlert));
      recordNoExpenseReminderSent(s.from_number, now.toISOString()); // so depois do envio aceito (RN08)
      markNoExpenseReminderSent(s.from_number, today);
      sent++;
    } catch (err) {
      console.error(`Erro ao enviar aviso de gasto pendente pra ${s.from_number}:`, err);
    }
  }
  return { sent, paused };
}

export function startNoExpenseReminderScheduler() {
  // roda a cada minuto: cada numero tem seu proprio horario configuravel, entao
  // nao da pra usar um horario fixo de cron igual o relatorio semanal. ">="
  // (em vez de "==") cobre o caso raro do processo reiniciar bem na hora certa
  // -- sent_date garante que so manda 1x por dia mesmo assim.
  cron.schedule("* * * * *", () => void runNoExpenseReminderRound(), { timezone: "America/Sao_Paulo" });
}
