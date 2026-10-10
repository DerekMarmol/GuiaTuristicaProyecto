// Interfases para definir la estructura del resultado
export interface DesgloseHolgura {
  margenEstandar: number;
  estacionamientoOAdicional: number;
  imprevistos: number;
  totalHolgura: number;
}

export interface ResultadoHolgura {
  tiempoBaseMinutos: number;
  tipoTraslado: 'vehiculo' | 'pie';
  desgloseHolgura: DesgloseHolgura;
  tiempoTotalConHolgura: number;
}

export interface OpcionesHolgura {
  margenEstandar?: number;
  tiempoEstacionamiento?: number;
  caminataExtra?: number;
  porcentajeImprevistos?: number;
}

/**
 * Calcula el tiempo total de traslado sumando márgenes de holgura e imprevistos.
 */
export function calcularTiempoTotalTraslado(
  tiempoBaseMinutos: number,
  tipoTraslado: 'vehiculo' | 'pie' = 'vehiculo',
  opciones: OpcionesHolgura = {}
): ResultadoHolgura {
  const {
    margenEstandar = 10,        // 10 min por defecto
    tiempoEstacionamiento = 15, // 15 min por parqueo/acceso
    caminataExtra = 10,         // 10 min por caminata
    porcentajeImprevistos = 0.10 // 10% según tráfico/distancia
  } = opciones;

  let tiempoAdicionalTipo = 0;
  if (tipoTraslado === 'vehiculo') {
    tiempoAdicionalTipo = tiempoEstacionamiento;
  } else if (tipoTraslado === 'pie') {
    tiempoAdicionalTipo = caminataExtra;
  }

  const tiempoImprevistos = Math.round(tiempoBaseMinutos * porcentajeImprevistos);
  const totalHolgura = margenEstandar + tiempoAdicionalTipo + tiempoImprevistos;

  return {
    tiempoBaseMinutos,
    tipoTraslado,
    desgloseHolgura: {
      margenEstandar,
      estacionamientoOAdicional: tiempoAdicionalTipo,
      imprevistos: tiempoImprevistos,
      totalHolgura
    },
    tiempoTotalConHolgura: tiempoBaseMinutos + totalHolgura
  };
}

/**
 * Asigna la holgura dinámica a cada parada del itinerario basándose en el tiempo de traslado
 */
export function enriquecerParadasConHolgura(paradas: any[]) {
  return paradas.map((parada, index) => {
    // Si es la última parada del día, no tiene traslado posterior
    if (index === paradas.length - 1) {
      return parada;
    }

    // Si la parada ya tiene un tiempo de traslado definido o simulado, lo usamos.
    // Si no tiene, calculamos un tiempo variado según la posición (ej. 10, 25, 15, 30 min)
    const tiemposEjemplo = [10, 25, 15, 35, 20];
    const tiempoBase = parada.tiempoTrasladoMinutos || tiemposEjemplo[index % tiemposEjemplo.length];

    // Determinar si es a pie o en vehículo (ejemplo: si el traslado es menor a 12 min asumimos a pie)
    const tipoTraslado: 'vehiculo' | 'pie' = tiempoBase < 12 ? 'pie' : 'vehiculo';

    // Generar la holgura calculada dinámicamente
    const holguraCalculada = calcularTiempoTotalTraslado(tiempoBase, tipoTraslado);

    return {
      ...parada,
      holgura: holguraCalculada
    };
  });
}