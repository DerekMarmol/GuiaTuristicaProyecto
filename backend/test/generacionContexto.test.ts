import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearGeneradorItinerario } from "../src/itinerarios/generacion";
import { radiosDeBusqueda } from "../src/itinerarios/candidatos";
import type { ConsultaBusqueda } from "../src/geoapify/cliente";
import type { Lugar } from "../src/geoapify/transformar";
import type { ClienteLLM } from "../src/ai/cliente";
import type { ConsultarClima } from "../src/clima/servicio";
import type { SolicitudGeneracion } from "../src/validacion/generacion";

const JALAPA = { nombre: "Jalapa, JA, Guatemala", lat: 14.6344, lng: -89.9898, zonaHoraria: "America/Guatemala" };
const LOS_PINOS = { lat: 14.6105, lng: -89.995 };

function lugar(id: string, lat: number, lng: number, categorias: string[], entorno: "indoor" | "outdoor" = "indoor"): Lugar {
  return {
    idExterno: id,
    proveedor: "geoapify",
    nombre: id,
    direccion: null,
    lat,
    lng,
    categorias,
    tipo_entorno: entorno,
    sensibilidad_clima: entorno === "indoor" ? "baja" : "alta",
    regla_clima: null,
  };
}

const TIENDAS = [
  lugar("Centro comercial del centro", 14.6344, -89.9898, ["commercial.shopping_mall"]),
  lugar("Mercado de Los Pinos", 14.611, -89.9945, ["commercial.marketplace"]),
  lugar("Tienda de recuerdos", 14.636, -89.988, ["commercial.gift_and_souvenir"]),
];
const MAS_TIENDAS = [
  lugar("Mercado municipal", 14.633, -89.991, ["commercial.marketplace"]),
  lugar("Almacén del centro", 14.635, -89.987, ["commercial.department_store"]),
  lugar("Artesanías jalapanecas", 14.637, -89.989, ["commercial.gift_and_souvenir"]),
];
const PARQUES = [
  lugar("Parque al aire libre", 14.6346, -89.9899, ["leisure.park"], "outdoor"),
  lugar("Museo bajo techo", 14.64, -89.99, ["entertainment.museum"]),
];

const coincide = (lugarDe: Lugar, pedidas: string[]) =>
  lugarDe.categorias.some((c) => pedidas.some((p) => c === p || c.startsWith(`${p}.`)));

function crearGenerador({
  catalogo = TIENDAS,
  ahora = () => new Date("2026-11-10T15:00:00Z"),
  consultarClima,
  cliente,
  consultas = [],
}: {
  catalogo?: Lugar[];
  ahora?: () => Date;
  consultarClima?: ConsultarClima;
  cliente?: ClienteLLM;
  consultas?: ConsultaBusqueda[];
} = {}) {
  return crearGeneradorItinerario({
    geocodificar: async () => JALAPA,
    buscarLugares: async (consulta) => {
      consultas.push(consulta);
      return catalogo.filter((l) => coincide(l, consulta.categorias));
    },
    enriquecerHorarios: async (lugares) =>
      lugares.map((l) => ({ ...l, horario: { estado: "no_publicado" as const, valorOriginal: null, fuente: "geoapify" as const } })),
    consultarClima,
    cliente,
    ahora,
  });
}

const solicitud = (cambios: Partial<SolicitudGeneracion> = {}): SolicitudGeneracion => ({
  destino: "Jalapa",
  fechaInicio: "2026-11-10",
  fechaFin: "2026-11-11",
  intereses: ["Compras"],
  tipoViaje: "solo",
  transporte: "Moto",
  presupuesto: 0,
  hospedaje: false,
  ...cambios,
});

