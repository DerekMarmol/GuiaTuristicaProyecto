import { diasEntre, sumarDias } from "../ai/fechas";
import type { SalidaIA } from "../ai/schemas";
import { crearPlanificadorDia } from "../ai/validacionApertura";
import { distanciaMetros, type Coordenada } from "../hoteles/geografia";
import { PARADAS_OBJETIVO_POR_DIA, type Candidato } from "./candidatos";

// Cuántos candidatos se prueban para cada hueco del día antes de darlo por cerrado.
const INTENTOS_POR_PARADA = 8;

const ESTANCIA_POR_CATEGORIA: [prefijo: string, minutos: number][] = [
  ["entertainment.theme_park", 180],
  ["entertainment.water_park", 180],
  ["beach", 120],
  ["natural", 120],
  ["national_park", 120],
  ["entertainment.activity_park", 120],
  ["entertainment.museum", 90],
  ["catering", 60],
];
const ESTANCIA_PREDETERMINADA = 60;

function tieneCategoria(candidato: Candidato, prefijo: string): boolean {
  return candidato.lugar.categorias.some((categoria) => categoria === prefijo || categoria.startsWith(`${prefijo}.`));
}

const INTERES_GASTRONOMIA = "Gastronomía";

function esComida(candidato: Candidato): boolean {
  return tieneCategoria(candidato, "catering");
}

function estanciaSugerida(candidato: Candidato): number {
  const encontrada = ESTANCIA_POR_CATEGORIA.find(([prefijo]) => tieneCategoria(candidato, prefijo));
  return encontrada ? encontrada[1] : ESTANCIA_PREDETERMINADA;
}

// Cuántos kilómetros «vale» cada puesto de representatividad al elegir la primera parada: la cercanía
// manda, y la representatividad solo desempata entre lugares a distancias parecidas.
const KM_POR_RANGO = 0.5;

// Arma un plan sin modelo de lenguaje: cada día empieza por un interés distinto, en el lugar más cercano
// al punto de partida (el del viajero o el centro del destino), y sigue con los lugares más cercanos a la
// última parada, prefiriendo intereses que aún no salieron ese día. Los días con lluvia deja al final los
// lugares al aire libre. Las comidas se limitan a una por día (dos si el viajero eligió Gastronomía): es
// mejor un día con menos paradas que uno relleno de restaurantes. Cada parada se prueba con el mismo
// planificador que usa el validador, así que solo entran visitas que caben en el horario.
export function planificarSinIA({
  candidatos,
  intereses,
  centro,
  fechaInicio,
  fechaFin,
  horaInicio,
  horaInicioDelDia,
  diasConLluvia = new Set<number>(),
  zonaHoraria,
}: {
  candidatos: Candidato[];
  intereses: string[];
  centro: Coordenada;
  fechaInicio: string;
  fechaFin: string;
  horaInicio: string;
  horaInicioDelDia?: (numeroDia: number) => string | undefined;
  diasConLluvia?: ReadonlySet<number>;
  zonaHoraria: string;
}): SalidaIA {
  const usados = new Set<string>();
  const dias: SalidaIA["dias"] = [];
  const maxComidas = intereses.includes(INTERES_GASTRONOMIA) ? 2 : 1;

  for (let numeroDia = 1; numeroDia <= diasEntre(fechaInicio, fechaFin); numeroDia++) {
    const planificador = crearPlanificadorDia({
      fecha: sumarDias(fechaInicio, numeroDia - 1),
      horaInicio: horaInicioDelDia?.(numeroDia) ?? horaInicio,
      zonaHoraria,
    });
    const llueve = diasConLluvia.has(numeroDia);
    if (!planificador) {
      continue;
    }

    const interesInicial = intereses[(numeroDia - 1) % intereses.length];
    const paradas: SalidaIA["dias"][number]["paradas"] = [];
    const interesesDelDia = new Set<string>();
    let comidas = 0;
    let referencia = centro;

    while (paradas.length < PARADAS_OBJETIVO_POR_DIA) {
      const prioridad = (c: Candidato) =>
        (llueve && c.lugar.tipo_entorno === "outdoor" ? 3 : 0) +
        (paradas.length === 0
          ? Number(c.interes !== interesInicial)
          : Number(interesesDelDia.has(c.interes)) + (comidas > 0 && esComida(c) ? 2 : 0));
      const opciones = candidatos
        .filter((c) => !usados.has(c.placeId) && !(esComida(c) && comidas >= maxComidas))
        .map((c) => ({ c, prioridad: prioridad(c), distancia: distanciaMetros(referencia, c) }))
        // Siempre manda la cercanía; en la primera parada, la representatividad desempata a distancias parecidas.
        .map((o) => ({ ...o, puntaje: o.distancia / 1000 + (paradas.length === 0 ? o.c.rango * KM_POR_RANGO : 0) }))
        .sort((a, b) => a.prioridad - b.prioridad || a.puntaje - b.puntaje)
        .slice(0, INTENTOS_POR_PARADA);

      const elegida = opciones.find(({ c }) => planificador.evaluar(c, estanciaSugerida(c)).aceptada)?.c;
      if (!elegida) {
        break;
      }
      usados.add(elegida.placeId);
      interesesDelDia.add(elegida.interes);
      comidas += Number(esComida(elegida));
      paradas.push({ placeId: elegida.placeId, tiempoEstanciaMinutos: estanciaSugerida(elegida) });
      referencia = elegida;
    }

    if (paradas.length > 0) {
      dias.push({ numeroDia, paradas });
    }
  }

  return { dias };
}
