import { db } from "../db";
import { filterByQuery, SEARCH_SCAN_LIMIT } from "../text/search";
import { spDateString, addDaysToDateString, effectiveDayOfMonth, sqliteUtcToSpDate } from "../timeSP";

export interface BillAlert {
  id: number;
  from_number: string;
  name: string;
  recurrence_type: "day_of_month" | "interval";
  day_of_month: number; // so relevante quando recurrence_type = "day_of_month"
  interval_days: number | null; // so relevante quando recurrence_type = "interval"
  next_due_date: string | null; // so relevante quando recurrence_type = "interval"
  active: number;
  last_asked_date: string | null;
  confirmed_month: string | null;
  snoozed_until: string | null;
  created_at: string;
}

export type CreateBillAlertParams =
  | { fromNumber: string; name: string; dayOfMonth: number }
  | { fromNumber: string; name: string; intervalDays: number };

export function createBillAlert(params: CreateBillAlertParams): BillAlert {
  const isInterval = "intervalDays" in params;
  const nextDueDate = isInterval ? addDaysToDateString(spDateString(), params.intervalDays) : null;
  const result = db
    .prepare(
      `INSERT INTO bill_alerts (from_number, name, recurrence_type, day_of_month, interval_days, next_due_date, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`
    )
    .run(
      params.fromNumber,
      params.name,
      isInterval ? "interval" : "day_of_month",
      isInterval ? 1 : params.dayOfMonth, // placeholder ignorado quando e por intervalo
      isInterval ? params.intervalDays : null,
      nextDueDate
    );
  return getBillAlertById(params.fromNumber, Number(result.lastInsertRowid))!;
}

export function getBillAlertById(fromNumber: string, id: number): BillAlert | null {
  const row = db.prepare(`SELECT * FROM bill_alerts WHERE id = ? AND from_number = ?`).get(id, fromNumber) as BillAlert | undefined;
  return row ?? null;
}

export function listBillAlerts(fromNumber: string): BillAlert[] {
  return db
    .prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1 ORDER BY id ASC`)
    .all(fromNumber) as unknown as BillAlert[];
}

export function deactivateBillAlert(fromNumber: string, id: number): boolean {
  const result = db.prepare(`UPDATE bill_alerts SET active = 0 WHERE id = ? AND from_number = ?`).run(id, fromNumber);
  return result.changes > 0;
}

// Edita um alerta: nome e/ou recorrencia (dia fixo do mes OU intervalo de dias --
// trocar de um tipo pro outro tambem vale). Mexer na recorrencia limpa soneca e
// "ja perguntei hoje", pra o novo agendamento valer desde ja; intervalo
// recomeca a contar de hoje. Filtra por dono, igual o resto do servico.
export function updateBillAlert(
  fromNumber: string,
  id: number,
  changes: { name?: string; dayOfMonth?: number; intervalDays?: number; nextDueDate?: string }
): BillAlert | null {
  const bill = getBillAlertById(fromNumber, id);
  if (!bill || !bill.active) return null;
  if (changes.name !== undefined) {
    db.prepare(`UPDATE bill_alerts SET name = ? WHERE id = ? AND from_number = ?`).run(changes.name, id, fromNumber);
  }
  if (changes.intervalDays !== undefined) {
    db.prepare(
      `UPDATE bill_alerts SET recurrence_type = 'interval', interval_days = ?, next_due_date = ?, snoozed_until = NULL, last_asked_date = NULL WHERE id = ? AND from_number = ?`
    ).run(changes.intervalDays, changes.nextDueDate ?? addDaysToDateString(spDateString(), changes.intervalDays), id, fromNumber);
  } else if (changes.nextDueDate !== undefined && bill.recurrence_type === "interval") {
    db.prepare(`UPDATE bill_alerts SET next_due_date = ?, snoozed_until = NULL, last_asked_date = NULL WHERE id = ? AND from_number = ?`).run(
      changes.nextDueDate,
      id,
      fromNumber
    );
  } else if (changes.dayOfMonth !== undefined) {
    db.prepare(
      `UPDATE bill_alerts SET recurrence_type = 'day_of_month', day_of_month = ?, interval_days = NULL, next_due_date = NULL, snoozed_until = NULL, last_asked_date = NULL, confirmed_month = NULL WHERE id = ? AND from_number = ?`
    ).run(changes.dayOfMonth, id, fromNumber);
  }
  return getBillAlertById(fromNumber, id);
}

// desfazer da edicao: devolve nome, recorrencia e proximo aviso de antes (o dia 1 e o placeholder de quem e por intervalo)
export function restoreBillAlertFields(
  fromNumber: string,
  id: number,
  previous: { name: string; recurrenceType: "day_of_month" | "interval"; dayOfMonth: number | null; intervalDays: number | null; nextDueDate: string | null }
): boolean {
  const result = db
    .prepare(
      `UPDATE bill_alerts SET name = ?, recurrence_type = ?, day_of_month = ?, interval_days = ?, next_due_date = ?, snoozed_until = NULL, last_asked_date = NULL
       WHERE id = ? AND from_number = ? AND active = 1`
    )
    .run(previous.name, previous.recurrenceType, previous.dayOfMonth ?? 1, previous.intervalDays, previous.nextDueDate, id, fromNumber);
  return result.changes > 0;
}

export function findActiveBillAlertByName(fromNumber: string, query: string): BillAlert | null {
  const rows = db
    .prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1 ORDER BY id DESC LIMIT ?`)
    .all(fromNumber, SEARCH_SCAN_LIMIT) as unknown as BillAlert[];
  return filterByQuery(rows, (b) => b.name, query, 1)[0] ?? null;
}

