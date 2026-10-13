const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");

const RUTA_SERVIDOR = path.join(__dirname, "..", "src", "server.js");

test("el servidor no inicia e indica la variable faltante cuando no hay GEOAPIFY_API_KEY", () => {
  const resultado = spawnSync(process.execPath, [RUTA_SERVIDOR], {
    env: { ...process.env, GEOAPIFY_API_KEY: "", PORT: "0" },
    encoding: "utf8",
    timeout: 10000,
  });

  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /GEOAPIFY_API_KEY/);
});

async function puertoLibre() {
  const servidor = net.createServer();
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const { port } = servidor.address();
  servidor.close();
  await once(servidor, "close");
  return port;
}

test("el servidor inicia sin OPENWEATHER_API_KEY y GET /api/clima/pronostico responde 503", async () => {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [RUTA_SERVIDOR], {
    env: { ...process.env, GEOAPIFY_API_KEY: "clave-geo-de-prueba-no-real", OPENWEATHER_API_KEY: "", PORT: String(puerto) },
  });

  try {
    let salida = "";
    let errores = "";
    hijo.stderr.on("data", (fragmento) => {
      errores += fragmento;
    });
    await new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error("El servidor no inició a tiempo.")), 10000);
      hijo.stdout.on("data", (fragmento) => {
        salida += fragmento;
        if (salida.includes("Backend escuchando")) {
          clearTimeout(limite);
          resolve();
        }
      });
      hijo.on("exit", (codigo) => {
        clearTimeout(limite);
        reject(new Error(`El servidor terminó con código ${codigo}.`));
      });
    });

    assert.match(errores, /OPENWEATHER_API_KEY/);
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/api/clima/pronostico?lat=14.6&lng=-90.5&fechaInicio=2026-10-12&fechaFin=2026-10-13`);
    const cuerpo = await respuesta.json();
    assert.equal(respuesta.status, 503);
    assert.equal(cuerpo.error.codigo, "SERVICIO_NO_CONFIGURADO");
  } finally {
    hijo.kill();
  }
});