describe("itinerario según el momento en que se genera (GUI-112)", () => {
  test("si el viaje es hoy, el primer día empieza a la hora actual y los siguientes a las 09:00", async () => {
    const generar = crearGenerador({ catalogo: [...TIENDAS, ...MAS_TIENDAS], ahora: () => new Date("2026-11-10T20:00:00Z") });

    const plan = await generar(solicitud());

    assert.match(plan.itinerarios[0].paradas[0].llegada, /T14:15/);
    assert.match(plan.itinerarios[1].paradas[0].llegada, /T09:00/);
    assert.ok(plan.advertencias.some((a) => a.includes("arranca a las 14:15")));
  });

  test("si el viaje no es hoy, empieza a las 09:00", async () => {
    const plan = await crearGenerador({ ahora: () => new Date("2026-11-01T20:00:00Z") })(solicitud());
    assert.match(plan.itinerarios[0].paradas[0].llegada, /T09:00/);
  });

  test("empieza por el lugar más cercano al punto de partida", async () => {
    const plan = await crearGenerador()(solicitud({ origen: LOS_PINOS }));
    assert.equal(plan.itinerarios[0].paradas[0].nombre, "Mercado de Los Pinos");
  });

  test("sin punto de partida, empieza por lo más cercano al centro del destino", async () => {
    const plan = await crearGenerador()(solicitud());
    assert.equal(plan.itinerarios[0].paradas[0].nombre, "Centro comercial del centro");
  });

  test("ignora un punto de partida a más de 50 km (el viajero planea desde casa)", async () => {
    const plan = await crearGenerador()(solicitud({ origen: { lat: 14.6349, lng: -90.5069 } }));
    assert.equal(plan.itinerarios[0].paradas[0].nombre, "Centro comercial del centro");
  });

  test("las compras se buscan en el pueblo, sin ampliar a otros municipios", async () => {
    const consultas: ConsultaBusqueda[] = [];
    await crearGenerador({ catalogo: [TIENDAS[0]], consultas })(solicitud({ fechaFin: "2026-11-10" }));

    assert.ok(consultas.length > 0);
    assert.ok(consultas.every((c) => c.radio <= 5000), `radios usados: ${consultas.map((c) => c.radio)}`);
    assert.deepEqual(radiosDeBusqueda("Naturaleza", "Moto"), { inicial: 15000, ampliado: 30000 });
  });

  test("con lluvia, prefiere lugares bajo techo aunque haya uno al aire libre más cerca", async () => {
    const consultarClima = (async () => ({ dias: [{ lluviaMm: 12.4 }] })) as unknown as ConsultarClima;
    const plan = await crearGenerador({ catalogo: PARQUES, consultarClima })(
      solicitud({ intereses: ["Naturaleza", "Cultura"], fechaFin: "2026-11-10" }),
    );

    assert.equal(plan.itinerarios[0].paradas[0].nombre, "Museo bajo techo");
    assert.ok(plan.advertencias.some((a) => a.includes("12.4 mm de lluvia el día 1")));
  });

  test("si el pronóstico falla, el itinerario se genera igual", async () => {
    const consultarClima = (async () => {
      throw new Error("sin clave");
    }) as unknown as ConsultarClima;
    const plan = await crearGenerador({ catalogo: PARQUES, consultarClima })(solicitud({ intereses: ["Naturaleza"], fechaFin: "2026-11-10" }));
    assert.equal(plan.itinerarios[0].paradas[0].nombre, "Parque al aire libre");
  });

  test("le pasa a Gemini el punto de partida, la hora de hoy y los días con lluvia", async () => {
    let prompt = "";
    const cliente: ClienteLLM = {
      generarPlan: async (args) => {
        prompt = args.prompt;
        return { dias: [{ numeroDia: 1, paradas: [{ placeId: "Mercado de Los Pinos", tiempoEstanciaMinutos: 60 }] }] };
      },
    };
    const consultarClima = (async () => ({ dias: [{ lluviaMm: 8 }] })) as unknown as ConsultarClima;

    await crearGenerador({ cliente, consultarClima, ahora: () => new Date("2026-11-10T20:00:00Z") })(
      solicitud({ origen: LOS_PINOS, fechaFin: "2026-11-10" }),
    );

    assert.match(prompt, /Punto de partida del viajero: lat 14\.6105, lng -89\.995/);
    assert.match(prompt, /El día 1 es hoy y empieza a las 14:15/);
    assert.match(prompt, /Día 1: se esperan 8 mm de lluvia/);
    assert.match(prompt, /"entorno":"bajo techo"/);
  });
});

describe("coherencia de intereses y variedad al regenerar (GUI-118)", () => {
  const SEIS_TIENDAS = [
    ...TIENDAS,
    ...MAS_TIENDAS,
  ];
  const paradasDe = (plan: Awaited<ReturnType<ReturnType<typeof crearGenerador>>>) =>
    plan.itinerarios.flatMap((it) => it.paradas.map((p) => p.placeId));

  test("Compras deja fuera negocios que no son un paseo de compras, aunque el mapa los marque como tienda", async () => {
    const catalogo = [...TIENDAS, lugar("Perfumería Castro", 14.6345, -89.9897, ["commercial.gift_and_souvenir"]), lugar("Farmacia Batres", 14.6343, -89.9899, ["commercial.department_store"]), lugar("Despensa Familiar", 14.6346, -89.9896, ["commercial.department_store"])];
    const plan = await crearGenerador({ catalogo })(solicitud({ fechaFin: "2026-11-10" }));
    const nombres = plan.itinerarios.flatMap((it) => it.paradas.map((p) => p.nombre));
    assert.ok(!nombres.some((n) => /Perfumer|Farmacia|Despensa/.test(n)), nombres.join(", "));
  });

  test("al regenerar propone lugares distintos a los del plan anterior", async () => {
    const generar = crearGenerador({ catalogo: SEIS_TIENDAS });
    const primero = paradasDe(await generar(solicitud({ fechaFin: "2026-11-10" })));
    const segundo = await generar(solicitud({ fechaFin: "2026-11-10", evitar: primero }));

    assert.equal(primero.length, 3);
    assert.equal(paradasDe(segundo).filter((id) => primero.includes(id)).length, 0);
    assert.ok(!segundo.advertencias.some((a) => a.includes("se repite")));
  });

  test("si no hay alternativas, repite lugares y lo avisa", async () => {
    const generar = crearGenerador({ catalogo: TIENDAS });
    const primero = paradasDe(await generar(solicitud({ fechaFin: "2026-11-10" })));
    const segundo = await generar(solicitud({ fechaFin: "2026-11-10", evitar: primero }));

    assert.ok(paradasDe(segundo).length > 0);
    assert.ok(segundo.advertencias.some((a) => a.includes("no hay suficientes lugares distintos")));
  });

  test("a Gemini se le pide evitar los lugares del plan anterior", async () => {
    let prompt = "";
    const cliente: ClienteLLM = {
      generarPlan: async (args) => {
        prompt = args.prompt;
        return { dias: [{ numeroDia: 1, paradas: [{ placeId: "Mercado municipal", tiempoEstanciaMinutos: 60 }] }] };
      },
    };
    await crearGenerador({ catalogo: SEIS_TIENDAS, cliente })(
      solicitud({ fechaFin: "2026-11-10", evitar: ["Centro comercial del centro", "Mercado de Los Pinos"] })
    );
    assert.match(prompt, /pidió un plan distinto.*evita repetir: Centro comercial del centro, Mercado de Los Pinos/);
  });
});
