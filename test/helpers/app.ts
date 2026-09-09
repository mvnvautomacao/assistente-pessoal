import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import { dashboardRouter } from "../../src/dashboard";
import { adminRouter } from "../../src/admin";
import { createSession, DASHBOARD_SESSION_TTL_MS } from "../../src/auth/session";
import { SESSION_COOKIE } from "../../src/dashboard/auth";

// Sobe um servidor real (porta efemera) so com o dashboard montado, igual em
// producao (index.ts) mas sem os schedulers nem o webhook do WhatsApp — os
// testes de dashboard nao precisam disso.
export async function startDashboardTestServer() {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(dashboardRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    // Cria uma sessao direto (sem passar por senha/bcrypt/WhatsApp) pra usar
    // nos testes -- devolve o header Cookie pronto pra colar no `fetch(...)`.
    authHeaders: (phone: string): Record<string, string> => {
      const token = createSession({ type: "dashboard", phone }, DASHBOARD_SESSION_TTL_MS);
      return { Cookie: `${SESSION_COOKIE}=${token}` };
    },
  };
}

// Mesma ideia, com o /admin montado em vez do /dashboard.
export async function startAdminTestServer() {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(adminRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
