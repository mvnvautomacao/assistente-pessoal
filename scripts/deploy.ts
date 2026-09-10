import "dotenv/config";

const webhookUrl = process.env.COOLIFY_DEPLOY_WEBHOOK_URL;
const apiToken = process.env.COOLIFY_API_TOKEN;

async function main() {
  if (!webhookUrl || !apiToken) {
    throw new Error("Preencha COOLIFY_DEPLOY_WEBHOOK_URL e COOLIFY_API_TOKEN no .env antes de rodar este script");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!res.ok) {
    throw new Error(`Falha ao disparar o deploy: ${res.status} ${await res.text()}`);
  }

  console.log("Redeploy disparado no Coolify. Acompanhe em Deployment Logs.");
  console.log(await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
