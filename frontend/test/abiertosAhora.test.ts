import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LugarAbiertoAhora, RespuestaLugaresAbiertosAhora } from "../../shared/types";
import {
  ErrorAbiertosAhora,
  consultarAbiertosAhora,
  etiquetaCategoria,
  formatearDistancia,
  horaDelLugar,
  lugaresParaMapa,
} from "../src/services/abiertosAhora.ts";
import { crearControladorAbiertosAhora, type EstadoAbiertosAhora } from "../src/services/abiertosAhoraEstado.ts";
import { ErrorUbicacion, obtenerUbicacionActual, type UbicacionActual } from "../src/services/ubicacionActual.ts";
import { BarraAbiertosAhora, ResultadosAbiertosAhora } from "../src/components/AbiertosAhora.tsx";

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

function lugar(id: string, extra: Partial<LugarAbiertoAhora> = {}): LugarAbiertoAhora {
  return {
    idExterno: id,
    proveedor: "geoapify",
    nombre: `Lugar ${id}`,
    direccion: `Dirección ${id}`,
    lat: 14.6433,
    lng: -90.5131,
    categorias: ["tourism", "tourism.sights"],
    tipo_entorno: "outdoor",
    sensibilidad_clima: "alta",
    regla_clima: null,
    horario: { estado: "disponible", valorOriginal: "Mo-Fr 08:00-16:00", fuente: "geoapify" },
    open_now: true,
    estadoApertura: "abierto",
    evaluadoEn: "2026-10-19T21:02:43.145Z",
    zonaHoraria: "America/Guatemala",
    horaLocalEvaluacion: "2026-10-19T15:02-06:00",
    cierreEstimado: "2026-10-19T16:00-06:00",
    distanciaMetros: 32,
    ...extra,
  };
}

function respuesta(lugares: LugarAbiertoAhora[] = [lugar("a")], extra: Partial<RespuestaLugaresAbiertosAhora> = {}): RespuestaLugaresAbiertosAhora {
  return {
    evaluadoEn: "2026-10-19T21:02:43.145Z",
    criterio: "horarios_publicados",
    origen: { lat: 14.6431, lng: -90.5133 },
    radioMetros: 2000,
    limite: 10,
    categorias: ["tourism.attraction"],
    categoriasPredeterminadas: true,
    total: lugares.length,
    cobertura: { candidatosEvaluados: 3, limiteCandidatos: 30, busquedaLimitada: false, abiertos: lugares.length, cerrados: 0, desconocidos: 2, desconocidosPorMotivo: { no_publicado: 2 } },
    lugares,
    ...extra,
  };
}

const UBICACION: UbicacionActual = { lat: 14.6431, lng: -90.5133, precisionMetros: 25, obtenidaEn: "2026-10-19T21:00:00.000Z" };

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

interface Pendiente<T> {
  promesa: Promise<T>;
  resolver: (valor: T) => void;
  rechazar: (error: unknown) => void;
}

