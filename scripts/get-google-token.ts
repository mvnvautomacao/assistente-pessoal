import "dotenv/config";
import { google } from "googleapis";
import * as readline from "node:readline/promises";
import { SCOPES } from "../src/google/auth";

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de rodar este script");
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });

  console.log("\n1. Abra esse link no navegador e faca login com sua conta Google:\n");
  console.log(authUrl);
  console.log("\n2. Copie o codigo que aparecer na tela e cole aqui embaixo.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question("Codigo: ");
  rl.close();

  const { tokens } = await client.getToken(code.trim());
  console.log("\nPronto! Copie a linha abaixo para o seu .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
