import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearCadenaDeModelos, estadoHttp, leerModelos, MODELO_PREDETERMINADO } from "../src/ai/modelos";

const errorGemini = (codigo: number) => new Error(JSON.stringify({ error: { code: codigo, message: "…" } }));

describe("cadena de modelos de Gemini", () => {
  test("lee uno o varios modelos de GEMINI_MODEL", () => {
    assert.deepEqual(leerModelos("gemini-3.6-flash"), ["gemini-3.6-flash"]);
    assert.deepEqual(leerModelos(" a , b,,a "), ["a", "b"]);
    assert.deepEqual(leerModelos(undefined), [MODELO_PREDETERMINADO]);
    assert.deepEqual(leerModelos(""), [MODELO_PREDETERMINADO]);
  });

  test("con la cuota agotada pasa al siguiente modelo", async () => {
    const usados: string[] = [];
    const cadena = crearCadenaDeModelos(["a", "b", "c"]);
    const respuesta = await cadena(async (modelo) => {
      usados.push(modelo);
      if (modelo === "a") throw errorGemini(429);
      return `ok ${modelo}`;
    });
    assert.equal(respuesta, "ok b");
    assert.deepEqual(usados, ["a", "b"]);
  });

  test("también salta un modelo que no existe (404)", async () => {
    const cadena = crearCadenaDeModelos(["viejo", "nuevo"]);
    assert.equal(await cadena(async (m) => { if (m === "viejo") throw errorGemini(404); return m; }), "nuevo");
  });

  test("otros errores no cambian de modelo", async () => {
    const usados: string[] = [];
    const cadena = crearCadenaDeModelos(["a", "b"]);
    await assert.rejects(cadena(async (m) => { usados.push(m); throw errorGemini(503); }), (e) => estadoHttp(e) === 503);
    assert.deepEqual(usados, ["a"]);
  });

  test("si todos están agotados, el error sigue siendo de cuota", async () => {
    const cadena = crearCadenaDeModelos(["a", "b"]);
    await assert.rejects(cadena(async () => { throw errorGemini(429); }), (e) => estadoHttp(e) === 429);
  });

  test("un modelo agotado se salta durante un minuto y luego se vuelve a probar", async () => {
    let reloj = 0;
    const usados: string[] = [];
    const cadena = crearCadenaDeModelos(["a", "b"], () => reloj);
    const llamar = async (m: string) => {
      usados.push(m);
      if (m === "a" && reloj === 0) throw errorGemini(429);
      return m;
    };
    await cadena(llamar);
    await cadena(llamar);
    reloj = 61_000;
    assert.equal(await cadena(llamar), "a");
    assert.deepEqual(usados, ["a", "b", "b", "a"]);
  });
});