function pendiente<T>(): Pendiente<T> {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Servicio HTTP
// ---------------------------------------------------------------------------

describe("consultarAbiertosAhora", () => {
  test("consulta el endpoint real con coordenadas, radio, límite e intereses", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetchImpl = (async (entrada: string, opciones?: RequestInit) => {
      url = entrada;
      init = opciones;
      return json(respuesta());
    }) as typeof fetch;

    const resultado = await consultarAbiertosAhora({ lat: 14.6431, lng: -90.5133, intereses: ["Cultura", "Gastronomía"] }, undefined, { fetchImpl });

    const [ruta, consulta] = url.split("?");
    assert.equal(ruta, "/api/lugares/abiertos-ahora");
    const parametros = new URLSearchParams(consulta);
    assert.equal(parametros.get("lat"), "14.643100");
    assert.equal(parametros.get("lng"), "-90.513300");
    assert.equal(parametros.get("radio"), "2000");
    assert.equal(parametros.get("limite"), "10");
    assert.equal(parametros.get("intereses"), "Cultura,Gastronomía");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.deepEqual(resultado.lugares.map((l) => l.idExterno), ["a"]);
  });

  test("sin intereses no envía el parámetro y usa la búsqueda general del backend", async () => {
    let url = "";
    const fetchImpl = (async (entrada: string) => {
      url = entrada;
      return json(respuesta([]));
    }) as typeof fetch;

    const resultado = await consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl });

    assert.equal(new URLSearchParams(url.split("?")[1]).has("intereses"), false);
    assert.deepEqual(resultado.lugares, []);
  });

  test("rechaza coordenadas inválidas sin llamar al backend", async () => {
    let llamadas = 0;
    const fetchImpl = (async () => {
      llamadas += 1;
      return json(respuesta());
    }) as typeof fetch;

    for (const [lat, lng] of [[Number.NaN, 0], [91, 0], [0, 181], [Number.POSITIVE_INFINITY, 0]]) {
      await assert.rejects(consultarAbiertosAhora({ lat, lng }, undefined, { fetchImpl }), (e) => e instanceof ErrorAbiertosAhora && e.codigo === "COORDENADAS_INVALIDAS");
    }
    assert.equal(llamadas, 0);
  });

  test("solo conserva los lugares con open_now === true", async () => {
    const cerrado = { ...lugar("x"), open_now: false } as unknown as LugarAbiertoAhora;
    const fetchImpl = (async () => json(respuesta([lugar("a"), cerrado]))) as typeof fetch;

    const resultado = await consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl });

    assert.deepEqual(resultado.lugares.map((l) => l.idExterno), ["a"]);
  });

  test("conserva el código y el mensaje del backend en un error HTTP", async () => {
    const fetchImpl = (async () =>
      json({ error: { codigo: "PROVEEDOR_DETALLES_NO_DISPONIBLES", mensaje: "No fue posible obtener los horarios." } }, 502)) as typeof fetch;

    await assert.rejects(
      consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl }),
      (e) => e instanceof ErrorAbiertosAhora && e.codigo === "PROVEEDOR_DETALLES_NO_DISPONIBLES" && e.estado === 502 && /horarios/.test(e.message),
    );
  });

  test("distingue la falta de conexión", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    await assert.rejects(consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl }), (e) => e instanceof ErrorAbiertosAhora && e.codigo === "SIN_CONEXION");
  });

  test("cancela la petición y responde TIEMPO_AGOTADO si el servidor no contesta", async () => {
    let senal: AbortSignal | undefined;
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        senal = init?.signal ?? undefined;
        senal?.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")));
      })) as typeof fetch;

    await assert.rejects(consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl, tiempoEsperaMs: 20 }), (e) => e instanceof ErrorAbiertosAhora && e.codigo === "TIEMPO_AGOTADO");
    assert.equal(senal?.aborted, true);
  });

  test("la cancelación del llamador aborta la petición sin convertirla en error del servidor", async () => {
    const controlador = new AbortController();
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")));
      })) as typeof fetch;

    const promesa = consultarAbiertosAhora({ lat: 1, lng: 2 }, controlador.signal, { fetchImpl });
    controlador.abort();

    await assert.rejects(promesa, (e) => !(e instanceof ErrorAbiertosAhora) && (e as Error).name === "AbortError");
  });

  test("rechaza una respuesta con formato inesperado", async () => {
    for (const cuerpo of [null, { lugares: "x" }, { evaluadoEn: "x", cobertura: {} }]) {
      const fetchImpl = (async () => json(cuerpo)) as typeof fetch;
      await assert.rejects(consultarAbiertosAhora({ lat: 1, lng: 2 }, undefined, { fetchImpl }), (e) => e instanceof ErrorAbiertosAhora && e.codigo === "RESPUESTA_INVALIDA");
    }
  });
});

