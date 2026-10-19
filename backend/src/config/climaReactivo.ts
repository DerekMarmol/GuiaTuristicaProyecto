export interface ConfiguracionClimaReactivo {
  umbralProbabilidad: number;
  umbralLluvia1hMm: number;
  umbralLluvia3hMm: number;
  horizonteHoras: number;
  ventanaObservacionMinutos: number;
  antiguedadMaximaObservacionMinutos: number;
  antiguedadMaximaUbicacionMinutos: number;
  vigenciaCacheClimaMs: number;
  intervaloMonitoreoMinutos: number;
  esperaEntrePropuestasMinutos: number;
  vigenciaPropuestaMinutos: number;
  radioInicialMetros: number;
  radioMaximoMetros: number;
  resultadosPorBusqueda: number;
  maxParadasAfectadas: number;
  detallesPorParada: number;
  candidatosPorParada: number;
  estanciaMinimaAlternativaMinutos: number;
  tiempoEsperaOptimizadorMs: number;
}

// Categorías oficiales de Geoapify para actividades turísticas bajo techo. entertainment.culture
// incluye galerías, centros de arte y teatros (entertainment.culture.*).
export const CATEGORIAS_ALTERNATIVAS_INTERIORES: readonly string[] = Object.freeze([
  "entertainment.museum",
  "entertainment.culture",
  "entertainment.planetarium",
  "entertainment.aquarium",
]);

export const CONFIGURACION_CLIMA_REACTIVO: Readonly<ConfiguracionClimaReactivo> = Object.freeze({
  umbralProbabilidad: 0.7,
  umbralLluvia1hMm: 2.5,
  umbralLluvia3hMm: 7.5,
  horizonteHoras: 6,
  ventanaObservacionMinutos: 60,
  antiguedadMaximaObservacionMinutos: 90,
  antiguedadMaximaUbicacionMinutos: 30,
  vigenciaCacheClimaMs: 10 * 60 * 1000,
  intervaloMonitoreoMinutos: 12,
  esperaEntrePropuestasMinutos: 30,
  vigenciaPropuestaMinutos: 20,
  radioInicialMetros: 2000,
  radioMaximoMetros: 5000,
  resultadosPorBusqueda: 20,
  maxParadasAfectadas: 3,
  detallesPorParada: 4,
  candidatosPorParada: 3,
  estanciaMinimaAlternativaMinutos: 30,
  tiempoEsperaOptimizadorMs: 20000,
});

interface Variable {
  nombre: string;
  campo: keyof ConfiguracionClimaReactivo;
  minimo: number;
  maximo: number;
  entero: boolean;
}

const VARIABLES: readonly Variable[] = [
  { nombre: "CLIMA_REACTIVO_UMBRAL_PROBABILIDAD", campo: "umbralProbabilidad", minimo: 0.05, maximo: 1, entero: false },
  { nombre: "CLIMA_REACTIVO_UMBRAL_LLUVIA_1H_MM", campo: "umbralLluvia1hMm", minimo: 0.1, maximo: 100, entero: false },
  { nombre: "CLIMA_REACTIVO_UMBRAL_LLUVIA_3H_MM", campo: "umbralLluvia3hMm", minimo: 0.1, maximo: 300, entero: false },
  { nombre: "CLIMA_REACTIVO_HORIZONTE_HORAS", campo: "horizonteHoras", minimo: 1, maximo: 24, entero: true },
  // OpenWeather actualiza el clima actual cada 10 minutos: consultar más seguido no aporta datos nuevos.
  { nombre: "CLIMA_REACTIVO_INTERVALO_MINUTOS", campo: "intervaloMonitoreoMinutos", minimo: 10, maximo: 60, entero: true },
  { nombre: "CLIMA_REACTIVO_ESPERA_PROPUESTAS_MINUTOS", campo: "esperaEntrePropuestasMinutos", minimo: 0, maximo: 240, entero: true },
  { nombre: "CLIMA_REACTIVO_VIGENCIA_PROPUESTA_MINUTOS", campo: "vigenciaPropuestaMinutos", minimo: 5, maximo: 120, entero: true },
  { nombre: "CLIMA_REACTIVO_RADIO_INICIAL_M", campo: "radioInicialMetros", minimo: 100, maximo: 5000, entero: true },
  { nombre: "CLIMA_REACTIVO_RADIO_MAXIMO_M", campo: "radioMaximoMetros", minimo: 100, maximo: 5000, entero: true },
];

export function leerConfiguracionClimaReactivo(
  entorno: Record<string, string | undefined> = process.env,
  base: ConfiguracionClimaReactivo = CONFIGURACION_CLIMA_REACTIVO,
): ConfiguracionClimaReactivo {
  const configuracion: ConfiguracionClimaReactivo = { ...base };
  for (const { nombre, campo, minimo, maximo, entero } of VARIABLES) {
    const texto = entorno[nombre]?.trim();
    if (!texto) {
      continue;
    }
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor < minimo || valor > maximo || (entero && !Number.isInteger(valor))) {
      throw new Error(`${nombre} debe ser un número${entero ? " entero" : ""} entre ${minimo} y ${maximo}.`);
    }
    configuracion[campo] = valor;
  }
  if (configuracion.radioMaximoMetros < configuracion.radioInicialMetros) {
    throw new Error("CLIMA_REACTIVO_RADIO_MAXIMO_M no puede ser menor que CLIMA_REACTIVO_RADIO_INICIAL_M.");
  }
  return configuracion;
}
