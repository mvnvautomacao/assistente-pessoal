import cron from "node-cron";
import { sendText } from "../whatsapp/client";
import { spDateString, spTimeString } from "../timeSP";
import { getNoExpenseReminderSubscribers, hasExpenseForDate, markNoExpenseReminderSent } from "./service";

const REMINDER_MESSAGE =
  "👋 Vi que você ainda não registrou nenhum gasto hoje. Será que esqueceu de anotar alguma coisa? Se lembrar de algo, só me mandar por aqui mesmo 🙂";

export function startNoExpenseReminderScheduler() {
  // roda a cada minuto: cada numero tem seu proprio horario configuravel, entao
  // nao da pra usar um horario fixo de cron igual o relatorio semanal. ">="
  // (em vez de "==") cobre o caso raro do processo reiniciar bem na hora certa
  // -- sent_date garante que so manda 1x por dia mesmo assim.
  cron.schedule(
    "* * * * *",
    async () => {
      const today = spDateString();
      const now = spTimeString();
      const subscribers = getNoExpenseReminderSubscribers().filter((s) => s.sent_date !== today && now >= s.time);

      for (const s of subscribers) {
        try {
          if (hasExpenseForDate(s.from_number, today)) {
            markNoExpenseReminderSent(s.from_number, today); // ja registrou algo hoje -- nao precisa avisar
            continue;
          }
          await sendText(s.from_number, REMINDER_MESSAGE);
          markNoExpenseReminderSent(s.from_number, today);
        } catch (err) {
          console.error(`Erro ao enviar aviso de gasto pendente pra ${s.from_number}:`, err);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
