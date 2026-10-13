import { listarFechas } from "./fechas";
import { resumirPorDia, construirAdvertencias } from "../openweather/transformar";
import type { ObtenerPronostico } from "../openweather/cliente";
import type { ConsultaClima } from "../validacion/clima";

interface OpcionesServicio {
  obtenerPronostico: ObtenerPronostico;
  ahora?: () => Date;
}

export function crearServicioClima({ obtenerPronostico, ahora = () => new Date() }: OpcionesServicio) {
  return async function consultarClima({ lat, lng, fechaInicio, fechaFin }: ConsultaClima) {
    const fechas = listarFechas(fechaInicio, fechaFin);
    const { desplazamientoUtcSegundos, registros } = await obtenerPronostico({ lat, lng });
    const { cobertura, dias } = resumirPorDia({ registros, desplazamientoUtcSegundos, fechas });

    return {
      fuente: "openweathermap",
      ubicacion: { lat, lng },
      rango: { fechaInicio, fechaFin, totalDias: fechas.length },
      consultadoEn: ahora().toISOString(),
      desplazamientoUtcSegundos,
      cobertura,
      dias,
      advertencias: construirAdvertencias(dias, cobertura),
    };
  };
}

export type ConsultarClima = ReturnType<typeof crearServicioClima>;
