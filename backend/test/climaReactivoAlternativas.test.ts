import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ParadaAfectada, ParadaItinerarioActivo, SenalClima } from "../../shared/types";
import { CONFIGURACION_CLIMA_REACTIVO } from "../src/config/climaReactivo";
import { determinarAfectadas } from "../src/clima/reactivo/afectadas";
import { crearBuscadorAlternativas, esAlternativaInterior } from "../src/clima/reactivo/alternativas";
import { relojLocal } from "../src/clima/reactivo/tiempo";
import { ErrorApi } from "../src/errores";
import type { ConsultaBusqueda } from "../src/geoapify/cliente";
import { ventanasDelDia, type Horario } from "../src/geoapify/horario";
import type { Lugar } from "../src/geoapify/transformar";
import { clasificarEntorno } from "../src/clima/clasificacion";

const AHORA = new Date("2026-11-20T16:00:00Z");
const RELOJ = relojLocal(AHORA, -21600);
const FECHA = "2026-11-20";

function parada(id: string, cambios: Partial<ParadaItinerarioActivo> = {}): ParadaItinerarioActivo {
  return { id, nombre: `Parada ${id}`, lat: 14.6, lng: -90.5, horaApertura: "08:00", horaCierre: "18:00", tiempoEstanciaMinutos: 60, estado: "pendiente", ...cambios };
}

function senal(nivel: SenalClima["nivel"], desdeLocal: string, hastaLocal: string, origen: SenalClima["origen"] = "pronosticado"): SenalClima {
  const instante = (hora: string) => new Date(`${FECHA}T${hora}:00-06:00`).toISOString();
  return { origen, nivel, condicion: nivel === "tormenta" ? "tormenta" : "lluvia_moderada", codigoOpenWeather: 501, descripcion: null, desde: instante(desdeLocal), hasta: instante(hastaLocal), probabilidadPrecipitacion: 0.8, lluviaMm: 9, periodoLluviaHoras: 3 };
}

describe("hora local del destino", () => {
  test("usa el desplazamiento de OpenWeather y no la zona horaria del servidor", () => {
    assert.equal(RELOJ.fecha, "2026-11-20");
    assert.equal(RELOJ.minutos, 600);
    assert.equal(relojLocal(new Date("2026-11-21T03:30:00Z"), -21600).fecha, "2026-11-20");
  });
});

describe("paradas afectadas", () => {
  const LLUVIA_MEDIODIA = [senal("lluvia_significativa", "11:00", "14:00")];

  test("solo marca exteriores sensibles cuyo horario estimado coincide con el riesgo", () => {
    const afectadas = determinarAfectadas(
      [
        { parada: parada("parque", { categorias: ["leisure.park"] }), inicio: 660, fin: 720 },
        { parada: parada("museo", { categorias: ["entertainment.museum"] }), inicio: 720, fin: 780 },
        { parada: parada("mirador", { categorias: ["tourism.attraction.viewpoint"] }), inicio: 900, fin: 960 },
      ],
      LLUVIA_MEDIODIA,
      RELOJ,
      3,
    );
    assert.deepEqual(afectadas.map((a) => a.paradaId), ["parque"]);
    assert.equal(afectadas[0].clasificacion.fuente, "categorias");
    assert.equal(afectadas[0].inicioEstimado, "11:00");
    assert.match(afectadas[0].motivo, /exterior con sensibilidad alta/);
  });

  test("la sensibilidad media solo se afecta con lluvia significativa o tormenta", () => {
    const castillo = { parada: parada("castillo", { categorias: ["tourism.sights.castle"] }), inicio: 660, fin: 720 };
    assert.equal(determinarAfectadas([castillo], [senal("riesgo_elevado", "11:00", "14:00")], RELOJ, 3).length, 0);
    assert.equal(determinarAfectadas([castillo], LLUVIA_MEDIODIA, RELOJ, 3).length, 1);
  });

  test("respeta la clasificación enviada por el itinerario", () => {
    const afectadas = determinarAfectadas(
      [{ parada: parada("x", { tipo_entorno: "indoor", sensibilidad_clima: "baja", categorias: ["leisure.park"] }), inicio: 660, fin: 720 }],
      LLUVIA_MEDIODIA,
      RELOJ,
      3,
    );
    assert.equal(afectadas.length, 0);
  });

  test("sin categorías aplica la regla por defecto del proyecto y lo advierte", () => {
    const [afectada] = determinarAfectadas([{ parada: parada("sin-categoria"), inicio: 660, fin: 720 }], LLUVIA_MEDIODIA, RELOJ, 3);
    assert.equal(afectada.clasificacion.fuente, "supuesta");
    assert.equal(afectada.clasificacion.tipo_entorno, "outdoor");
    assert.match(afectada.motivo, /supuesta/);
  });

  test("sin horario estimado considera el resto del día", () => {
    const afectadas = determinarAfectadas([{ parada: parada("p", { categorias: ["leisure.park"] }), inicio: null, fin: null }], [senal("tormenta", "16:00", "19:00")], RELOJ, 3);
    assert.equal(afectadas.length, 1);
    assert.equal(afectadas[0].inicioEstimado, null);
  });

  test("limita cuántas paradas se analizan sin ocultar las demás", () => {
    const programadas = ["a", "b", "c"].map((id) => ({ parada: parada(id, { categorias: ["leisure.park"] }), inicio: 660, fin: 720 }));
    const afectadas = determinarAfectadas(programadas, LLUVIA_MEDIODIA, RELOJ, 2);
    assert.deepEqual(afectadas.map((a) => [a.paradaId, a.analizada]), [["a", true], ["b", true], ["c", false]]);
  });
});

