import type { PronosticoDiario } from "../../../shared/types";
import { hayLluviaSignificativa, UMBRAL_LLUVIA_MM } from "../services/clima";

export type EstadoPronostico = "cargando" | "listo" | "sin_datos";

interface Props {
  estado: EstadoPronostico;
  dia?: PronosticoDiario;
}

const INTERVALOS_POR_DIA = 8;

function SinDatos() {
  return (
    <div className="indicador-clima sin-datos">
      Pronóstico no disponible para este día.
    </div>
  );
}

export default function IndicadorClima({ estado, dia }: Props) {
  if (estado === "cargando") {
    return (
      <div className="indicador-clima" role="status">
        Consultando pronóstico...
      </div>
    );
  }

  if (estado === "sin_datos" || !dia) {
    return <SinDatos />;
  }

  if (dia.estado === "fuera_de_cobertura") {
    return (
      <div className="indicador-clima sin-datos">
        Esta fecha está fuera del pronóstico disponible (cubre aproximadamente los próximos 5 días).
      </div>
    );
  }

  const { temperaturaMinimaC: minima, temperaturaMaximaC: maxima, temperaturaPromedioC: promedio, lluviaMm } = dia;

  if (minima === null || maxima === null || promedio === null || lluviaMm === null) {
    return <SinDatos />;
  }

  const lluvia = hayLluviaSignificativa(dia);

  return (
    <div className={`indicador-clima ${lluvia ? "clima-alerta" : "clima-normal"}`}>
      <div className="clima-datos">
        <span>
          Temperatura: <strong>{Math.round(minima)}–{Math.round(maxima)} °C</strong>
        </span>

        <span>
          Promedio: <strong>{Math.round(promedio)} °C</strong>
        </span>

        <span>
          Lluvia esperada: <strong>{lluviaMm} mm</strong>
        </span>
      </div>

      {dia.estado === "parcial" && (
        <p className="nota">
          Resumen parcial: hay datos de {dia.intervalosDisponibles} de {INTERVALOS_POR_DIA} intervalos de tres horas.
        </p>
      )}

      {lluvia && (
        <p className="clima-advertencia" role="status">
          Advertencia: se esperan {UMBRAL_LLUVIA_MM} mm de lluvia o más este día. Considera priorizar lugares bajo techo.
        </p>
      )}
    </div>
  );
}
