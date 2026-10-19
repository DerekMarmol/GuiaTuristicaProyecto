import type { Itinerario, Parada } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import { diasDeViaje } from "../utils/fechas";

export const PASOS_GENERACION = [
  "Buscando lugares según tus intereses",
  "Validando horarios de apertura",
  "Ordenando la ruta más corta",
  "Armando tu itinerario",
];

interface Plantilla {
  nombre: string;
  apertura: string;
  cierre: string;
  estancia: number;
  // Categorías de Geoapify: el backend clasifica con ellas el entorno climático de la parada.
  categorias: string[];
  entorno?: Pick<Parada, "tipo_entorno" | "sensibilidad_clima">;
}

export interface ParadaConHorario extends Parada {
  estadoHorario?: "completa" | "ajustada" | "descartada";
  mensajeHorario?: string;
  horaInicioProgramada?: string;
  horaFinProgramada?: string;
  estanciaSolicitadaMinutos?: number;
  tiempoTrasladoMinutos?: number;
  tiempoTrasladoConHolguraMinutos?: number;
}

const LUGARES: Record<string, Plantilla[]> = {
  Cultura: [
    {
      nombre: "Museo de arte de {d}",
      categorias: ["entertainment.museum"],
      apertura: "09:00",
      cierre: "17:00",
      estancia: 90,
    },
    {
      nombre: "Casa de la cultura de {d}",
      categorias: ["entertainment.culture"],
      apertura: "09:00",
      cierre: "16:00",
      estancia: 60,
    },
  ],
  Historia: [
    {
      nombre: "Centro histórico de {d}",
      categorias: ["tourism.sights"],
      apertura: "08:00",
      cierre: "18:00",
      estancia: 75,
    },
    {
      nombre: "Catedral de {d}",
      categorias: ["tourism.sights.place_of_worship"],
      apertura: "08:00",
      cierre: "17:00",
      estancia: 45,
    },
  ],
  Gastronomía: [
    {
      nombre: "Mercado de comida típica",
      categorias: ["commercial.marketplace"],
      apertura: "07:00",
      cierre: "15:00",
      estancia: 60,
    },
    {
      nombre: "Restaurante tradicional",
      categorias: ["catering.restaurant"],
      apertura: "12:00",
      cierre: "21:00",
      estancia: 80,
    },
  ],
  Naturaleza: [
    {
      nombre: "Mirador natural",
      categorias: ["tourism.attraction.viewpoint"],
      apertura: "06:00",
      cierre: "18:00",
      estancia: 60,
    },
    {
      nombre: "Parque ecológico",
      categorias: ["leisure.park"],
      apertura: "07:00",
      cierre: "17:00",
      estancia: 120,
    },
  ],
  Aventura: [
    {
      nombre: "Ruta de senderismo",
      categorias: ["natural"],
      apertura: "06:00",
      cierre: "16:00",
      estancia: 150,
    },
    {
      nombre: "Tirolesa y cuerdas",
      categorias: ["entertainment.activity_park"],
      apertura: "08:00",
      cierre: "16:00",
      estancia: 120,
    },
  ],
  Compras: [
    {
      nombre: "Mercado de artesanías",
      categorias: ["commercial.marketplace"],
      apertura: "09:00",
      cierre: "19:00",
      estancia: 70,
    },
    {
      nombre: "Tienda de productos locales",
      categorias: ["commercial.gift_and_souvenir"],
      entorno: { tipo_entorno: "indoor", sensibilidad_clima: "baja" },
      apertura: "10:00",
      cierre: "19:00",
      estancia: 40,
    },
  ],
  "Vida nocturna": [
    {
      nombre: "Bar con música en vivo",
      categorias: ["catering.bar"],
      apertura: "18:00",
      cierre: "23:59",
      estancia: 120,
    },
    {
      nombre: "Terraza con vista nocturna",
      categorias: ["catering.bar"],
      entorno: { tipo_entorno: "outdoor", sensibilidad_clima: "media" },
      apertura: "18:00",
      cierre: "23:00",
      estancia: 90,
    },
  ],
  Playa: [
    {
      nombre: "Playa principal",
      categorias: ["beach"],
      apertura: "08:00",
      cierre: "18:00",
      estancia: 120,
    },
    {
      nombre: "Muelle y puesta de sol",
      categorias: ["man_made.pier"],
      apertura: "16:00",
      cierre: "19:30",
      estancia: 60,
    },
  ],
  Fotografía: [
    {
      nombre: "Punto panorámico para fotos",
      categorias: ["tourism.attraction.viewpoint"],
      apertura: "05:30",
      cierre: "18:30",
      estancia: 45,
    },
    {
      nombre: "Calles coloridas de {d}",
      categorias: ["tourism.sights"],
      apertura: "07:00",
      cierre: "19:00",
      estancia: 60,
    },
  ],
  Arte: [
    {
      nombre: "Galería de arte contemporáneo",
      categorias: ["entertainment.culture.gallery"],
      apertura: "10:00",
      cierre: "18:00",
      estancia: 60,
    },
    {
      nombre: "Taller de artesanos",
      categorias: ["commercial.art"],
      entorno: { tipo_entorno: "indoor", sensibilidad_clima: "baja" },
      apertura: "09:00",
      cierre: "17:00",
      estancia: 60,
    },
  ],
};

