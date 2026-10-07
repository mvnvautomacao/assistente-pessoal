import { db } from "../db";
import { spDateString, addDaysToDateString } from "../timeSP";

export const SPRINT_LENGTH_DAYS = 10;

export const CARD_STATUSES = ["backlog", "refinado", "a_fazer", "fazendo", "testando", "feito"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  backlog: "Backlog",
  refinado: "Refinado",
  a_fazer: "A fazer",
  fazendo: "Fazendo",
  testando: "Testando",
  feito: "Feito",
};

export const CARD_TYPES = ["melhoria", "evolucao", "incidente"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABEL: Record<CardType, string> = {
  melhoria: "Melhoria",
  evolucao: "Evolução",
  incidente: "Incidente",
};

export interface Sprint {
  id: number;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  status: "active" | "closed";
  created_at: string;
}

export interface SprintCard {
  id: number;
  sprint_id: number;
  title: string;
  description: string | null;
  type: CardType;
  status: CardStatus;
  created_at: string;
  done_at: string | null;
}

export function isCardStatus(value: unknown): value is CardStatus {
  return typeof value === "string" && (CARD_STATUSES as readonly string[]).includes(value);
}

export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && (CARD_TYPES as readonly string[]).includes(value);
}

export function getActiveSprint(): Sprint | null {
  const row = db.prepare(`SELECT * FROM sprints WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get() as unknown as Sprint | undefined;
  return row ?? null;
}

function createSprint(startDate: string): Sprint {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM sprints`).get() as { n: number }).n;
  const endDate = addDaysToDateString(startDate, SPRINT_LENGTH_DAYS);
  const result = db
    .prepare(`INSERT INTO sprints (name, start_date, end_date, status) VALUES (?, ?, ?, 'active')`)
    .run(`Sprint ${count + 1}`, startDate, endDate);
  return db.prepare(`SELECT * FROM sprints WHERE id = ?`).get(Number(result.lastInsertRowid)) as unknown as Sprint;
}

// Todo pedido novo precisa cair num sprint -- sem sprint ativo, cria um na hora
// (hoje + SPRINT_LENGTH_DAYS) em vez de deixar o card sem lugar.
export function ensureActiveSprint(): Sprint {
  return getActiveSprint() ?? createSprint(spDateString());
}

export function listSprints(): Sprint[] {
  return db.prepare(`SELECT * FROM sprints ORDER BY id DESC`).all() as unknown as Sprint[];
}

export function getSprintById(id: number): Sprint | null {
  const row = db.prepare(`SELECT * FROM sprints WHERE id = ?`).get(id) as unknown as Sprint | undefined;
  return row ?? null;
}

// prazo ajustavel: so valida formato e que o fim nao fica antes do inicio
export function setSprintEndDate(sprintId: number, endDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const sprint = getSprintById(sprintId);
  if (!sprint || endDate < sprint.start_date) return false;
  db.prepare(`UPDATE sprints SET end_date = ? WHERE id = ?`).run(endDate, sprintId);
  return true;
}

// Encerra o sprint ativo e abre o proximo (hoje + 10 dias). O que NAO ficou
// pronto passa pro novo sprint mantendo a coluna em que estava; o que ficou
// "feito" continua no sprint encerrado, pra manter o historico do que
// entregou em cada um.
export function closeActiveSprintAndStartNext(): { closed: Sprint | null; next: Sprint } {
  const active = getActiveSprint();
  if (active) db.prepare(`UPDATE sprints SET status = 'closed' WHERE id = ?`).run(active.id);
  const next = createSprint(spDateString());
  if (active) db.prepare(`UPDATE sprint_cards SET sprint_id = ? WHERE sprint_id = ? AND status != 'feito'`).run(next.id, active.id);
  return { closed: active, next };
}

export function listCards(sprintId: number): SprintCard[] {
  return db.prepare(`SELECT * FROM sprint_cards WHERE sprint_id = ? ORDER BY id ASC`).all(sprintId) as unknown as SprintCard[];
}

export function getCardById(id: number): SprintCard | null {
  const row = db.prepare(`SELECT * FROM sprint_cards WHERE id = ?`).get(id) as unknown as SprintCard | undefined;
  return row ?? null;
}

export function addCard(params: { title: string; description?: string; type?: CardType; status?: CardStatus; sprintId?: number }): SprintCard | null {
  const title = params.title.trim();
  if (!title) return null;
  const sprintId = params.sprintId ?? ensureActiveSprint().id;
  const status = params.status ?? "backlog";
  const result = db
    .prepare(`INSERT INTO sprint_cards (sprint_id, title, description, type, status, done_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sprintId, title, params.description?.trim() || null, params.type ?? "melhoria", status, status === "feito" ? new Date().toISOString() : null);
  return getCardById(Number(result.lastInsertRowid));
}

export function moveCard(id: number, status: CardStatus): boolean {
  const card = getCardById(id);
  if (!card) return false;
  const doneAt = status === "feito" ? (card.done_at ?? new Date().toISOString()) : null;
  db.prepare(`UPDATE sprint_cards SET status = ?, done_at = ? WHERE id = ?`).run(status, doneAt, id);
  return true;
}

export function updateCard(id: number, changes: { title?: string; description?: string; type?: CardType }): boolean {
  const card = getCardById(id);
  if (!card) return false;
  const title = changes.title?.trim() || card.title;
  const description = changes.description !== undefined ? changes.description.trim() || null : card.description;
  db.prepare(`UPDATE sprint_cards SET title = ?, description = ?, type = ? WHERE id = ?`).run(title, description, changes.type ?? card.type, id);
  return true;
}

export function deleteCard(id: number): boolean {
  return db.prepare(`DELETE FROM sprint_cards WHERE id = ?`).run(id).changes > 0;
}

// dias ate o fim do sprint (negativo = atrasado), por aritmetica de data-calendario
export function daysLeft(sprint: Sprint, today: string = spDateString()): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(sprint.end_date) - toUtc(today)) / 86400000);
}
