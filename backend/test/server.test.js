const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("el servidor no inicia e indica la variable faltante cuando no hay GEOAPIFY_API_KEY", () => {
  const resultado = spawnSync(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
    env: { ...process.env, GEOAPIFY_API_KEY: "", PORT: "0" },
    encoding: "utf8",
    timeout: 10000,
  });

  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /GEOAPIFY_API_KEY/);
});
