// Pre-carregado via "node --require ./dist/test/setup.js --test ..." em CADA
// processo de teste (o test runner do Node roda cada arquivo de teste num
// processo filho separado). Aponta DB_PATH pra um arquivo temporario unico
// (usa o PID do processo pra nunca colidir entre arquivos de teste rodando em
// paralelo), pra nunca tocar no data.sqlite de verdade.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), `assistente-test-${process.pid}-`)), "test.sqlite");

// Rede de seguranca: nenhum teste chama de verdade a Anthropic nem a Groq (os que precisam simulam a funcao). Quem tenta recebe um erro na hora,
// o mesmo caminho de "IA fora do ar" -- e os testes que trocam o fetch por um mock continuam funcionando (o mock vale por cima).
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (/api\.anthropic\.com|api\.groq\.com/.test(url)) return Promise.reject(new Error("rede bloqueada nos testes: " + url));
  return realFetch(input, init);
}) as typeof fetch;

// Segunda trava (a do fetch acima nao alcanca o cliente da Anthropic, que guarda a propria referencia): aponta a IA para uma porta fechada, entao
// qualquer chamada real falha na hora (o mesmo caminho de "IA fora do ar") em vez de gastar a chave de verdade.
// A porta e propria de cada processo de teste (testes da camada de IA sobem um servidor falso nela, sem atrapalhar os outros arquivos).
process.env.TEST_AI_PORT = String(38000 + (process.pid % 2000));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${process.env.TEST_AI_PORT}`;