const MAX_DIAS = 14;
const PARADAS_POR_DIA = 3;
const ESTANCIA_MINIMA = 15;

// estimación de traslado con holgura.
const TRASLADO_BASE = 15;
const MARGEN_ESTANDAR = 10;
const ESTACIONAMIENTO = 10;
const PORCENTAJE_IMPREVISTOS = 0.1;

function calcularTrasladoConHolgura(): number {
  const imprevistos = Math.round(
    TRASLADO_BASE * PORCENTAJE_IMPREVISTOS
  );

  return (
    TRASLADO_BASE +
    MARGEN_ESTANDAR +
    ESTACIONAMIENTO +
    imprevistos
  );
}

const pausa = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;

  return (
    `${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}`
  );
}

function sumarDias(inicio: string, n: number): string {
  const [a, m, d] = inicio.split("-").map(Number);
  const f = new Date(a, m - 1, d + n);

  return (
    `${f.getFullYear()}-` +
    `${String(f.getMonth() + 1).padStart(2, "0")}-` +
    `${String(f.getDate()).padStart(2, "0")}`
  );
}

// validar la estancia contra el horario de cierre.
function calcularEstancia(
  plantilla: Plantilla,
  llegadaMinutos: number
): {
  estado: "completa" | "ajustada" | "descartada";
  inicio: number;
  fin: number;
  estanciaFinal: number;
  mensaje?: string;
} {
  const apertura = aMinutos(plantilla.apertura);
  const cierre = aMinutos(plantilla.cierre);

  // Si llega antes de la apertura, espera a que abra.
  const inicio = Math.max(llegadaMinutos, apertura);
  const tiempoDisponible = Math.max(0, cierre - inicio);

  // No alcanza la estancia mínima.
  if (tiempoDisponible < ESTANCIA_MINIMA) {
    return {
      estado: "descartada",
      inicio,
      fin: inicio,
      estanciaFinal: 0,
      mensaje:
        `No se puede realizar esta visita: ` +
        `hay menos de ${ESTANCIA_MINIMA} minutos ` +
        `disponibles antes del cierre (${plantilla.cierre}).`,
    };
  }

  // Hay tiempo para visitar, pero no para la estancia completa.
  if (tiempoDisponible < plantilla.estancia) {
    return {
      estado: "ajustada",
      inicio,
      fin: cierre,
      estanciaFinal: tiempoDisponible,
      mensaje:
        `La estancia se redujo de ${plantilla.estancia} ` +
        `a ${tiempoDisponible} minutos para respetar ` +
        `el cierre a las ${plantilla.cierre}.`,
    };
  }

  // La visita cabe completa.
  return {
    estado: "completa",
    inicio,
    fin: inicio + plantilla.estancia,
    estanciaFinal: plantilla.estancia,
  };
}