// ultimo valor lancado por este alerta (gasto com marca 'bill_alert' e fixed_ref_id = id do alerta), pro "igual" do aviso
export function getLastBillAlertAmount(fromNumber: string, billAlertId: number): number | null {
  const row = db
    .prepare(
      `SELECT amount FROM expenses
       WHERE from_number = ? AND fixed_source = 'bill_alert' AND fixed_ref_id = ?
       ORDER BY date DESC, id DESC LIMIT 1`
    )
    .get(fromNumber, billAlertId) as { amount: number } | undefined;
  return row ? row.amount : null;
}

export function markBillAlertAsked(fromNumber: string, id: number, todayDate: string) {
  db.prepare(`UPDATE bill_alerts SET last_asked_date = ? WHERE id = ? AND from_number = ?`).run(todayDate, id, fromNumber);
}

// usuario respondeu que ja fez: por dia fixo do mes, fecha o ciclo desse mes
// (confirmed_month) -- por intervalo, reinicia a contagem a partir de HOJE
// (next_due_date = hoje + interval_days), nao da data que era o vencimento
// original. Nas duas recorrencias, limpa qualquer soneca pendente.
export function confirmBillAlertPaid(fromNumber: string, id: number, todayDate: string) {
  const bill = db.prepare(`SELECT * FROM bill_alerts WHERE id = ? AND from_number = ?`).get(id, fromNumber) as BillAlert | undefined;
  if (!bill) return;
  if (bill.recurrence_type === "interval") {
    const nextDueDate = addDaysToDateString(todayDate, bill.interval_days ?? 0);
    db.prepare(`UPDATE bill_alerts SET next_due_date = ?, snoozed_until = NULL WHERE id = ? AND from_number = ?`).run(nextDueDate, id, fromNumber);
    return;
  }
  // fecha o ciclo do ULTIMO vencimento (se o aviso veio atrasado, de um mes que ja acabou, e esse mes que fica confirmado)
  db.prepare(`UPDATE bill_alerts SET confirmed_month = ?, snoozed_until = NULL WHERE id = ? AND from_number = ?`).run(
    lastBillDueDate(bill.day_of_month, todayDate).yearMonth,
    id,
    fromNumber
  );
}

// usuario pediu pra lembrar de novo amanha -- guarda ate quando adiar, sem mexer
// em last_asked_date (assim nao pergunta 2x no mesmo dia mesmo se o cron rodar de novo).
// Vale igual pras duas recorrencias.
export function snoozeBillAlert(fromNumber: string, id: number, untilDate: string) {
  db.prepare(`UPDATE bill_alerts SET snoozed_until = ? WHERE id = ? AND from_number = ?`).run(untilDate, id, fromNumber);
}

// Ciclo "devido" de um alerta por dia do mes (Card 19, RN06): o ULTIMO vencimento que ja passou. Se o dia efetivo deste mes ainda nao
// chegou, o ciclo e o do mes anterior (o servidor pode ter perdido aquele aviso). yearMonth e o mes do vencimento.
export function lastBillDueDate(dayOfMonth: number, todayDate: string): { yearMonth: string; dueDate: string } {
  const yearMonth = todayDate.slice(0, 7);
  const today = Number(todayDate.slice(8, 10));
  const thisMonthDay = effectiveDayOfMonth(dayOfMonth, yearMonth);
  if (thisMonthDay <= today) return { yearMonth, dueDate: `${yearMonth}-${String(thisMonthDay).padStart(2, "0")}` };
  const previousMonth = addDaysToDateString(`${yearMonth}-01`, -1).slice(0, 7);
  return { yearMonth: previousMonth, dueDate: `${previousMonth}-${String(effectiveDayOfMonth(dayOfMonth, previousMonth)).padStart(2, "0")}` };
}

// o aviso de HOJE e de um vencimento que ja passou (servidor fora do ar)? Devolve a data do vencimento, ou null.
// Aviso de soneca ("me lembra amanha") nunca e "atrasado".
export function billLateFromDate(bill: BillAlert, todayDate: string): string | null {
  if (bill.snoozed_until) return null;
  if (bill.recurrence_type === "interval") return bill.next_due_date && bill.next_due_date < todayDate ? bill.next_due_date : null;
  const { dueDate } = lastBillDueDate(bill.day_of_month, todayDate);
  return dueDate < todayDate ? dueDate : null;
}

// alertas ativos que precisam perguntar "ja fez?" hoje: pra dia fixo do mes, o ciclo do ultimo vencimento que ja passou (o de hoje,
// ou o que o servidor perdeu) ainda nao foi confirmado nem perguntado; pra intervalo, a data calculada (next_due_date) ja chegou.
// Nas duas, uma soneca de "lembra amanha" ainda pendente manda (ou nao) direto, sem olhar o resto. Alerta cadastrado DEPOIS do
// vencimento nao e avisado retroativamente (RN05).
export function getDueBillAlerts(todayDate: string): BillAlert[] {
  const candidates = db
    .prepare(`SELECT * FROM bill_alerts WHERE active = 1 AND (last_asked_date IS NULL OR last_asked_date != ?)`)
    .all(todayDate) as unknown as BillAlert[];

  return candidates.filter((b) => {
    if (b.snoozed_until) return b.snoozed_until <= todayDate;

    if (b.recurrence_type === "interval") {
      return !!b.next_due_date && b.next_due_date <= todayDate;
    }

    const cycle = lastBillDueDate(b.day_of_month, todayDate);
    if (b.confirmed_month === cycle.yearMonth) return false;
    if (b.last_asked_date && b.last_asked_date >= cycle.dueDate) return false; // ja perguntado neste ciclo
    if (cycle.dueDate < todayDate && sqliteUtcToSpDate(b.created_at) > cycle.dueDate) return false;
    return true;
  });
}
