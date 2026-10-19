import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Itinerario, ParadaPropuesta } from "../../shared/types";
import {
  aplicarParadasPropuestas,
  construirItinerarioActivo,
  crearControlSolicitudes,
  esDiaActivo,
  fechaLocal,
  firmaItinerario,
} from "../src/services/climaReactivoEstado.ts";
import { ErrorClimaReactivo, aceptarPropuestaClima, evaluarClimaReactivo } from "../src/services/climaReactivo.ts";

const HOY = new Date(2026, 10, 20, 10, 0);

function dia(paradas: Partial<Itinerario["paradas"][number]>[] = []): Itinerario {
  const base = (id: string, extra = {}) => ({ id, nombre: id, lat: 14.6, lng: -90.5, horaApertura: "08:00", horaCierre: "18:00", tiempoEstanciaMinutos: 60, ...extra });
  return {
    id: "it-1",
    viajeId: "v",
    numeroDia: 1,
    fecha: "2026-11-20",
    paradas: paradas.length > 0
      ? paradas.map((p, i) => base(p.id ?? `p${i}`, p))
      : [base("catedral"), base("parque", { categorias: ["leisure.park"] }), base("museo", { tipo_entorno: "indoor", sensibilidad_clima: "baja" })],
  };
}

const sinEstado = { completadas: new Set<string>(), descartadas: new Set<string>() };

describe("estado del itinerario activo", () => {
  test("marca completadas, descarta las inviables por horario y conserva el orden", () => {
    const itinerario = dia([{ id: "a" }, { id: "b", estadoHorario: "descartada" } as never, { id: "c" }]);
    const activo = construirItinerarioActivo(itinerario, { completadas: new Set(["a"]), descartadas: new Set() });
    assert.deepEqual(activo.paradas.map((p) => [p.id, p.estado]), [["a", "completada"], ["b", "cancelada"], ["c", "pendiente"]]);
  });

  test("envía categorías y clasificación cuando existen", () => {
    const activo = construirItinerarioActivo(dia(), sinEstado);
    assert.deepEqual(activo.paradas[1].categorias, ["leisure.park"]);
    assert.equal(activo.paradas[2].tipo_entorno, "indoor");
    assert.equal("categorias" in activo.paradas[0], false);
  });

  test("la firma cambia si el usuario completa una parada", () => {
    const antes = firmaItinerario(construirItinerarioActivo(dia(), sinEstado));
    const despues = firmaItinerario(construirItinerarioActivo(dia(), { completadas: new Set(["catedral"]), descartadas: new Set() }));
    assert.notEqual(antes, despues);
    assert.equal(antes, firmaItinerario(construirItinerarioActivo(dia(), sinEstado)));
  });

  test("solo está activo el día del itinerario y con paradas pendientes", () => {
    assert.equal(fechaLocal(HOY), "2026-11-20");
    assert.equal(esDiaActivo(construirItinerarioActivo(dia(), sinEstado), HOY), true);
    assert.equal(esDiaActivo(construirItinerarioActivo(dia(), sinEstado), new Date(2026, 10, 21, 9)), false);
    const todas = { completadas: new Set(["catedral", "parque", "museo"]), descartadas: new Set<string>() };
    assert.equal(esDiaActivo(construirItinerarioActivo(dia(), todas), HOY), false);
  });
});

describe("aplicación de una propuesta aceptada", () => {
  const nueva: ParadaPropuesta = {
    id: "geo-1", nombre: "Museo alternativo", lat: 14.61, lng: -90.51, horaApertura: "09:00", horaCierre: "18:00",
    tiempoEstanciaMinutos: 60, placeId: "geo-1", tipo_entorno: "indoor", sensibilidad_clima: "baja", horaInicioProgramada: "10:10",
  };

  test("conserva las visitas completadas y reemplaza solo las pendientes", () => {
    const itinerario = dia();
    const estado = { completadas: new Set(["catedral"]), descartadas: new Set<string>() };
    const museo = { ...itinerario.paradas[2] };
    const paradas = aplicarParadasPropuestas(itinerario.paradas, estado, [nueva, museo]);
    assert.deepEqual(paradas.map((p) => p.id), ["catedral", "geo-1", "museo"]);
    assert.equal(paradas[0], itinerario.paradas[0]);
  });

  test("el resultado coincide con la firma que calcula el backend al aceptar", () => {
    const estado = { completadas: new Set(["catedral"]), descartadas: new Set<string>() };
    const aplicado = { ...dia(), paradas: aplicarParadasPropuestas(dia().paradas, estado, [nueva]) };
    const activo = construirItinerarioActivo(aplicado, estado);
    assert.deepEqual(activo.paradas.map((p) => [p.id, p.estado]), [["catedral", "completada"], ["geo-1", "pendiente"]]);
  });

  test("no duplica visitas al aplicar dos veces la misma propuesta", () => {
    const estado = { completadas: new Set(["catedral"]), descartadas: new Set<string>() };
    const una = aplicarParadasPropuestas(dia().paradas, estado, [nueva]);
    const dos = aplicarParadasPropuestas(una, estado, [nueva]);
    assert.deepEqual(dos.map((p) => p.id), ["catedral", "geo-1"]);
  });
});

describe("control de solicitudes", () => {
  test("impide revisiones simultáneas duplicadas", () => {
    const control = crearControlSolicitudes();
    const primera = control.iniciar();
    assert.equal(primera, 1);
    assert.equal(control.iniciar(), null);
    control.terminar(primera as number);
    assert.equal(control.iniciar(), 2);
  });

  test("una respuesta tardía de una solicitud anterior se descarta", () => {
    const control = crearControlSolicitudes();
    const vieja = control.iniciar() as number;
    control.invalidar();
    const nueva = control.iniciar() as number;
    assert.equal(control.esVigente(vieja), false);
    assert.equal(control.esVigente(nueva), true);
    control.terminar(vieja);
    assert.equal(control.iniciar(), null);
  });
});

describe("servicio HTTP del monitoreo", () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => { globalThis.fetch = fetchOriginal; });

  test("conserva el código y el mensaje del backend cuando falla un proveedor", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { codigo: "PROVEEDOR_TIEMPO_AGOTADO", mensaje: "El proveedor de clima tardó demasiado en responder." } }), { status: 504 });
    await assert.rejects(
      evaluarClimaReactivo({ itinerario: construirItinerarioActivo(dia(), sinEstado) }),
      (e) => e instanceof ErrorClimaReactivo && e.codigo === "PROVEEDOR_TIEMPO_AGOTADO" && e.estado === 504 && /tardó/.test(e.message),
    );
  });

  test("distingue la falta de conexión de un error del proveedor", async () => {
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(evaluarClimaReactivo({ itinerario: construirItinerarioActivo(dia(), sinEstado) }), (e) => e instanceof ErrorClimaReactivo && e.codigo === "SIN_CONEXION");
  });

  test("informa una propuesta obsoleta al aceptar", async () => {
    let cuerpo: unknown = null;
    globalThis.fetch = async (_url, init) => {
      cuerpo = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ error: { codigo: "PROPUESTA_OBSOLETA", mensaje: "El itinerario cambió." } }), { status: 409 });
    };
    const itinerario = construirItinerarioActivo(dia(), sinEstado);
    await assert.rejects(aceptarPropuestaClima("token", itinerario), (e) => e instanceof ErrorClimaReactivo && e.estado === 409);
    assert.deepEqual(cuerpo, { token: "token", itinerario });
  });
});