function construirItinerarios(
  viaje: ViajeBorrador
): Itinerario[] {
  const dias = Math.min(
    diasDeViaje(viaje.fechaInicio, viaje.fechaFin),
    MAX_DIAS
  );

  const intereses =
    viaje.intereses && viaje.intereses.length > 0
      ? viaje.intereses
      : ["Cultura"];

  const destino = viaje.destino ?? "tu destino";

  // Mezclar lugares según los intereses seleccionados.
  const pool: Plantilla[] = [];

  const maxLargo = Math.max(
    0,
    ...intereses.map((i) => (LUGARES[i] ?? []).length)
  );

  for (let k = 0; k < maxLargo; k++) {
    for (const interes of intereses) {
      const lugar = LUGARES[interes]?.[k];

      if (lugar) {
        pool.push(lugar);
      }
    }
  }

  if (pool.length === 0) {
    throw new Error(
      "No hay lugares disponibles para los intereses seleccionados."
    );
  }

  return Array.from({ length: dias }, (_, dia) => {
    const elegidas = Array.from(
      { length: PARADAS_POR_DIA },
      (_, k) =>
        pool[(dia * PARADAS_POR_DIA + k) % pool.length]
    );

    // Los lugares nocturnos se visitan al final.
    elegidas.sort(
      (a, b) =>
        Number(a.apertura >= "17:00") -
        Number(b.apertura >= "17:00")
    );

    const paradas: ParadaConHorario[] = [];

    // El día comienza a las 09:00.
    let llegadaEstimada = aMinutos("09:00");

    elegidas.forEach((plantilla, k) => {
      const nombre = plantilla.nombre.replace("{d}", destino);

      // No hay traslado antes de la primera parada.
      const tiempoTraslado =
        k === 0 ? 0 : calcularTrasladoConHolgura();

      // Sumar el traslado antes de validar la visita.
      const llegadaAlLugar =
        llegadaEstimada + tiempoTraslado;

      const resultado = calcularEstancia(
        plantilla,
        llegadaAlLugar
      );

      const parada: ParadaConHorario = {
        id: `p${dia + 1}-${k + 1}`,
        nombre,
        lat: 14.6349 + dia * 0.004 + k * 0.0021,
        lng: -90.5069 - dia * 0.002 + k * 0.003,

        horaApertura: plantilla.apertura,
        horaCierre: plantilla.cierre,
        categorias: plantilla.categorias,
        ...plantilla.entorno,

        tiempoEstanciaMinutos: resultado.estanciaFinal,

        estadoHorario: resultado.estado,
        mensajeHorario: resultado.mensaje,

        horaInicioProgramada: aHora(resultado.inicio),
        horaFinProgramada: aHora(resultado.fin),

        estanciaSolicitadaMinutos: plantilla.estancia,

        tiempoTrasladoMinutos: tiempoTraslado,
        tiempoTrasladoConHolguraMinutos: tiempoTraslado,
      };

      // Se conserva la parada para mostrar la alerta roja
      // cuando no es posible realizar la visita.
      paradas.push(parada);

      // El traslado consume tiempo aunque la visita se descarte.
      // No se suma la estancia de una visita descartada.
      if (resultado.estado === "descartada") {
        llegadaEstimada = llegadaAlLugar;
      } else {
        llegadaEstimada = resultado.fin;
      }
    });

    return {
      id: `it-${dia + 1}`,
      viajeId: "viaje-demo",
      numeroDia: dia + 1,
      fecha: sumarDias(
        viaje.fechaInicio ?? "2030-01-01",
        dia
      ),
      paradas,
    };
  });
}

export async function generarItinerario(
  viaje: ViajeBorrador,
  onProgreso?: (pasosListos: number) => void
): Promise<Itinerario[]> {
  if (!navigator.onLine) {
    throw new Error(
      "Sin conexión. Conéctate a internet para generar tu itinerario."
    );
  }

  for (let i = 0; i < PASOS_GENERACION.length; i++) {
    await pausa(750);
    onProgreso?.(i + 1);
  }

  return construirItinerarios(viaje);
}
