import "dotenv/config";

// Registra/move cards do Kanban de sprints (/admin/sprints) a partir do terminal,
// falando com o /admin de producao com as credenciais do .env (ADMIN_USERNAME /
// ADMIN_PASSWORD). Todo pedido novo (melhoria, evolucao, incidente) deve virar
// um card aqui.
//
//   npm run sprint -- list
//   npm run sprint -- add "Titulo do card" [--type melhoria|evolucao|incidente] [--status backlog|refinado|a_fazer|fazendo|testando|feito] [--desc "detalhes"]
//   npm run sprint -- move <id> <status>

const base = process.env.SPRINT_BASE_URL ?? "https://marcusvnv.com.br";

async function login(): Promise<string> {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) throw new Error("Preencha ADMIN_USERNAME e ADMIN_PASSWORD no .env");
  const res = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password: pass }),
    redirect: "manual",
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`Login no /admin falhou (${res.status})`);
  return cookie;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const cookie = await login();
  const headers = { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

  if (command === "list") {
    const data = (await (await fetch(`${base}/admin/sprints.json`, { headers: { Cookie: cookie } })).json()) as {
      sprint: { name: string; start_date: string; end_date: string };
      cards: { id: number; type: string; status: string; title: string }[];
    };
    console.log(`${data.sprint.name} (${data.sprint.start_date} a ${data.sprint.end_date})`);
    for (const c of data.cards) console.log(`#${c.id} [${c.status}] (${c.type}) ${c.title}`);
    return;
  }

  if (command === "add") {
    const title = args[0];
    if (!title) throw new Error('Uso: npm run sprint -- add "Titulo" [--type ...] [--status ...] [--desc ...]');
    const res = await fetch(`${base}/admin/sprints/cards`, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        title,
        type: flag(args, "type") ?? "melhoria",
        status: flag(args, "status") ?? "backlog",
        description: flag(args, "desc") ?? "",
      }),
    });
    const body = (await res.json()) as { card: { id: number; status: string } | null };
    if (!body.card) throw new Error("Nao criou o card (titulo vazio?)");
    console.log(`Card #${body.card.id} criado em "${body.card.status}"`);
    return;
  }

  if (command === "move") {
    const [id, status] = args;
    if (!id || !status) throw new Error("Uso: npm run sprint -- move <id> <status>");
    await fetch(`${base}/admin/sprints/cards/${id}/move`, { method: "POST", headers, body: new URLSearchParams({ status }), redirect: "manual" });
    console.log(`Card #${id} -> ${status}`);
    return;
  }

  throw new Error("Comandos: list | add | move");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
