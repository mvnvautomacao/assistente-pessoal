import { Router, Request, Response, NextFunction } from "express";
import { renderLoginPage } from "./layout";
import { normalizeBrazilPhone } from "./utils";
import { isNumberAllowed } from "../access/allowlist";
import { sendText } from "../whatsapp/client";
import { createSession, getSession, destroySession, DASHBOARD_SESSION_TTL_MS } from "../auth/session";
import { generatePassword, hashPassword, verifyPassword } from "../auth/password";
import { getDashboardAccount, upsertDashboardPassword, canSendPasswordNow } from "./accounts";

export const dashboardAuthRouter = Router();

export const SESSION_COOKIE = "organizai_session";

// hash valido de uma senha que ninguem tem -- usado so pra gastar o mesmo
// tempo de bcrypt quando a conta nem existe, senao um login pra numero sem
// conta responde muito mais rapido que um com senha errada e da pra
// descobrir por timing quais numeros tem conta (mesmo problema que o
// anti-enumeracao do request-password ja evita do outro lado).
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8T.SU7ZqDNJa4gZWBLNFtCiE9dvvVW";

function cookieOptions(req: Request, maxAgeMs: number) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  return { httpOnly: true, secure: isHttps, sameSite: "lax" as const, maxAge: maxAgeMs };
}

// Sempre a mesma resposta, mande a senha de verdade ou nao -- nao da pra
// descobrir se um numero tem conta/esta liberado so tentando (anti-enumeracao).
async function sendPasswordForRequest(req: Request, res: Response) {
  const digits = String(req.body.phone || "").replace(/\D/g, "");
  if (digits.length === 11) {
    await maybeSendNewPassword(`55${digits}`);
  }
  res.send(renderLoginPage({ sent: true }));
}

// Gera+manda uma senha nova pro numero, se ele estiver autorizado e (a nao ser
// que bypassCooldown seja true) respeitando o limite de 1 envio por hora.
// Reaproveitada tanto pelo autoatendimento quanto pelo reset do /admin.
export async function maybeSendNewPassword(rawPhone: string, options?: { bypassCooldown?: boolean }): Promise<boolean> {
  const phoneNumber = normalizeBrazilPhone(rawPhone);
  if (!phoneNumber || !isNumberAllowed(phoneNumber)) return false;
  if (!options?.bypassCooldown && !canSendPasswordNow(phoneNumber)) return false;

  const password = generatePassword();
  const hash = await hashPassword(password);
  upsertDashboardPassword(phoneNumber, hash);
  await sendText(
    phoneNumber,
    `🔑 Sua senha de acesso ao painel Organizaí: ${password}\n\nUse com o número de WhatsApp pra entrar no painel. Não peça essa senha pra ninguém, nem pelo próprio WhatsApp.`
  );
  return true;
}

dashboardAuthRouter.post("/dashboard/request-password", async (req, res) => {
  await sendPasswordForRequest(req, res);
});

dashboardAuthRouter.post("/dashboard/login", async (req, res) => {
  const digits = String(req.body.phone || "").replace(/\D/g, "");
  const password = String(req.body.password || "");
  const phoneNumber = digits.length === 11 ? normalizeBrazilPhone(`55${digits}`) : "";

  const account = phoneNumber ? getDashboardAccount(phoneNumber) : null;
  const valid = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !valid) {
    res.status(401).send(renderLoginPage({ error: "Número ou senha incorretos." }));
    return;
  }

  const token = createSession({ type: "dashboard", phone: phoneNumber }, DASHBOARD_SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, DASHBOARD_SESSION_TTL_MS));
  res.redirect("/dashboard");
});

dashboardAuthRouter.post("/dashboard/logout", (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.redirect("/dashboard");
});

// Roda antes dos 6 roteadores de feature (expenses/incomes/categories/
// paymentMethods/events/reminders). Sessao valida: injeta req.query.phone (e
// assim eles continuam lendo o numero do jeito que sempre leram, via
// getPhone(req), sem precisar mudar nada internamente) e segue. Sessao
// invalida/ausente: mostra a tela de login direto, nunca chega nas rotas.
export function requireDashboardSession(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req.cookies?.[SESSION_COOKIE]);
  if (!session || session.type !== "dashboard") {
    res.send(renderLoginPage());
    return;
  }
  (req.query as Record<string, unknown>).phone = session.phone;
  next();
}
