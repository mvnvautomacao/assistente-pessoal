// Card 22, parte 4 (e a revisao): verificacao do volume persistente do banco. checkDataVolume e pura: o teste injeta o dispositivo (stat.dev) de cada pasta.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDataVolume,
  EXPECTED_DATA_DIR,
  freshDatabaseText,
  getVolumeStatus,
  needsVolumeAlert,
  runStartupVolumeCheck,
  setVolumeStatusForTests,
  volumeInfoText,
  volumeWarningText,
} from "../../src/storage/volumeCheck";
import { checkVolumeAtStartup } from "../../src/storage/volumeAlert";
import { resetOwnerAlertForTests } from "../../src/access/ownerAlert";

const DB = "/app/data/data.sqlite";
// "/" no dispositivo 1; a pasta de dados no dispositivo do volume (2) ou no mesmo disco do container (1)
const devices = (data: number) => (path: string) => (path === "/" ? 1 : data);
const FAST = { initialDelayMs: 0, retryDelayMs: 0 };

test("em container com /app/data em outro dispositivo que '/': ok (volume montado)", () => {
  const check = checkDataVolume({ dbPath: DB, inContainer: true, deviceOf: devices(2) });
  assert.equal(check.status, "ok");
  assert.equal(needsVolumeAlert(check), false);
  assert.equal(volumeInfoText(check), `Banco: ${DB} · volume persistente verificado`);
});

test("em container com /app/data no mesmo dispositivo que '/': sem volume persistente", () => {
  const check = checkDataVolume({ dbPath: DB, inContainer: true, deviceOf: devices(1) });
  assert.equal(check.status, "no_volume");
  assert.equal(needsVolumeAlert(check), true);
  assert.match(check.detail, /mesmo disco do container/);
  assert.equal(volumeInfoText(check), null);
});

test("banco fora de /app/data no disco do container (ex: /app/data.sqlite): sem volume, com alerta", () => {
  for (const dbPath of ["/app/data.sqlite", "/data/data.sqlite", "/app/data/sub/data.sqlite"]) {
    const check = checkDataVolume({ dbPath, inContainer: true, deviceOf: devices(1) });
    assert.equal(check.status, "no_volume", dbPath);
    assert.equal(needsVolumeAlert(check), true);
    assert.match(volumeWarningText(check), new RegExp(`O banco \\(${dbPath.replace(/\./g, "\\.")}\\) não está em volume persistente`));
  }
});

test("volume montado em OUTRO caminho (ex: /data): so informa, sem alarme falso", () => {
  const check = checkDataVolume({ dbPath: "/data/data.sqlite", inContainer: true, deviceOf: devices(2) });
  assert.equal(check.status, "wrong_path");
  assert.equal(needsVolumeAlert(check), false);
  assert.match(check.detail, /\/data é um volume montado, mas o documentado é \/app\/data/);
  assert.equal(volumeInfoText(check), "Banco: /data/data.sqlite · volume montado, mas fora de /app/data (confira se é o volume persistente)");
});

test("fora de container (desenvolvimento): nao se aplica, sem aviso e sem consultar o disco", () => {
  let called = false;
  const check = checkDataVolume({
    dbPath: "C:/projeto/data/data.sqlite",
    inContainer: false,
    freshDatabase: true,
    deviceOf: () => {
      called = true;
      return 1;
    },
  });
  assert.equal(check.status, "not_applicable");
  assert.equal(called, false);
  assert.equal(needsVolumeAlert(check), false);
  assert.equal(volumeInfoText(check), null);
  assert.equal(freshDatabaseText(check), null, "em desenvolvimento banco novo e normal");
});