describe("ventanas de apertura", () => {
  const horario = (valor: string): Horario => ({ estado: "disponible", valorOriginal: valor, fuente: "geoapify" });
  const viernes = { anio: 2026, mes: 11, dia: 20 };

  test("devuelve los intervalos del día confirmados por la fuente", () => {
    assert.deepEqual(ventanasDelDia(horario("Mo-Fr 09:00-12:30,14:00-18:00"), viernes), {
      estado: "disponible",
      ventanas: [{ inicioMinutos: 540, finMinutos: 750 }, { inicioMinutos: 840, finMinutos: 1080 }],
    });
    assert.deepEqual(ventanasDelDia(horario("Sa-Su 09:00-17:00"), viernes), { estado: "disponible", ventanas: [] });
    assert.deepEqual(ventanasDelDia(horario("24/7"), viernes), { estado: "disponible", ventanas: [{ inicioMinutos: 0, finMinutos: 1440 }] });
  });

  test("no inventa horarios cuando no son verificables", () => {
    assert.deepEqual(ventanasDelDia({ estado: "no_publicado", valorOriginal: null, fuente: "geoapify" }, viernes), { estado: "desconocido", motivo: "no_publicado" });
    assert.deepEqual(ventanasDelDia({ estado: "error_consulta", valorOriginal: null, fuente: "geoapify" }, viernes), { estado: "desconocido", motivo: "error_consulta" });
    assert.equal(ventanasDelDia(horario("sunrise-sunset"), viernes).estado, "desconocido");
  });
});

function lugar(id: string, lat: number, lng: number, categorias: string[] = ["entertainment", "entertainment.museum"], nombre = `Museo ${id}`): Lugar {
  return { idExterno: id, proveedor: "geoapify", nombre, direccion: null, lat, lng, categorias, ...clasificarEntorno(categorias) };
}

interface Escenario {
  porRadio?: Record<number, Lugar[]>;
  horarios?: Record<string, Horario>;
  fallar?: (consulta: ConsultaBusqueda) => boolean;
}

function crearBuscador({ porRadio = {}, horarios = {}, fallar }: Escenario, config = CONFIGURACION_CLIMA_REACTIVO) {
  const consultas: ConsultaBusqueda[] = [];
  const detalles: string[] = [];
  const buscar = crearBuscadorAlternativas({
    config,
    buscarLugares: async (consulta) => {
      consultas.push(consulta);
      if (fallar?.(consulta)) throw new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de lugares tardó demasiado en responder.");
      return porRadio[consulta.radio] ?? [];
    },
    enriquecerHorarios: async (lugares) => {
      detalles.push(...lugares.map((l) => l.idExterno));
      return lugares.map((l) => ({ ...l, horario: horarios[l.idExterno] ?? { estado: "no_publicado", valorOriginal: null, fuente: "geoapify" } }));
    },
  });
  return { buscar, consultas, detalles };
}