describe("utilidades de presentación", () => {
  test("lugaresParaMapa no duplica marcadores y descarta coordenadas inválidas", () => {
    const lugares = [lugar("a"), lugar("a"), lugar("b", { lat: Number.NaN }), lugar("c", { lng: 200 }), lugar("d")];
    assert.deepEqual(lugaresParaMapa(lugares).map((l) => l.idExterno), ["a", "d"]);
  });

  test("etiquetas de categoría, distancia y hora local del lugar", () => {
    assert.equal(etiquetaCategoria(["entertainment", "entertainment.museum"]), "Museo");
    assert.equal(etiquetaCategoria(["building", "tourism.sights.castle"]), "Sitio de interés");
    assert.equal(etiquetaCategoria(["otra.cosa"]), "Lugar de interés");
    assert.equal(formatearDistancia(32), "32 m");
    assert.equal(formatearDistancia(1500), "1.5 km");
    assert.equal(horaDelLugar("2026-10-19T16:00-06:00"), "16:00");
    assert.equal(horaDelLugar(null), null);
  });
});

// ---------------------------------------------------------------------------
// Geolocalización
// ---------------------------------------------------------------------------

type Exito = Parameters<Geolocation["getCurrentPosition"]>[0];
type Fallo = NonNullable<Parameters<Geolocation["getCurrentPosition"]>[1]>;

function geolocalizacion(responder: (exito: Exito, fallo: Fallo, opciones?: PositionOptions) => void) {
  const llamadas: (PositionOptions | undefined)[] = [];
  return {
    llamadas,
    geo: {
      getCurrentPosition(exito: Exito, fallo?: Fallo | null, opciones?: PositionOptions) {
        llamadas.push(opciones);
        responder(exito, fallo as Fallo, opciones);
      },
    },
  };
}

const AHORA = Date.parse("2026-10-19T21:00:30Z");

function posicion(lat: number, lng: number, timestamp = AHORA - 10_000, accuracy = 24.6) {
  return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp } as GeolocationPosition;
}

function errorGeo(code: number) {
  return { code, message: "" } as GeolocationPositionError;
}