test("falha ao consultar o disco: 'unknown' com o motivo, sem lancar; texto discreto no /admin", () => {
  const check = checkDataVolume({
    dbPath: DB,
    inContainer: true,
    deviceOf: () => {
      throw new Error("EACCES: permission denied");
    },
  });
  assert.equal(check.status, "unknown");
  assert.match(check.detail, /EACCES/);
  assert.equal(needsVolumeAlert(check), false);
  assert.match(volumeInfoText(check)!, /volume não verificado \(não foi possível verificar: EACCES/);
});

test("texto do aviso: caminho do banco, perda de dados e o passo no Coolify", () => {
  const check = checkDataVolume({ dbPath: "/app/data.sqlite", inContainer: true, deviceOf: devices(1) });
  assert.equal(
    volumeWarningText(check),
    "⚠️ O banco (/app/data.sqlite) não está em volume persistente. A cada deploy, mensagens contadas, rotinas, lembretes e pendências se perdem. No Coolify: Storages → volume persistente em /app/data."
  );
  assert.equal(EXPECTED_DATA_DIR, "/app/data");
});

test("banco criado vazio nesta subida (em container): aviso proprio, com ou sem volume; banco que ja existia nao avisa", () => {
  const fresh = checkDataVolume({ dbPath: DB, inContainer: true, deviceOf: devices(2), freshDatabase: true });
  assert.equal(fresh.status, "ok");
  assert.match(freshDatabaseText(fresh)!, /O banco \(\/app\/data\/data\.sqlite\) foi criado vazio nesta subida\. Se você esperava encontrar dados, confira o DB_PATH e o volume em \/app\/data/);
  assert.ok(freshDatabaseText(checkDataVolume({ dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: true })));
  assert.equal(freshDatabaseText(checkDataVolume({ dbPath: DB, inContainer: true, deviceOf: devices(2) })), null);
  assert.equal(freshDatabaseText({ status: "unknown", dbPath: DB, detail: "x" }), null);
});

test("runStartupVolumeCheck: guarda o resultado em memoria; caminho relativo vira absoluto; erro inesperado vira 'unknown'", () => {
  setVolumeStatusForTests(null);
  assert.equal(getVolumeStatus(), null);
  const ok = runStartupVolumeCheck(DB, true, devices(2));
  assert.equal(ok.status, "ok");
  assert.equal(getVolumeStatus(), ok);
  const dev = runStartupVolumeCheck("./data/data.sqlite", false);
  assert.equal(dev.status, "not_applicable");
  assert.match(dev.dbPath, /\/data\/data\.sqlite$/);
  const broken = runStartupVolumeCheck(DB, true, () => {
    throw new Error("boom");
  });
  assert.equal(broken.status, "unknown");
  assert.equal(runStartupVolumeCheck(DB, true, devices(2), true).freshDatabase, true);
  // o proprio runStartupVolumeCheck com o disco de verdade deste ambiente nao lanca
  assert.doesNotThrow(() => runStartupVolumeCheck("./data.sqlite"));
  setVolumeStatusForTests(null);
});

test("checkVolumeAtStartup: sem volume avisa o dono uma vez dentro do cooldown; com volume ou fora de container nao manda nada", async () => {
  const sent: { to: string; text: string }[] = [];
  const send = async (to: string, text: string) => {
    sent.push({ to, text });
  };
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    resetOwnerAlertForTests();
    const bad = await checkVolumeAtStartup({ ...FAST, dbPath: "/app/data.sqlite", inContainer: true, deviceOf: devices(1), freshDatabase: false, send, ownerNumber: "5511000000000" });
    assert.equal(bad.status, "no_volume");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "5511000000000");
    assert.match(sent[0].text, /não está em volume persistente/);
    assert.ok(errors.some((e) => String(e[0]).includes("não está em volume persistente")), "console.error na subida");

    await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: false, send, ownerNumber: "5511000000000" });
    assert.equal(sent.length, 1, "segundo alerta dentro do cooldown de 1h nao sai");

    resetOwnerAlertForTests();
    const ok = await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(2), freshDatabase: false, send });
    assert.equal(ok.status, "ok");
    const outroCaminho = await checkVolumeAtStartup({ ...FAST, dbPath: "/data/data.sqlite", inContainer: true, deviceOf: devices(2), freshDatabase: false, send });
    assert.equal(outroCaminho.status, "wrong_path");
    const dev = await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: false, freshDatabase: true, send });
    assert.equal(dev.status, "not_applicable");
    assert.equal(sent.length, 1, "ok, volume em outro caminho e nao aplicavel nao mandam nada");
  } finally {
    console.error = originalError;
    resetOwnerAlertForTests();
    setVolumeStatusForTests(null);
  }
});

