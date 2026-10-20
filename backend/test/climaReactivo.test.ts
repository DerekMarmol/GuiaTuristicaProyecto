import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type {
  ParadaItinerarioActivo,
  RespuestaAceptarPropuestaClima,
  RespuestaEvaluacionClima,
  RespuestaPropuestaClima,
} from "../../shared/types";
import { crearApp, type OpcionesApp } from "../src/app";

const CLAVE_CLIMA = "clave-clima-de-prueba-no-real";
const CLAVE_LUGARES = "clave-lugares-de-prueba-no-real";
const RUTA = "/api/itinerarios/clima-reactivo";
const INICIO = Date.parse("2026-11-20T16:00:00Z"); // 10:00 en Guatemala (UTC-6)
const FECHA = "2026-11-20";

interface Llamada {
  url: URL;
  cuerpo: Record<string, unknown> | null;
}

interface ParadaOpt {
  id: string;
  hora_apertura: string;
  tiempo_estancia_minutos: number;
}

let instante: number;
let llamadas: Llamada[];
let apps: FastifyInstance[];
let app: FastifyInstance;
let climaActual: () => Response;
let pronostico: () => Response;
let lugares: () => Response;
let horarios: Record<string, string | undefined>;
let optimizador: (cuerpo: Record<string, unknown>) => Response | Promise<Response>;

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });

function usarClimaActual(codigo: number, extra: Record<string, unknown> = {}) {
  climaActual = () => json({ dt: Math.floor(instante / 1000) - 300, timezone: -21600, weather: [{ id: codigo, description: `código ${codigo}` }], ...extra });
}

function usarPronostico(pop: number, codigo = 500) {
  const base = Math.floor(INICIO / 1000) - 3600;
  pronostico = () =>
    json({
      city: { timezone: -21600 },
      list: [0, 1, 2].map((i) => ({ dt: base + i * 10800, main: { temp: 20 }, pop, weather: [{ id: codigo, description: "pronóstico" }] })),
    });
}

function usarLugares(lista: { id: string; lat: number; lng: number; categorias?: string[]; nombre?: string; horario?: string }[]) {
  horarios = Object.fromEntries(lista.map((l) => [l.id, l.horario]));
  lugares = () =>
    json({
      type: "FeatureCollection",
      features: lista.map((l) => ({
        type: "Feature",
        properties: { place_id: l.id, name: l.nombre ?? `Museo ${l.id}`, lat: l.lat, lon: l.lng, categories: l.categorias ?? ["entertainment", "entertainment.museum"], formatted: `Dirección ${l.id}` },
      })),
    });
}

const aMin = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));

function ruta(paradas: ParadaOpt[], hora: number) {
  let t = hora;
  const visitas = paradas.map((p) => {
    t += 10;
    const inicio = Math.max(t, aMin(p.hora_apertura));
    t = inicio + p.tiempo_estancia_minutos;
    return { parada_id: p.id, inicio_minutos: inicio, fin_minutos: t, traslado_segundos: 600, distancia_metros: 1000 };
  });
  return { orden: paradas.map((p) => p.id), viable: true, distancia_total_km: paradas.length, duracion_traslado_minutos: paradas.length * 10, visitas };
}

// Imita /reoptimize-clima: conserva el orden y usa el primer candidato de cada grupo.
function optimizadorSimulado(cuerpo: Record<string, unknown>) {
  const paradas = cuerpo.paradas as ParadaOpt[];
  const grupos = cuerpo.sustituciones as { parada_id: string; candidatos: ParadaOpt[] }[];
  const hora = cuerpo.hora_actual_minutos as number;
  const elegidas = new Map(grupos.filter((g) => g.candidatos.length > 0).map((g) => [g.parada_id, g.candidatos[0]]));
  return json({
    ruta_actual: ruta(paradas, hora),
    ruta_propuesta: ruta(paradas.map((p) => elegidas.get(p.id) ?? p), hora),
    motivo_sin_ruta: null,
    sustituciones: [...elegidas].map(([parada_id, c]) => ({ parada_id, alternativa_id: c.id })),
    sin_sustitucion: grupos.filter((g) => g.candidatos.length === 0).map((g) => ({ parada_id: g.parada_id, motivo: "sin_candidatos" })),
  });
}