describe("obtenerUbicacionActual", () => {
  test("permiso concedido: devuelve coordenadas válidas una sola vez", async () => {
    const { geo, llamadas } = geolocalizacion((exito) => exito(posicion(14.6431, -90.5133)));

    const ubicacion = await obtenerUbicacionActual({ geolocalizacion: geo, ahora: () => AHORA });

    assert.deepEqual(ubicacion, { lat: 14.6431, lng: -90.5133, precisionMetros: 25, obtenidaEn: "2026-10-19T21:00:20.000Z" });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0]?.timeout, 15_000);
  });

  test("permiso denegado, posición no disponible y tiempo agotado", async () => {
    for (const [code, motivo] of [[1, "permiso_denegado"], [2, "no_disponible"], [3, "tiempo_agotado"]] as const) {
      const { geo } = geolocalizacion((_exito, fallo) => fallo(errorGeo(code)));
      await assert.rejects(obtenerUbicacionActual({ geolocalizacion: geo }), (e) => e instanceof ErrorUbicacion && e.motivo === motivo);
    }
  });

  test("navegador sin soporte de geolocalización", async () => {
    await assert.rejects(obtenerUbicacionActual({ geolocalizacion: null }), (e) => e instanceof ErrorUbicacion && e.motivo === "no_soportada");
  });

  test("rechaza coordenadas inválidas", async () => {
    for (const [lat, lng] of [[Number.NaN, 0], [95, 0], [0, -190]]) {
      const { geo } = geolocalizacion((exito) => exito(posicion(lat, lng)));
      await assert.rejects(obtenerUbicacionActual({ geolocalizacion: geo, ahora: () => AHORA }), (e) => e instanceof ErrorUbicacion && e.motivo === "coordenadas_invalidas");
    }
  });

  test("ante una lectura guardada demasiado antigua pide una posición nueva una sola vez", async () => {
    const lecturas = [posicion(14.6, -90.5, AHORA - 6 * 60_000), posicion(14.7, -90.6)];
    const nueva = geolocalizacion((exito) => exito(lecturas.shift()!));
    const ubicacion = await obtenerUbicacionActual({ geolocalizacion: nueva.geo, ahora: () => AHORA });
    assert.deepEqual([ubicacion.lat, ubicacion.lng], [14.7, -90.6]);
    assert.deepEqual(nueva.llamadas.map((o) => o?.maximumAge), [60_000, 0]);

    const siempreVieja = geolocalizacion((exito) => exito(posicion(14.6, -90.5, AHORA - 6 * 60_000)));
    await assert.rejects(obtenerUbicacionActual({ geolocalizacion: siempreVieja.geo, ahora: () => AHORA }), (e) => e instanceof ErrorUbicacion && e.motivo === "ubicacion_antigua");
    assert.equal(siempreVieja.llamadas.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Controlador del modo
// ---------------------------------------------------------------------------

function controladorDePrueba() {
  const ubicaciones: Pendiente<UbicacionActual>[] = [];
  const consultas: { consulta: { lat: number; lng: number; intereses?: string[] }; signal: AbortSignal; pendiente: Pendiente<RespuestaLugaresAbiertosAhora> }[] = [];
  const controlador = crearControladorAbiertosAhora({
    obtenerUbicacion: () => {
      const p = pendiente<UbicacionActual>();
      ubicaciones.push(p);
      return p.promesa;
    },
    consultar: (consulta, signal) => {
      const p = pendiente<RespuestaLugaresAbiertosAhora>();
      consultas.push({ consulta, signal, pendiente: p });
      return p.promesa;
    },
  });
  const fases: EstadoAbiertosAhora["fase"][] = [];
  controlador.suscribir(() => fases.push(controlador.obtenerEstado().fase));
  return { controlador, ubicaciones, consultas, fases };
}

describe("controlador del modo Abierto ahora", () => {
  test("al activar pide la ubicación, consulta y muestra los lugares abiertos", async () => {
    const { controlador, ubicaciones, consultas, fases } = controladorDePrueba();

    controlador.alternar();
    assert.equal(controlador.obtenerEstado().fase, "ubicando");
    ubicaciones[0].resolver(UBICACION);
    await tick();
    assert.equal(controlador.obtenerEstado().fase, "cargando");
    assert.deepEqual(consultas[0].consulta, { lat: 14.6431, lng: -90.5133, intereses: [] });
    consultas[0].pendiente.resolver(respuesta());
    await tick();

    const estado = controlador.obtenerEstado();
    assert.equal(estado.fase, "listo");
    assert.equal(estado.fase === "listo" && estado.referencia.tipo, "actual");
    assert.deepEqual(fases, ["ubicando", "cargando", "listo"]);
  });

  test("ignora activaciones repetidas mientras busca", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    controlador.activar();
    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    controlador.activar();
    controlador.actualizarUbicacion();

    assert.equal(ubicaciones.length, 1);
    assert.equal(consultas.length, 1);
  });

  test("desactivar durante la ubicación no consulta al backend aunque llegue la posición", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    controlador.desactivar();
    ubicaciones[0].resolver(UBICACION);
    await tick();

    assert.equal(consultas.length, 0);
    assert.equal(controlador.obtenerEstado().fase, "inactivo");
  });

  test("desactivar durante la consulta la cancela y una respuesta tardía no reactiva el modo", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    controlador.alternar();
    assert.equal(consultas[0].signal.aborted, true);
    consultas[0].pendiente.resolver(respuesta());
    await tick();

    assert.equal(controlador.obtenerEstado().fase, "inactivo");
  });

  test("una respuesta tardía no reemplaza los resultados de una búsqueda más reciente", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    controlador.cambiarIntereses(["Cultura"]);
    assert.equal(consultas.length, 2);
    assert.deepEqual(consultas[1].consulta.intereses, ["Cultura"]);

    consultas[1].pendiente.resolver(respuesta([lugar("nuevo")]));
    await tick();
    consultas[0].pendiente.resolver(respuesta([lugar("viejo")]));
    await tick();

    const estado = controlador.obtenerEstado();
    assert.ok(estado.fase === "listo");
    assert.deepEqual(estado.respuesta.lugares.map((l) => l.idExterno), ["nuevo"]);
  });

  test("permiso denegado: informa el motivo y permite elegir una parada como punto de referencia", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].rechazar(new ErrorUbicacion("permiso_denegado"));
    await tick();
    const sinUbicacion = controlador.obtenerEstado();
    assert.ok(sinUbicacion.fase === "sin_ubicacion");
    assert.equal(sinUbicacion.motivo, "permiso_denegado");
    assert.equal(consultas.length, 0);

    controlador.usarPuntoManual({ lat: Number.NaN, lng: 0, etiqueta: "inválido" });
    assert.equal(consultas.length, 0);
    controlador.usarPuntoManual({ lat: 14.64, lng: -90.51, etiqueta: "la parada Catedral" });
    consultas[0].pendiente.resolver(respuesta([]));
    await tick();

    const estado = controlador.obtenerEstado();
    assert.ok(estado.fase === "listo");
    assert.deepEqual(estado.referencia, { tipo: "manual", lat: 14.64, lng: -90.51, etiqueta: "la parada Catedral" });
    assert.deepEqual(estado.respuesta.lugares, []);
  });

  test("un error del servidor permite reintentar con la misma referencia", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    consultas[0].pendiente.rechazar(new ErrorAbiertosAhora("El proveedor no respondió.", "PROVEEDOR_TIEMPO_AGOTADO", 504));
    await tick();
    const error = controlador.obtenerEstado();
    assert.ok(error.fase === "error");
    assert.equal(error.codigo, "PROVEEDOR_TIEMPO_AGOTADO");

    controlador.reintentar();
    assert.equal(ubicaciones.length, 1);
    assert.deepEqual([consultas[1].consulta.lat, consultas[1].consulta.lng], [UBICACION.lat, UBICACION.lng]);
  });

  test("no conserva la ubicación al desactivar: al reactivar la vuelve a pedir", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    consultas[0].pendiente.resolver(respuesta());
    await tick();
    controlador.desactivar();
    controlador.activar();

    assert.equal(ubicaciones.length, 2);
  });

  test("actualizar ubicación pide una posición nueva solo por acción explícita", async () => {
    const { controlador, ubicaciones, consultas } = controladorDePrueba();

    controlador.activar();
    ubicaciones[0].resolver(UBICACION);
    await tick();
    consultas[0].pendiente.resolver(respuesta());
    await tick();
    assert.equal(ubicaciones.length, 1);

    controlador.actualizarUbicacion();
    assert.equal(ubicaciones.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

const PUNTOS = [{ id: "p1", nombre: "Catedral", lat: 14.64, lng: -90.51 }];
const sinAccion = () => {};

function barra(estado: EstadoAbiertosAhora, intereses: string[] = []) {
  return renderToStaticMarkup(
    createElement(BarraAbiertosAhora, {
      estado,
      filtro: "turisticos",
      interesesViaje: intereses,
      puntos: PUNTOS,
      onAlternar: sinAccion,
      onCambiarFiltro: sinAccion,
      onActualizarUbicacion: sinAccion,
      onUsarPunto: sinAccion,
      onReintentar: sinAccion,
    }),
  );
}

function resultados(estado: EstadoAbiertosAhora, seleccionadoId: string | null = null) {
  return renderToStaticMarkup(createElement(ResultadosAbiertosAhora, { estado, seleccionadoId, onSeleccionar: sinAccion }));
}

const REFERENCIA = { tipo: "actual" as const, ...UBICACION };

describe("botón Abierto ahora", () => {
  test("desactivado: botón nativo con texto visible, estado no presionado y sin carga", () => {
    const html = barra({ fase: "inactivo" });
    assert.match(html, /<button type="button" class="btn-abierto-ahora" aria-pressed="false" aria-busy="false" aria-controls="resultados-abiertos-ahora"/);
    assert.match(html, /<span>Abierto ahora<\/span>/);
    assert.match(html, /abierto-icono/);
    assert.doesNotMatch(html, /<select/);
  });

  test("cargando: presionado, ocupado y con un mensaje de estado anunciado", () => {
    const html = barra({ fase: "ubicando" });
    assert.match(html, /aria-pressed="true" aria-busy="true"/);
    assert.match(html, /abierto-cargando/);
    assert.match(html, /role="status" aria-live="polite">Obteniendo tu ubicación…/);

    assert.match(barra({ fase: "cargando", referencia: REFERENCIA }), /Buscando lugares abiertos cerca de tu ubicación actual \(±25 m\)…/);
  });

  test("activo con intereses del viaje: permite elegir el filtro", () => {
    const html = barra({ fase: "listo", referencia: REFERENCIA, respuesta: respuesta() }, ["Cultura", "Arte"]);
    assert.match(html, /<option value="turisticos" selected="">Lugares turísticos<\/option>/);
    assert.match(html, /Mis intereses \(Cultura, Arte\)/);
    assert.match(html, /Actualizar ubicación/);
  });

  test("sin ubicación: explica el motivo y ofrece una parada como punto de referencia", () => {
    const html = barra({ fase: "sin_ubicacion", motivo: "permiso_denegado", mensaje: new ErrorUbicacion("permiso_denegado").message });
    assert.match(html, /No se pudo usar tu ubicación actual\./);
    assert.match(html, /No diste permiso para usar tu ubicación/);
    assert.match(html, /Intentar de nuevo/);
    assert.match(html, /Buscar cerca de una parada del itinerario/);
    assert.match(html, /<option value="p1" selected="">Catedral<\/option>/);

    assert.doesNotMatch(barra({ fase: "sin_ubicacion", motivo: "no_soportada", mensaje: "x" }), /Intentar de nuevo/);
  });

  test("error del servidor: alerta y botón para reintentar", () => {
    const html = barra({ fase: "error", referencia: REFERENCIA, mensaje: "No fue posible obtener los horarios.", codigo: "PROVEEDOR_DETALLES_NO_DISPONIBLES" });
    assert.match(html, /role="alert">No fue posible obtener los horarios\./);
    assert.match(html, />Reintentar</);
  });
});

describe("resultados del modo Abierto ahora", () => {
  test("no muestra nada cuando el modo está desactivado o cargando", () => {
    assert.equal(resultados({ fase: "inactivo" }), "");
    assert.equal(resultados({ fase: "cargando", referencia: REFERENCIA }), "");
  });

  test("muestra tarjetas con nombre, dirección, distancia, estado textual, categoría y horario publicado", () => {
    const html = resultados({ fase: "listo", referencia: REFERENCIA, respuesta: respuesta([lugar("a", { nombre: "Palacio Nacional" }), lugar("b", { direccion: null, cierreEstimado: null })]) }, "a");
    assert.match(html, /<h4>Palacio Nacional<\/h4>/);
    assert.match(html, /Dirección a/);
    assert.match(html, /Abierto ahora<\/span>/);
    assert.match(html, /Sitio de interés/);
    assert.match(html, /a 32 m en línea recta/);
    assert.match(html, /Cierra a las 16:00/);
    assert.match(html, /Sin cierre en las próximas 48 h/);
    assert.match(html, /Horario publicado: Mo-Fr 08:00-16:00/);
    assert.match(html, /aria-pressed="true">Mostrando en el mapa/);
    assert.match(html, /aria-pressed="false">Ver en el mapa/);
    assert.match(html, /ninguno se agrega a tu itinerario/);
    assert.equal((html.match(/class="lugar lugar-abierto/g) ?? []).length, 2);
    assert.doesNotMatch(html, /Dirección b/);
  });

  test("respuesta vacía: mensaje sin afirmar que todo está cerrado", () => {
    const html = resultados({ fase: "listo", referencia: REFERENCIA, respuesta: respuesta([]) });
    assert.match(html, /No se encontraron lugares con apertura confirmada cerca de esta ubicación\./);
    assert.match(html, /2 lugares cercanos no publican un horario que se pueda verificar/);
    assert.doesNotMatch(html, /todos .*cerrados/i);
  });

  test("un punto elegido no se presenta como la ubicación actual", () => {
    const html = resultados({ fase: "listo", referencia: { tipo: "manual", lat: 14.64, lng: -90.51, etiqueta: "la parada Catedral" }, respuesta: respuesta() });
    assert.match(html, /la parada Catedral \(punto elegido, no es tu ubicación actual\)/);
  });

  test("avisa cuando el backend solo revisó una parte de la zona", () => {
    const base = respuesta();
    const html = resultados({ fase: "listo", referencia: REFERENCIA, respuesta: { ...base, cobertura: { ...base.cobertura, busquedaLimitada: true, candidatosEvaluados: 30 } } });
    assert.match(html, /Se revisaron los 30 lugares más cercanos/);
  });
});