test("checkVolumeAtStartup: o envio espera o atraso inicial e tenta de novo; so some o alerta se TODAS as tentativas falharem (e a chave e liberada)", async () => {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    resetOwnerAlertForTests();
    // a Evolution so responde na 3a tentativa: o alerta chega e o cooldown vale
    let calls = 0;
    const flaky = async () => {
      if (++calls < 3) throw new Error("Evolution subindo");
    };
    await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: false, send: flaky });
    assert.equal(calls, 3);
    const again = await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: false, send: flaky });
    assert.equal(again.status, "no_volume");
    assert.equal(calls, 3, "enviou com sucesso: cooldown de 1h vale");

    // falha total: a chave e liberada e a proxima subida tenta de novo
    resetOwnerAlertForTests();
    let failures = 0;
    const down = async () => {
      failures++;
      throw new Error("Evolution fora do ar");
    };
    const result = await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: false, send: down });
    assert.equal(result.status, "no_volume", "falha ao avisar nao muda o resultado nem lanca");
    assert.equal(failures, 3);
    const retry: string[] = [];
    await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: false, send: async (_to, text) => void retry.push(text) });
    assert.equal(retry.length, 1, "a chave foi liberada depois da falha total");

    // espera de verdade: com atraso inicial, o envio so acontece depois dele
    resetOwnerAlertForTests();
    const order: string[] = [];
    const pending = checkVolumeAtStartup({
      dbPath: DB,
      inContainer: true,
      deviceOf: devices(1),
      freshDatabase: false,
      initialDelayMs: 40,
      send: async () => void order.push("enviou"),
    });
    assert.deepEqual(order, [], "ainda esperando a Evolution subir");
    assert.ok(getVolumeStatus(), "mas o status do /admin ja esta pronto");
    await pending;
    assert.deepEqual(order, ["enviou"]);
  } finally {
    console.error = originalError;
    resetOwnerAlertForTests();
    setVolumeStatusForTests(null);
  }
});

test("checkVolumeAtStartup: banco criado vazio avisa o dono (uma vez, aviso proprio) e 'nao verificado' so vai pro log", async () => {
  const sent: string[] = [];
  const send = async (_to: string, text: string) => void sent.push(text);
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args);
  try {
    resetOwnerAlertForTests();
    const fresh = await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(2), freshDatabase: true, send });
    assert.equal(fresh.status, "ok");
    assert.equal(sent.length, 1);
    assert.match(sent[0], /foi criado vazio nesta subida/);
    await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(2), freshDatabase: true, send });
    assert.equal(sent.length, 1, "cooldown");

    resetOwnerAlertForTests();
    sent.length = 0;
    await checkVolumeAtStartup({ ...FAST, dbPath: DB, inContainer: true, deviceOf: devices(1), freshDatabase: true, send });
    assert.equal(sent.length, 2, "sem volume E banco novo: dois avisos distintos");

    resetOwnerAlertForTests();
    sent.length = 0;
    const unknown = await checkVolumeAtStartup({
      ...FAST,
      dbPath: DB,
      inContainer: true,
      freshDatabase: false,
      deviceOf: () => {
        throw new Error("EIO");
      },
      send,
    });
    assert.equal(unknown.status, "unknown");
    assert.equal(sent.length, 0, "nao verificado nao alarma o dono");
    assert.ok(warns.length >= 1);
  } finally {
    console.warn = originalWarn;
    resetOwnerAlertForTests();
    setVolumeStatusForTests(null);
  }
});
