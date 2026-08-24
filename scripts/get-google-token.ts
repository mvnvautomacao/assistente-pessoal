import "dotenv/config";
import { google } from "googleapis";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

// Duplicado de src/google/auth.ts de proposito: este script roda antes do
// resto do .env existir, entao nao pode depender de src/config.ts.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/spreadsheets",
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de rodar este script");
  }

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}`;

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });

  console.log("\nAbra esse link no navegador e faca login com sua conta Google:\n");
  console.log(authUrl);
  console.log("\nAguardando voce autorizar...\n");

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "", redirectUri);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (error) {
        res.end("<h1>Falha na autorizacao</h1><p>Pode fechar esta aba e conferir o erro no terminal.</p>");
        reject(new Error(`Autorizacao negada: ${error}`));
      } else if (code) {
        res.end("<h1>Autorizado!</h1><p>Pode fechar esta aba e voltar para o terminal.</p>");
        resolve(code);
      }
    });
  });

  server.close();

  const { tokens } = await client.getToken(code);
  console.log("\nPronto! Copie a linha abaixo para o seu .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
