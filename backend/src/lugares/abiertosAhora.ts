import type {
  CoberturaAbiertosAhora,
  LugarAbiertoAhora,
  MotivoAperturaNoVerificable,
  RespuestaLugaresAbiertosAhora,
} from "../../../shared/types";
import { formatearInstante } from "../ai/zonaHoraria";
import { limiteCandidatos } from "../config/abiertosAhora";
import { ErrorApi } from "../errores";
import type { BuscarLugares } from "../geoapify/cliente";
import type { ConsultarApertura, DatosApertura } from "../geoapify/enriquecer";
import { horarioErrorConsulta } from "../geoapify/horario";
import type { Lugar } from "../geoapify/transformar";
import { distanciaMetros } from "../hoteles/geografia";
import type { ConsultaAbiertosAhora } from "../validacion/abiertosAhora";
import { evaluarAperturaActual } from "./aperturaActual";

export type BuscarAbiertosAhora = (consulta: ConsultaAbiertosAhora) => Promise<RespuestaLugaresAbiertosAhora>;

export interface OpcionesAbiertosAhora {
  buscarLugares: BuscarLugares;
  consultarApertura: ConsultarApertura;
  ahora?: () => Date;
}

interface Candidato {
  lugar: Lugar;
  distancia: number;
}

function porCercania(a: Candidato, b: Candidato): number {
  return a.distancia - b.distancia || (a.lugar.idExterno < b.lugar.idExterno ? -1 : a.lugar.idExterno > b.lugar.idExterno ? 1 : 0);
}

function datosNoConsultados(): DatosApertura {
  return { horario: horarioErrorConsulta(), zonaHoraria: null };
}

export function crearBuscadorAbiertosAhora({ buscarLugares, consultarApertura, ahora = () => new Date() }: OpcionesAbiertosAhora): BuscarAbiertosAhora {
  return async function buscarAbiertosAhora(consulta) {
    const origen = { lat: consulta.lat, lng: consulta.lng };
    const maximoCandidatos = limiteCandidatos(consulta.limite);
    const encontrados = await buscarLugares({
      lat: consulta.lat,
      lng: consulta.lng,
      categorias: consulta.categorias,
      radio: consulta.radio,
      limite: maximoCandidatos,
    });

    const vistos = new Set<string>();
    const candidatos: Candidato[] = [];
    for (const lugar of encontrados) {
      const distancia = distanciaMetros(origen, lugar);
      if (vistos.has(lugar.idExterno) || distancia > consulta.radio) {
        continue;
      }
      vistos.add(lugar.idExterno);
      candidatos.push({ lugar, distancia });
    }
    candidatos.sort(porCercania);

    const apertura = await consultarApertura(candidatos.map(({ lugar }) => lugar.idExterno));
    const datosDe = (idExterno: string) => apertura.get(idExterno) ?? datosNoConsultados();

    if (candidatos.length > 0 && candidatos.every(({ lugar }) => datosDe(lugar.idExterno).horario.estado === "error_consulta")) {
      throw new ErrorApi(
        502,
        "PROVEEDOR_DETALLES_NO_DISPONIBLES",
        "No fue posible obtener los horarios de los lugares cercanos. Intenta de nuevo más tarde.",
      );
    }

    const instante = ahora().getTime();
    const evaluadoEn = new Date(instante).toISOString();
    const abiertos: LugarAbiertoAhora[] = [];
    let cerrados = 0;
    const desconocidosPorMotivo: Partial<Record<MotivoAperturaNoVerificable, number>> = {};

    for (const { lugar, distancia } of candidatos) {
      const { horario, zonaHoraria } = datosDe(lugar.idExterno);
      const evaluacion = evaluarAperturaActual(horario, zonaHoraria, instante);
      if (evaluacion.estadoApertura === "cerrado") {
        cerrados += 1;
      } else if (evaluacion.estadoApertura === "desconocido") {
        desconocidosPorMotivo[evaluacion.motivo] = (desconocidosPorMotivo[evaluacion.motivo] ?? 0) + 1;
      } else if (zonaHoraria) {
        abiertos.push({
          ...lugar,
          horario,
          open_now: true,
          estadoApertura: "abierto",
          evaluadoEn,
          zonaHoraria,
          horaLocalEvaluacion: formatearInstante(instante, zonaHoraria),
          cierreEstimado: evaluacion.cierreEstimado,
          distanciaMetros: Math.round(distancia),
        });
      }
    }

    const desconocidos = Object.values(desconocidosPorMotivo).reduce((suma, cantidad) => suma + cantidad, 0);
    const cobertura: CoberturaAbiertosAhora = {
      candidatosEvaluados: candidatos.length,
      limiteCandidatos: maximoCandidatos,
      busquedaLimitada: encontrados.length >= maximoCandidatos,
      abiertos: abiertos.length,
      cerrados,
      desconocidos,
      desconocidosPorMotivo,
    };
    const lugares = abiertos.slice(0, consulta.limite);

    return {
      evaluadoEn,
      criterio: "horarios_publicados",
      origen,
      radioMetros: consulta.radio,
      limite: consulta.limite,
      categorias: consulta.categorias,
      categoriasPredeterminadas: consulta.categoriasPredeterminadas,
      total: lugares.length,
      cobertura,
      lugares,
    };
  };
}