const ABIERTO: Horario = { estado: "disponible", valorOriginal: "Mo-Su 09:00-18:00", fuente: "geoapify" };
const PARQUE = parada("parque", { lat: 14.6, lng: -90.5, categorias: ["leisure.park"] });
const AFECTADA: ParadaAfectada = {
  paradaId: "parque",
  nombre: "Parque",
  inicioEstimado: "11:00",
  finEstimado: "12:00",
  clasificacion: { tipo_entorno: "outdoor", sensibilidad_clima: "alta", fuente: "categorias" },
  senal: { origen: "observado", nivel: "tormenta", condicion: "tormenta", desde: AHORA.toISOString(), hasta: AHORA.toISOString() },
  analizada: true,
  motivo: "prueba",
};
const entrada = (cambios: Record<string, unknown> = {}) => ({ afectadas: [AFECTADA], paradas: [PARQUE], intereses: [], fecha: FECHA, desdeMinutos: 600, ...cambios });

describe("búsqueda de alternativas techadas", () => {
  test("solo acepta categorías interiores turísticas, no restaurantes ni lugares exteriores", () => {
    assert.equal(esAlternativaInterior(lugar("m", 0, 0)), true);
    assert.equal(esAlternativaInterior(lugar("g", 0, 0, ["entertainment.culture.gallery"])), true);
    assert.equal(esAlternativaInterior(lugar("r", 0, 0, ["catering.restaurant"])), false);
    assert.equal(esAlternativaInterior(lugar("z", 0, 0, ["entertainment.zoo"])), false);
  });

  test("busca alrededor de la parada afectada con el radio inicial y categorías interiores", async () => {
    const { buscar, consultas } = crearBuscador({ porRadio: { 2000: [lugar("m1", 14.601, -90.5), lugar("m2", 14.602, -90.5), lugar("m3", 14.603, -90.5)] }, horarios: { m1: ABIERTO } });
    await buscar(entrada());
    assert.equal(consultas.length, 1);
    assert.deepEqual(consultas[0], {
      lat: 14.6,
      lng: -90.5,
      categorias: ["entertainment.museum", "entertainment.culture", "entertainment.planetarium", "entertainment.aquarium"],
      radio: 2000,
      limite: 20,
    });
  });

  test("busca cerca de cada parada afectada por separado", async () => {
    const otra = parada("mirador", { lat: 14.7, lng: -90.6, categorias: ["tourism.attraction.viewpoint"] });
    const { buscar, consultas } = crearBuscador({});
    await buscar(entrada({ afectadas: [AFECTADA, { ...AFECTADA, paradaId: "mirador" }], paradas: [PARQUE, otra] }));
    assert.deepEqual(consultas.map((c) => [c.lat, c.lng, c.radio]), [[14.6, -90.5, 2000], [14.6, -90.5, 5000], [14.7, -90.6, 2000], [14.7, -90.6, 5000]]);
  });

  test("amplía el radio hasta 5000 m solo si no hay suficientes candidatos", async () => {
    const { buscar, consultas } = crearBuscador({ porRadio: { 2000: [lugar("m1", 14.601, -90.5)], 5000: [lugar("m1", 14.601, -90.5), lugar("lejos", 14.635, -90.5)] }, horarios: { m1: ABIERTO, lejos: ABIERTO } });
    const resultado = await buscar(entrada());
    assert.deepEqual(consultas.map((c) => c.radio), [2000, 5000]);
    assert.deepEqual(resultado.alternativas.map((a) => [a.idExterno, a.radioBusquedaMetros]), [["m1", 2000], ["lejos", 5000]]);
  });

  test("excluye lugares del itinerario, visitas completadas, duplicados y resultados fuera del radio", async () => {
    const completada = parada("visitado", { estado: "completada", lat: 14.61, lng: -90.5, nombre: "Museo Nacional", placeId: "ya-visitado" });
    const { buscar } = crearBuscador({
      porRadio: {
        2000: [
          lugar("ya-visitado", 14.62, -90.5),
          lugar("mismo-nombre", 14.6105, -90.5, undefined, "Museo  nacional"),
          lugar("valido", 14.605, -90.5),
          lugar("valido", 14.605, -90.5),
          lugar("fuera", 14.65, -90.5),
          lugar("restaurante", 14.601, -90.5, ["catering.restaurant"]),
        ],
      },
      horarios: { valido: ABIERTO },
    });
    const resultado = await buscar(entrada({ paradas: [PARQUE, completada] }));
    assert.deepEqual(resultado.alternativas.map((a) => a.idExterno), ["valido"]);
  });

  test("diferencia horarios confirmados, no confirmados y cerrados", async () => {
    const { buscar } = crearBuscador({
      porRadio: { 2000: [lugar("abierto", 14.601, -90.5), lugar("sin-horario", 14.602, -90.5), lugar("cerrado", 14.603, -90.5), lugar("ilegible", 14.604, -90.5)] },
      horarios: {
        abierto: ABIERTO,
        cerrado: { estado: "disponible", valorOriginal: "Mo-Su 08:00-10:30", fuente: "geoapify" },
        ilegible: { estado: "no_interpretable", valorOriginal: "abierto casi siempre", fuente: "geoapify" },
      },
    });
    const resultado = await buscar(entrada());
    assert.deepEqual(
      resultado.alternativas.map((a) => [a.idExterno, a.disponibilidad, a.ventanaVisita]),
      [
        ["abierto", "confirmada", { apertura: "09:00", cierre: "18:00" }],
        ["sin-horario", "horario_no_confirmado", null],
        ["cerrado", "cerrada_en_el_horario", null],
        ["ilegible", "horario_no_confirmado", null],
      ],
    );
    assert.deepEqual(resultado.confirmadas.get("parque")?.map((c) => c.alternativa.idExterno), ["abierto"]);
  });

  test("prioriza los lugares relacionados con los intereses del usuario", async () => {
    const { buscar } = crearBuscador({
      porRadio: { 2000: [lugar("museo-cerca", 14.601, -90.5), lugar("galeria", 14.604, -90.5, ["entertainment.culture.gallery"], "Galería"), lugar("acuario", 14.602, -90.5, ["entertainment.aquarium"])] },
      horarios: { "museo-cerca": ABIERTO, galeria: ABIERTO, acuario: ABIERTO },
    });
    const resultado = await buscar(entrada({ intereses: ["Arte"] }));
    assert.equal(resultado.alternativas[0].idExterno, "galeria");
    assert.equal(resultado.alternativas[0].coincideConIntereses, true);
  });

  test("consulta horarios solo de los candidatos más prometedores", async () => {
    const muchos = Array.from({ length: 8 }, (_, i) => lugar(`m${i}`, 14.6 + (i + 1) * 0.001, -90.5));
    const { buscar, detalles } = crearBuscador({ porRadio: { 2000: muchos } });
    await buscar(entrada());
    assert.deepEqual(detalles, ["m0", "m1", "m2", "m3"]);
  });

  test("sin resultados devuelve listas vacías sin errores", async () => {
    const resultado = await crearBuscador({}).buscar(entrada());
    assert.deepEqual(resultado.alternativas, []);
    assert.deepEqual(resultado.confirmadas.get("parque"), []);
  });

  test("un fallo de Geoapify no se presenta como ausencia de lugares", async () => {
    const { buscar } = crearBuscador({ fallar: () => true });
    await assert.rejects(buscar(entrada()), (e) => e instanceof ErrorApi && e.codigo === "PROVEEDOR_TIEMPO_AGOTADO");
  });

  test("un fallo parcial conserva los resultados de las demás paradas y lo informa", async () => {
    const otra = parada("mirador", { lat: 14.7, lng: -90.6 });
    const { buscar } = crearBuscador({ porRadio: { 2000: [lugar("m1", 14.601, -90.5), lugar("m2", 14.6015, -90.5), lugar("m3", 14.602, -90.5)] }, fallar: (c) => c.lat === 14.7 });
    const resultado = await buscar(entrada({ afectadas: [AFECTADA, { ...AFECTADA, paradaId: "mirador" }], paradas: [PARQUE, otra] }));
    assert.deepEqual(resultado.busquedasFallidas.map((f) => [f.paradaId, f.codigo]), [["mirador", "PROVEEDOR_TIEMPO_AGOTADO"]]);
    assert.equal(resultado.alternativas.length, 3);
  });
});
