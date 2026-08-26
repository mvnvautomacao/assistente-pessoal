// Pre-carregado via "node --require ./dist/test/setup.js --test ..." em CADA
// processo de teste (o test runner do Node roda cada arquivo de teste num
// processo filho separado). Aponta DB_PATH pra um arquivo temporario unico
// (usa o PID do processo pra nunca colidir entre arquivos de teste rodando em
// paralelo), pra nunca tocar no data.sqlite de verdade.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), `assistente-test-${process.pid}-`)), "test.sqlite");