async function despachar(url: URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const direccion = new URL(String(url));
  llamadas.push({ url: direccion, cuerpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
  if (direccion.hostname === "api.openweathermap.org") {
    return direccion.pathname.endsWith("/weather") ? climaActual() : pronostico();
  }
  if (direccion.pathname === "/v2/places") return lugares();
  if (direccion.pathname === "/v2/place-details") {
    const id = direccion.searchParams.get("id") ?? "";
    return json({ features: [{ properties: { feature_type: "details", place_id: id, opening_hours: horarios[id] } }] });
  }
  if (direccion.hostname === "optimizador.test") return optimizador(llamadas[llamadas.length - 1].cuerpo ?? {});
  throw new Error(`Host no simulado: ${direccion.href}`);
}

function crear(opciones: OpcionesApp = {}): FastifyInstance {
  const instancia = crearApp({
    apiKey: CLAVE_LUGARES,
    fetch: despachar,
    detalles: { intervaloMs: 0 },
    clima: { apiKey: CLAVE_CLIMA, fetch: despachar },
    climaReactivo: { optimizadorUrl: "http://optimizador.test", fetchOptimizador: despachar as typeof fetch, ahora: () => new Date(instante), secreto: "secreto-de-prueba" },
    ...opciones,
  });
  apps.push(instancia);
  return instancia;
}

function paradaActiva(id: string, cambios: Partial<ParadaItinerarioActivo> = {}): ParadaItinerarioActivo {
  return { id, nombre: `Parada ${id}`, lat: 14.6, lng: -90.5, horaApertura: "08:00", horaCierre: "18:00", tiempoEstanciaMinutos: 60, estado: "pendiente", ...cambios };
}

const ITINERARIO = () => ({
  id: "it-1",
  fecha: FECHA,
  paradas: [
    paradaActiva("catedral", { estado: "completada", lat: 14.5586, lng: -90.7295, categorias: ["tourism.sights.place_of_worship"] }),
    paradaActiva("parque", { lat: 14.5600, lng: -90.7300, categorias: ["leisure.park"] }),
    paradaActiva("museo", { lat: 14.5620, lng: -90.7320, categorias: ["entertainment.museum"] }),
  ],
});

function solicitud(cambios: Record<string, unknown> = {}) {
  return { itinerario: ITINERARIO(), modoTransporte: "pedestrian", intereses: ["Cultura"], ...cambios };
}

async function enviar<T>(ruta: string, cuerpo: unknown, instancia = app) {
  const respuesta = await instancia.inject({
    method: "POST",
    url: `${RUTA}${ruta}`,
    headers: { "content-type": "application/json" },
    payload: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.statusCode, texto: respuesta.body, cuerpo: JSON.parse(respuesta.body) as T };
}

const llamadasA = (filtro: (url: URL) => boolean) => llamadas.filter((l) => filtro(l.url));
const aOpenWeather = () => llamadasA((u) => u.hostname === "api.openweathermap.org");
const aGeoapify = () => llamadasA((u) => u.hostname === "api.geoapify.com");
const aOptimizador = () => llamadasA((u) => u.hostname === "optimizador.test");

function sinSecretos(texto: string) {
  for (const secreto of [CLAVE_CLIMA, CLAVE_LUGARES, "appid", "apiKey"]) {
    assert.ok(!texto.includes(secreto), `la respuesta no debe incluir ${secreto}`);
  }
}

beforeEach(() => {
  instante = INICIO;
  llamadas = [];
  apps = [];
  usarClimaActual(800);
  usarPronostico(0.1, 800);
  usarLugares([{ id: "museo-alt", lat: 14.5605, lng: -90.7305, horario: "Mo-Su 09:00-18:00" }]);
  optimizador = optimizadorSimulado;
  mock.method(console, "error", () => {});
  app = crear();
});

afterEach(async () => {
  for (const instancia of apps) await instancia.close();
  mock.restoreAll();
});

describe("POST /clima-reactivo/evaluar", () => {
  test("clima estable: no propone cambios y solo consulta OpenWeather", async () => {
    const { estado, cuerpo, texto } = await enviar<RespuestaEvaluacionClima>("/evaluar", solicitud());
    assert.equal(estado, 200, texto);
    assert.equal(cuerpo.estado, "activo");
    assert.equal(cuerpo.requierePropuesta, false);
    assert.equal(cuerpo.motivo, "sin_riesgo_relevante");
    assert.equal(cuerpo.evaluacion?.nivel, "favorable");
    assert.equal(cuerpo.referencia?.nivel, "favorable");
    assert.equal(cuerpo.proximaEvaluacionSegundos, 720);
    assert.equal(aOpenWeather().length, 2);
    assert.equal(aGeoapify().length + aOptimizador().length, 0);
    sinSecretos(texto);
  });

  test("consulta el clima en la próxima parada pendiente, no en el centro del destino", async () => {
    await enviar("/evaluar", solicitud());
    const consulta = aOpenWeather()[0].url;
    assert.equal(consulta.searchParams.get("lat"), "14.56");
    assert.equal(consulta.searchParams.get("lon"), "-90.73");
  });

  test("una tormenta observada requiere propuesta y advierte sobre seguridad", async () => {
    usarClimaActual(211);
    const { cuerpo } = await enviar<RespuestaEvaluacionClima>("/evaluar", solicitud());
    assert.equal(cuerpo.requierePropuesta, true);
    assert.equal(cuerpo.motivo, "empeoramiento_detectado");
    assert.equal(cuerpo.evaluacion?.senalPrincipal?.origen, "observado");
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "SEGURIDAD"));
    assert.equal(cuerpo.referencia, null);
  });

  test("reutiliza el clima consultado durante su vigencia", async () => {
    await enviar("/evaluar", solicitud());
    instante += 5 * 60_000;
    await enviar("/evaluar", solicitud());
    assert.equal(aOpenWeather().length, 2);
    instante += 6 * 60_000;
    await enviar("/evaluar", solicitud());
    assert.equal(aOpenWeather().length, 4);
  });

  test("solo monitorea el día del itinerario en la hora del destino", async () => {
    const { cuerpo } = await enviar<RespuestaEvaluacionClima>("/evaluar", solicitud({ itinerario: { ...ITINERARIO(), fecha: "2026-11-21" } }));
    assert.equal(cuerpo.estado, "itinerario_no_activo");
    assert.equal(cuerpo.requierePropuesta, false);
  });

  test("sin paradas pendientes se detiene sin consultar proveedores", async () => {
    const itinerario = ITINERARIO();
    itinerario.paradas = itinerario.paradas.map((p) => ({ ...p, estado: "completada" }));
    const { cuerpo } = await enviar<RespuestaEvaluacionClima>("/evaluar", solicitud({ itinerario }));
    assert.equal(cuerpo.estado, "sin_paradas_pendientes");
    assert.equal(llamadas.length, 0);
  });

  test("con una fuente caída evalúa con la otra e informa el fallo", async () => {
    climaActual = () => json({}, 500);
    usarPronostico(0.9);
    const { estado, cuerpo } = await enviar<RespuestaEvaluacionClima>("/evaluar", solicitud());
    assert.equal(estado, 200);
    assert.equal(cuerpo.evaluacion?.nivel, "riesgo_elevado");
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "CLIMA_ACTUAL_NO_DISPONIBLE"));
  });

  test("si OpenWeather rechaza la clave en ambas consultas responde el error del proveedor", async () => {
    climaActual = () => json({ cod: 401 }, 401);
    pronostico = () => json({ cod: 401 }, 401);
    const { estado, cuerpo, texto } = await enviar<{ error: { codigo: string } }>("/evaluar", solicitud());
    assert.equal(estado, 502);
    assert.equal(cuerpo.error.codigo, "PROVEEDOR_CREDENCIALES_INVALIDAS");
    sinSecretos(texto);
  });

  test("sin clave de OpenWeather responde 503 sin llamadas externas", async () => {
    const instancia = crear({ clima: { apiKey: "", fetch: despachar } });
    const { estado, cuerpo } = await enviar<{ error: { codigo: string } }>("/evaluar", solicitud(), instancia);
    assert.equal(estado, 503);
    assert.equal(cuerpo.error.codigo, "SERVICIO_NO_CONFIGURADO");
    assert.equal(llamadas.length, 0);
  });

  const invalidas: [string, unknown, string][] = [
    ["sin itinerario", { modoTransporte: "auto" }, "itinerario"],
    ["fecha irreal", solicitud({ itinerario: { ...ITINERARIO(), fecha: "2026-02-30" } }), "itinerario.fecha"],
    ["coordenada inválida", solicitud({ itinerario: { ...ITINERARIO(), paradas: [paradaActiva("x", { lat: 91 })] } }), "itinerario.paradas.0.lat"],
    ["estado desconocido", solicitud({ itinerario: { ...ITINERARIO(), paradas: [{ ...paradaActiva("x"), estado: "terminada" }] } }), "itinerario.paradas.0.estado"],
    ["ids repetidos", solicitud({ itinerario: { ...ITINERARIO(), paradas: [paradaActiva("x"), paradaActiva("x")] } }), "itinerario.paradas.1.id"],
    ["dos paradas en curso", solicitud({ itinerario: { ...ITINERARIO(), paradas: [paradaActiva("x", { estado: "en_curso" }), paradaActiva("y", { estado: "en_curso" })] } }), "itinerario.paradas"],
    ["transporte público", solicitud({ modoTransporte: "transit" }), "modoTransporte"],
    ["interés desconocido", solicitud({ intereses: ["Ovnis"] }), "intereses.0"],
    ["ubicación sin fecha", solicitud({ ubicacionActual: { lat: 14.6, lng: -90.5 } }), "ubicacionActual.registradaEn"],
    ["referencia con nivel inventado", solicitud({ referencia: { nivel: "diluvio", eventoId: null, evaluadoEn: new Date(INICIO).toISOString(), nivelNotificado: null, ultimaPropuestaEn: null } }), "referencia.nivel"],
  ];
  for (const [nombre, cuerpo, parametro] of invalidas) {
    test(`responde 400 sin consultar proveedores: ${nombre}`, async () => {
      const resultado = await enviar<{ error: { codigo: string; detalles?: { parametro: string }[] } }>("/evaluar", cuerpo);
      assert.equal(resultado.estado, 400, resultado.texto);
      assert.equal(resultado.cuerpo.error.codigo, "PARAMETRO_INVALIDO");
      assert.ok(resultado.cuerpo.error.detalles?.some((d) => d.parametro === parametro), resultado.texto);
      assert.equal(llamadas.length, 0);
    });
  }
});

