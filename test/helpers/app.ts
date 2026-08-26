import express from "express";
import type { AddressInfo } from "node:net";
import { dashboardRouter } from "../../src/dashboard";

// Sobe um servidor real (porta efemera) so com o dashboard montado, igual em
// producao (index.ts) mas sem os schedulers nem o webhook do WhatsApp — os
// testes de dashboard nao precisam disso.
export async function startDashboardTestServer() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(dashboardRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
