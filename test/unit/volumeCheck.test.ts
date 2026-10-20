// Card 22, parte 4: verificacao do volume persistente do banco. checkDataVolume e pura: o teste injeta o dispositivo (stat.dev) de cada pasta.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDataVolume,
  EXPECTED_DATA_DIR,
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

test("em container com o banco fora de /app/data (ex: /app/data.sqlite): caminho errado, mesmo que o disco seja outro", () => {
  for (const dbPath of ["/app/data.sqlite", "/data/data.sqlite", "/app/data/sub/data.sqlite"]) {
    const check = checkDataVolume({ dbPath, inContainer: true, deviceOf: devices(2) });
    assert.equal(check.status, "wrong_path", dbPath);
    assert.equal(needsVolumeAlert(check), true);
    assert.match(check.detail, new RegExp(`o banco está em ${dbPath.replace(/\./g, "\\.")}; o volume documentado é /app/data`));
  }
});

test("fora de container (desenvolvimento): nao se aplica, sem aviso e sem consultar o disco", () => {
  let called = false;
  const check = checkDataVolume({
    dbPath: "C:/projeto/data/data.sqlite",
    inContainer: false,
    deviceOf: () => {
      called = true;
      return 1;
    },
  });
  assert.equal(check.status, "not_applicable");
  assert.equal(called, false);
  assert.equal(needsVolumeAlert(check), false);
  assert.equal(volumeInfoText(check), null);
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
  // o proprio runStartupVolumeCheck com o disco de verdade deste ambiente nao lanca
  assert.doesNotThrow(() => runStartupVolumeCheck("./data.sqlite"));
  setVolumeStatusForTests(null);
});

test("checkVolumeAtStartup: sem volume avisa o dono uma vez dentro do cooldown; com volume ou fora de container nao manda nada; falha ao enviar nao derruba", async () => {
  const sent: { to: string; text: string }[] = [];
  const send = async (to: string, text: string) => {
    sent.push({ to, text });
  };
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    resetOwnerAlertForTests();
    const bad = await checkVolumeAtStartup({ dbPath: "/app/data.sqlite", inContainer: true, deviceOf: devices(1), send, ownerNumber: "5511000000000" });
    assert.equal(bad.status, "wrong_path");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "5511000000000");
    assert.match(sent[0].text, /não está em volume persistente/);
    assert.ok(errors.some((e) => String(e[0]).includes("não está em volume persistente")), "console.error na subida");

    await checkVolumeAtStartup({ dbPath: DB, inContainer: true, deviceOf: devices(1), send, ownerNumber: "5511000000000" });
    assert.equal(sent.length, 1, "segundo alerta dentro do cooldown de 1h nao sai");

    resetOwnerAlertForTests();
    const ok = await checkVolumeAtStartup({ dbPath: DB, inContainer: true, deviceOf: devices(2), send });
    assert.equal(ok.status, "ok");
    const dev = await checkVolumeAtStartup({ dbPath: DB, inContainer: false, send });
    assert.equal(dev.status, "not_applicable");
    assert.equal(sent.length, 1, "ok e nao aplicavel nao mandam nada");

    resetOwnerAlertForTests();
    const failing = await checkVolumeAtStartup({
      dbPath: DB,
      inContainer: true,
      deviceOf: devices(1),
      send: async () => {
        throw new Error("Evolution fora do ar");
      },
    });
    assert.equal(failing.status, "no_volume", "falha ao avisar nao muda o resultado nem lanca");

    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => void warns.push(args);
    try {
      const unknown = await checkVolumeAtStartup({
        dbPath: DB,
        inContainer: true,
        deviceOf: () => {
          throw new Error("EIO");
        },
        send,
      });
      assert.equal(unknown.status, "unknown");
      assert.equal(sent.length, 1, "nao verificado nao alarma o dono");
      assert.ok(warns.length >= 1);
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    console.error = originalError;
    resetOwnerAlertForTests();
    setVolumeStatusForTests(null);
  }
});
