import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { spDateString, spTimeString, spDayOfWeek } from "../timeSP";
import { getNoExpenseReminderSubscribers, hasExpenseForDate, markNoExpenseReminderSent, getNoExpenseReminderDays } from "./service";

function buildReminderMessage(time: string): string {
  return `👋 Vi que você ainda não registrou nenhum gasto hoje. Será que esqueceu de anotar alguma coisa? Se lembrar de algo, só me mandar por aqui mesmo 🙂\n\n(Esse aviso pode vir em alguns dias da semana às ${time} se você não registrar nada. Se quiser, posso desativar ou mudar o horário -- é só pedir.)`;
}

export function startNoExpenseReminderScheduler() {
  // roda a cada minuto: cada numero tem seu proprio horario configuravel, entao
  // nao da pra usar um horario fixo de cron igual o relatorio semanal. ">="
  // (em vez de "==") cobre o caso raro do processo reiniciar bem na hora certa
  // -- sent_date garante que so manda 1x por dia mesmo assim.
  cron.schedule(
    "* * * * *",
    async () => {
      // dias da semana em que o aviso roda e configuracao GLOBAL (definida
      // pelo admin no /admin, nao pelo usuario final) -- fora desses dias,
      // ninguem recebe nada, independente do horario/ativado de cada numero.
      if (!getNoExpenseReminderDays().includes(spDayOfWeek())) return;

      const today = spDateString();
      const now = spTimeString();
      const subscribers = getNoExpenseReminderSubscribers().filter((s) => s.sent_date !== today && now >= s.time);

      for (const s of subscribers) {
        try {
          if (hasExpenseForDate(s.from_number, today)) {
            markNoExpenseReminderSent(s.from_number, today); // ja registrou algo hoje -- nao precisa avisar
            continue;
          }
          await sendText(s.from_number, buildReminderMessage(s.time));
          markNoExpenseReminderSent(s.from_number, today);
        } catch (err) {
          console.error(`Erro ao enviar aviso de gasto pendente pra ${s.from_number}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
