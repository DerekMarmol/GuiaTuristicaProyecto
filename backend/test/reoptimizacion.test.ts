import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { manejarErrores } from "../src/errores";
import { crearRutaReoptimizacion } from "../src/routes/reoptimizacion";

const PARADAS = [
  { id: "a", lat: 14.6425, lng: -90.5133, horaApertura: "08:00", horaCierre: "18:00", tiempoEstanciaMinutos: 30 },
  { id: "b", lat: 14.6066, lng: -90.5059, horaApertura: "09:00", horaCierre: "17:00", tiempoEstanciaMinutos: 60 },
];

interface Llamada {
  url: string;
  cuerpo: Record<string, unknown>;
}

function crearApp(responder: () => Response) {
  const llamadas: Llamada[] = [];
  const fetchImpl = (async (url: URL | RequestInfo, opciones?: RequestInit) => {
    llamadas.push({ url: String(url), cuerpo: JSON.parse(String(opciones?.body)) });
    return responder();
  }) as typeof fetch;
  const app = Fastify();
  app.setErrorHandler(manejarErrores);
  app.register(crearRutaReoptimizacion({ url: "http://optimizador.test", fetchImpl }), { prefix: "/api/itinerarios" });
  return { app, llamadas };
}

function respuestaOptimizador(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });
}

const ORDEN_VALIDO = () => respuestaOptimizador({ orden_optimo: ["b", "a"], distancia_total_km: 4.73 });

function reoptimizar(app: ReturnType<typeof Fastify>, cuerpo: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/itinerarios/reoptimizar",
    payload: { tipo: "retraso", paradas: PARADAS, horaActualMinutos: 600, ...cuerpo },
  });
}

describe("POST /api/itinerarios/reoptimizar con medio de transporte", () => {
  for (const modo of ["auto", "pedestrian"] as const) {
    test(`envía modo_transporte=${modo} al optimizador`, async () => {
      const { app, llamadas } = crearApp(ORDEN_VALIDO);

      const respuesta = await reoptimizar(app, { modoTransporte: modo });

      assert.equal(respuesta.statusCode, 200, respuesta.body);
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0].url, "http://optimizador.test/reoptimize");
      assert.equal(llamadas[0].cuerpo.modo_transporte, modo);
      assert.deepEqual(respuesta.json().ordenOptimo, ["b", "a"]);
      assert.equal(respuesta.json().distanciaTotalKm, 4.73);
    });
  }

  test("usa auto cuando la solicitud no indica el medio", async () => {
    const { app, llamadas } = crearApp(ORDEN_VALIDO);

    const respuesta = await reoptimizar(app, {});

    assert.equal(respuesta.statusCode, 200, respuesta.body);
    assert.equal(llamadas[0].cuerpo.modo_transporte, "auto");
    assert.equal(llamadas[0].cuerpo.hora_actual_minutos, 600);
  });

  for (const modo of ["bicycle", "Automovil", "A pie", "", null, 1]) {
    test(`rechaza el medio no admitido ${JSON.stringify(modo)} sin llamar al optimizador`, async () => {
      const { app, llamadas } = crearApp(ORDEN_VALIDO);

      const respuesta = await reoptimizar(app, { modoTransporte: modo });

      assert.equal(respuesta.statusCode, 400);
      assert.equal(respuesta.json().error.codigo, "PARAMETRO_INVALIDO");
      assert.match(respuesta.json().error.mensaje, /auto o pedestrian/);
      assert.equal(llamadas.length, 0);
    });
  }

  test("informa 503 cuando el servicio de rutas no está disponible", async () => {
    const { app } = crearApp(() => respuestaOptimizador({ detail: "El servicio de rutas no está disponible." }, 503));

    const respuesta = await reoptimizar(app, { modoTransporte: "pedestrian" });

    assert.equal(respuesta.statusCode, 503);
    assert.equal(respuesta.json().error.codigo, "SERVICIO_RUTAS_NO_DISPONIBLE");
  });

  test("conserva 409 cuando no hay itinerario viable", async () => {
    const { app } = crearApp(() => respuestaOptimizador({ detail: "No se encontró un itinerario válido." }, 422));

    const respuesta = await reoptimizar(app, {});

    assert.equal(respuesta.statusCode, 409);
    assert.equal(respuesta.json().error.codigo, "REOPTIMIZACION_NO_DISPONIBLE");
  });

  test("conserva 502 ante otros errores del optimizador", async () => {
    const { app } = crearApp(() => respuestaOptimizador({ detail: "respuesta inválida" }, 502));

    const respuesta = await reoptimizar(app, {});

    assert.equal(respuesta.statusCode, 502);
    assert.equal(respuesta.json().error.codigo, "REOPTIMIZACION_NO_DISPONIBLE");
  });
});
