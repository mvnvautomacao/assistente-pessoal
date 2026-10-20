// Card 22, parte 4: o /admin mostra o aviso vermelho quando o banco nao esta em volume persistente e a linha discreta quando esta tudo certo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminTestServer } from "../helpers/app";
import { renderVolumeBanner } from "../../src/admin";
import { checkDataVolume, setVolumeStatusForTests } from "../../src/storage/volumeCheck";

const devices = (data: number) => (path: string) => (path === "/" ? 1 : data);
const check = (dbPath: string, dataDevice: number, inContainer = true) => checkDataVolume({ dbPath, inContainer, deviceOf: devices(dataDevice) });

test("renderVolumeBanner: aviso vermelho (sem volume e caminho errado), linha discreta (ok e nao verificado) e nada (nao aplicavel ou sem verificacao)", () => {
  assert.equal(renderVolumeBanner(null), "");
  assert.equal(renderVolumeBanner(check("/app/data/data.sqlite", 1, false)), "");

  const semVolume = renderVolumeBanner(check("/app/data/data.sqlite", 1));
  assert.match(semVolume, /class="warn"[^>]*background:#fdecea/);
  assert.match(semVolume, /O banco \(\/app\/data\/data\.sqlite\) não está em volume persistente\./);
  assert.match(semVolume, /No Coolify: Storages → volume persistente em \/app\/data\./);

  const errado = renderVolumeBanner(check("/app/data.sqlite", 2));
  assert.match(errado, /O banco \(\/app\/data\.sqlite\) não está em volume persistente/);
  assert.match(errado, /o volume documentado é \/app\/data/);

  const ok = renderVolumeBanner(check("/app/data/data.sqlite", 2));
  assert.doesNotMatch(ok, /class="warn"/);
  assert.match(ok, /Banco: \/app\/data\/data\.sqlite · volume persistente verificado/);

  const naoVerificado = renderVolumeBanner(
    checkDataVolume({
      dbPath: "/app/data/data.sqlite",
      inContainer: true,
      deviceOf: () => {
        throw new Error("<EIO>");
      },
    })
  );
  assert.match(naoVerificado, /volume não verificado/);
  assert.match(naoVerificado, /&lt;EIO&gt;/, "o motivo vai escapado");
});

test("/admin: o aviso aparece no topo da pagina conforme o status guardado na subida", async () => {
  const server = await startAdminTestServer();
  try {
    const get = async () => (await fetch(`${server.baseUrl}/admin`, { headers: server.authHeaders!() })).text();

    setVolumeStatusForTests(null);
    let html = await get();
    assert.doesNotMatch(html, /volume persistente/);

    setVolumeStatusForTests(check("/app/data.sqlite", 1));
    html = await get();
    assert.match(html, /O banco \(\/app\/data\.sqlite\) não está em volume persistente/);
    assert.ok(html.indexOf("não está em volume persistente") < html.indexOf("Sprints (Kanban)"), "o aviso vem antes de todo o resto");

    setVolumeStatusForTests(check("/app/data/data.sqlite", 2));
    html = await get();
    assert.doesNotMatch(html, /não está em volume persistente/);
    assert.match(html, /Banco: \/app\/data\/data\.sqlite · volume persistente verificado/);
  } finally {
    setVolumeStatusForTests(null);
    await server.close();
  }
});