describe("POST /clima-reactivo/propuesta", () => {
  beforeEach(() => usarClimaActual(211));

  test("propone una alternativa techada sin modificar visitas completadas", async () => {
    const { estado, cuerpo, texto } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.equal(estado, 200, texto);
    const propuesta = cuerpo.propuesta;
    assert.ok(propuesta);
    assert.equal(propuesta.estado, "pendiente");
    assert.deepEqual(propuesta.paradasAfectadas.map((a) => a.paradaId), ["parque"]);
    assert.deepEqual(propuesta.sustituciones.map((s) => [s.paradaOriginalId, s.alternativaId]), [["parque", "museo-alt"]]);
    assert.deepEqual(propuesta.conservadas, ["museo"]);
    assert.deepEqual(propuesta.paradasPendientesPropuestas?.map((p) => p.id), ["museo-alt", "museo"]);
    assert.equal(propuesta.paradasPendientesPropuestas?.[0].placeId, "museo-alt");
    assert.equal(propuesta.paradasPendientesPropuestas?.[0].tipo_entorno, "indoor");
    assert.equal(propuesta.paradasPendientesPropuestas?.[0].horaApertura, "09:00");
    assert.equal(propuesta.paradasPendientesPropuestas?.[0].horaInicioProgramada, "10:10");
    assert.deepEqual(propuesta.rutaAnterior.orden, ["parque", "museo"]);
    assert.deepEqual(propuesta.rutaPropuesta?.visitas.map((v) => v.tipo), ["sustituta", "conservada"]);
    assert.equal(propuesta.alternativas.find((a) => a.idExterno === "museo-alt")?.seleccionada, true);
    assert.equal(propuesta.origen.fuente, "ultima_parada_completada");
    assert.equal(propuesta.horaInicio, "10:00");
    assert.ok(propuesta.token);
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "ORIGEN_APROXIMADO"));
    assert.equal(cuerpo.referencia?.nivelNotificado, "tormenta");
    assert.equal(cuerpo.referencia?.eventoId, cuerpo.evaluacion?.eventoId);

    const [faseActual, fasePropuesta] = aOptimizador().map((l) => l.cuerpo as Record<string, unknown>);
    assert.equal(aOptimizador().length, 2);
    assert.deepEqual((faseActual.paradas as ParadaOpt[]).map((p) => p.id), ["parque", "museo"]);
    assert.deepEqual(faseActual.origen, { lat: 14.5586, lng: -90.7295 });
    assert.equal(faseActual.hora_actual_minutos, 600);
    assert.equal(faseActual.modo_transporte, "pedestrian");
    assert.deepEqual(fasePropuesta.sustituciones, [{
      parada_id: "parque",
      candidatos: [{ id: "museo-alt", lat: 14.5605, lng: -90.7305, hora_apertura: "09:00", hora_cierre: "18:00", tiempo_estancia_minutos: 60 }],
    }]);
    sinSecretos(texto);
  });

  test("no repite la propuesta cuando el cliente devuelve la referencia notificada", async () => {
    const primera = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    instante += 60_000;
    const segunda = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud({ referencia: primera.cuerpo.referencia }));
    assert.equal(segunda.cuerpo.propuesta, null);
    assert.equal(segunda.cuerpo.requierePropuesta, false);
    assert.equal(aOptimizador().length, 2);
  });

  test("las solicitudes simultáneas idénticas comparten la misma propuesta", async () => {
    optimizador = async (cuerpo) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return optimizadorSimulado(cuerpo);
    };
    const [a, b] = await Promise.all([enviar<RespuestaPropuestaClima>("/propuesta", solicitud()), enviar<RespuestaPropuestaClima>("/propuesta", solicitud())]);
    assert.equal(a.cuerpo.propuesta?.id, b.cuerpo.propuesta?.id);
    assert.equal(aOptimizador().length, 2);
  });

  test("sin un cambio significativo no busca alternativas", async () => {
    usarClimaActual(800);
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.equal(cuerpo.propuesta, null);
    assert.equal(aGeoapify().length + aOptimizador().length, 0);
  });

  test("usa la ubicación compartida explícitamente como origen y como punto del clima", async () => {
    const ubicacionActual = { lat: 14.57, lng: -90.74, registradaEn: new Date(INICIO - 60_000).toISOString() };
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud({ ubicacionActual }));
    assert.equal(cuerpo.propuesta?.origen.fuente, "ubicacion_compartida");
    assert.deepEqual(aOptimizador()[0].cuerpo?.origen, { lat: 14.57, lng: -90.74 });
    assert.equal(aOpenWeather()[0].url.searchParams.get("lat"), "14.57");
  });

  test("ignora una ubicación compartida antigua", async () => {
    const ubicacionActual = { lat: 14.57, lng: -90.74, registradaEn: new Date(INICIO - 60 * 60_000).toISOString() };
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud({ ubicacionActual }));
    assert.equal(cuerpo.propuesta?.origen.fuente, "ultima_parada_completada");
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "UBICACION_DESACTUALIZADA"));
  });

  test("conserva la visita en curso y parte desde ella", async () => {
    const itinerario = ITINERARIO();
    itinerario.paradas[1] = { ...itinerario.paradas[1], id: "en-curso", estado: "en_curso", horaFinProgramada: "10:30" };
    itinerario.paradas.push(paradaActiva("mirador", { lat: 14.5610, lng: -90.7310, categorias: ["tourism.attraction.viewpoint"] }));
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud({ itinerario }));
    assert.equal(cuerpo.propuesta?.origen.fuente, "parada_en_curso");
    assert.equal(cuerpo.propuesta?.horaInicio, "10:30");
    const enviadas = (aOptimizador()[0].cuerpo?.paradas as ParadaOpt[]).map((p) => p.id);
    assert.deepEqual(enviadas, ["museo", "mirador"]);
    assert.ok(cuerpo.propuesta?.sustituciones.every((s) => s.paradaOriginalId !== "en-curso"));
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "VISITA_EN_CURSO"));
  });

  test("si ninguna parada pendiente se ve afectada no cambia el itinerario", async () => {
    const itinerario = ITINERARIO();
    itinerario.paradas[1] = { ...itinerario.paradas[1], categorias: ["entertainment.culture"] };
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud({ itinerario }));
    assert.equal(cuerpo.propuesta?.estado, "sin_cambios");
    assert.equal(cuerpo.propuesta?.token, null);
    assert.equal(aGeoapify().length, 0);
  });

  test("sin alternativas techadas responde de forma informativa y conserva el itinerario", async () => {
    usarLugares([]);
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.equal(cuerpo.propuesta?.estado, "sin_alternativas");
    assert.equal(cuerpo.propuesta?.token, null);
    assert.equal(cuerpo.propuesta?.paradasPendientesPropuestas, null);
    assert.equal(aOptimizador().length, 1);
  });

  test("no propone como confirmadas alternativas sin horario publicado", async () => {
    usarLugares([{ id: "sin-horario", lat: 14.5605, lng: -90.7305 }]);
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.equal(cuerpo.propuesta?.estado, "sin_alternativas");
    assert.equal(cuerpo.propuesta?.alternativas[0].disponibilidad, "horario_no_confirmado");
    assert.ok(cuerpo.advertencias.some((a) => a.codigo === "HORARIOS_NO_CONFIRMADOS"));
  });

  test("sin solución viable no declara una ruta y conserva el itinerario", async () => {
    optimizador = (cuerpo) => {
      if ((cuerpo.sustituciones as unknown[]).length === 0) return optimizadorSimulado(cuerpo);
      return json({ ruta_actual: ruta(cuerpo.paradas as ParadaOpt[], 600), ruta_propuesta: null, motivo_sin_ruta: "No se encontró un itinerario válido.", sustituciones: [], sin_sustitucion: [{ parada_id: "parque", motivo: "sin_alternativa_viable" }] });
    };
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.equal(cuerpo.propuesta?.estado, "sin_solucion_viable");
    assert.equal(cuerpo.propuesta?.rutaPropuesta, null);
    assert.equal(cuerpo.propuesta?.token, null);
  });

  const fallosOptimizador: [string, () => Response, number, string][] = [
    ["Valhalla no disponible", () => json({ detail: "El servicio de rutas no está disponible." }, 503), 503, "SERVICIO_RUTAS_NO_DISPONIBLE"],
    ["ruta inaccesible", () => json({ detail: "No existe una ruta entre las paradas para el medio de transporte seleccionado." }, 422), 409, "REOPTIMIZACION_NO_DISPONIBLE"],
    ["respuesta inesperada", () => json({ resultado: "ok" }), 502, "RESPUESTA_OPTIMIZADOR_INVALIDA"],
    ["optimizador caído", () => { throw new TypeError("fetch failed"); }, 502, "OPTIMIZADOR_NO_DISPONIBLE"],
  ];
  for (const [nombre, simular, estado, codigo] of fallosOptimizador) {
    test(`un fallo del optimizador no altera el itinerario: ${nombre}`, async () => {
      optimizador = simular;
      const resultado = await enviar<{ error: { codigo: string } }>("/propuesta", solicitud());
      assert.equal(resultado.estado, estado, resultado.texto);
      assert.equal(resultado.cuerpo.error.codigo, codigo);
    });
  }

  test("rechaza una sustitución que el backend no solicitó", async () => {
    optimizador = (cuerpo) => {
      if ((cuerpo.sustituciones as unknown[]).length === 0) return optimizadorSimulado(cuerpo);
      return json({ ruta_actual: ruta(cuerpo.paradas as ParadaOpt[], 600), ruta_propuesta: ruta([{ id: "inventado", hora_apertura: "08:00", tiempo_estancia_minutos: 60 }, (cuerpo.paradas as ParadaOpt[])[1]], 600), motivo_sin_ruta: null, sustituciones: [{ parada_id: "parque", alternativa_id: "inventado" }], sin_sustitucion: [] });
    };
    const resultado = await enviar<{ error: { codigo: string } }>("/propuesta", solicitud());
    assert.equal(resultado.estado, 502);
    assert.equal(resultado.cuerpo.error.codigo, "RESPUESTA_OPTIMIZADOR_INVALIDA");
  });

  test("un fallo de Geoapify no se presenta como ausencia de alternativas", async () => {
    lugares = () => json({}, 503);
    const resultado = await enviar<{ error: { codigo: string } }>("/propuesta", solicitud());
    assert.equal(resultado.estado, 502);
    assert.equal(resultado.cuerpo.error.codigo, "PROVEEDOR_ERROR");
  });
});

describe("POST /clima-reactivo/aceptar", () => {
  beforeEach(() => usarClimaActual(211));

  async function obtenerPropuesta() {
    const { cuerpo } = await enviar<RespuestaPropuestaClima>("/propuesta", solicitud());
    assert.ok(cuerpo.propuesta?.token);
    return cuerpo.propuesta;
  }

  function aplicar(paradasPendientes: RespuestaAceptarPropuestaClima["paradasPendientes"]) {
    const itinerario = ITINERARIO();
    return {
      ...itinerario,
      paradas: [
        ...itinerario.paradas.filter((p) => p.estado !== "pendiente"),
        ...paradasPendientes.map((p) => ({
          id: p.id, nombre: p.nombre, lat: p.lat, lng: p.lng, horaApertura: p.horaApertura, horaCierre: p.horaCierre,
          tiempoEstanciaMinutos: p.tiempoEstanciaMinutos, estado: "pendiente" as const,
        })),
      ],
    };
  }

  test("aplica la propuesta solo con el estado con que se generó y es idempotente", async () => {
    const propuesta = await obtenerPropuesta();
    const aceptada = await enviar<RespuestaAceptarPropuestaClima>("/aceptar", { token: propuesta.token, itinerario: ITINERARIO() });
    assert.equal(aceptada.estado, 200, aceptada.texto);
    assert.equal(aceptada.cuerpo.yaAplicada, false);
    assert.deepEqual(aceptada.cuerpo.paradasPendientes.map((p) => p.id), ["museo-alt", "museo"]);

    const repetida = await enviar<RespuestaAceptarPropuestaClima>("/aceptar", { token: propuesta.token, itinerario: aplicar(aceptada.cuerpo.paradasPendientes) });
    assert.equal(repetida.estado, 200, repetida.texto);
    assert.equal(repetida.cuerpo.yaAplicada, true);
  });

  test("rechaza la propuesta si el itinerario cambió", async () => {
    const propuesta = await obtenerPropuesta();
    const itinerario = ITINERARIO();
    itinerario.paradas[1] = { ...itinerario.paradas[1], estado: "completada" };
    const resultado = await enviar<{ error: { codigo: string } }>("/aceptar", { token: propuesta.token, itinerario });
    assert.equal(resultado.estado, 409);
    assert.equal(resultado.cuerpo.error.codigo, "PROPUESTA_OBSOLETA");
  });

  test("rechaza una propuesta vencida", async () => {
    const propuesta = await obtenerPropuesta();
    instante += 21 * 60_000;
    const resultado = await enviar<{ error: { codigo: string } }>("/aceptar", { token: propuesta.token, itinerario: ITINERARIO() });
    assert.equal(resultado.estado, 410);
    assert.equal(resultado.cuerpo.error.codigo, "PROPUESTA_VENCIDA");
  });

  test("rechaza una propuesta alterada o firmada por otra instancia", async () => {
    const propuesta = await obtenerPropuesta();
    const [cuerpo, firma] = (propuesta.token as string).split(".");
    const carga = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    carga.paradasPendientes = [];
    const alterado = `${Buffer.from(JSON.stringify(carga)).toString("base64url")}.${firma}`;
    assert.equal((await enviar<{ error: { codigo: string } }>("/aceptar", { token: alterado, itinerario: ITINERARIO() })).cuerpo.error.codigo, "PROPUESTA_INVALIDA");
    const otra = crear({ climaReactivo: { optimizadorUrl: "http://optimizador.test", fetchOptimizador: despachar as typeof fetch, ahora: () => new Date(instante), secreto: "otro-secreto" } });
    assert.equal((await enviar<{ error: { codigo: string } }>("/aceptar", { token: propuesta.token, itinerario: ITINERARIO() }, otra)).estado, 400);
  });

  test("rechaza aplicar la propuesta a otro día del itinerario", async () => {
    const propuesta = await obtenerPropuesta();
    const resultado = await enviar<{ error: { codigo: string } }>("/aceptar", { token: propuesta.token, itinerario: { ...ITINERARIO(), id: "it-2" } });
    assert.equal(resultado.estado, 409);
  });
});
