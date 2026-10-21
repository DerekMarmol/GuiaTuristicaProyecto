import type { PronosticoDiario } from "../../../shared/types";
import { hayLluviaSignificativa, UMBRAL_LLUVIA_MM, type ClimaAhora } from "../services/clima";

export type EstadoPronostico = "cargando" | "listo" | "sin_datos";

interface Props {
  estado: EstadoPronostico;
  dia?: PronosticoDiario;
  // Clima observado en este momento; solo se pasa cuando el día mostrado es hoy.
  ahora?: ClimaAhora | null;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });

// El clima de este momento va separado del pronóstico: una temperatura puntual (por ejemplo 29 °C a las
// 4 p. m.) no se compara con el rango previsto para todo el día.
function Ahora({ ahora }: { ahora: ClimaAhora }) {
  return (
    <div className="clima-ahora">
      <p className="clima-titulo">Ahora en tu destino</p>
      <span>
        <strong>{Math.round(ahora.temperaturaC ?? 0)} °C</strong>
        {ahora.descripcion && ` · ${ahora.descripcion}`} · observado a las {hora(ahora.observadoEn)}
      </span>
    </div>
  );
}

function Pronostico({ estado, dia }: Omit<Props, "ahora">) {
  if (estado === "cargando") {
    return <span role="status">Consultando pronóstico...</span>;
  }

  if (estado === "sin_datos" || !dia) {
    return <span>Pronóstico no disponible para este día.</span>;
  }

  if (dia.estado === "fuera_de_cobertura") {
    return <span>Esta fecha todavía no tiene pronóstico: se publica con unos 5 días de anticipación.</span>;
  }

  const { temperaturaMinimaC: minima, temperaturaMaximaC: maxima, temperaturaPromedioC: promedio, lluviaMm } = dia;

  if (minima === null || maxima === null || promedio === null || lluviaMm === null) {
    return <span>Pronóstico no disponible para este día.</span>;
  }

  return (
    <>
      <p className="clima-titulo">Pronóstico para todo el día</p>
      <div className="clima-datos">
        <span>
          Mínima y máxima: <strong>{Math.round(minima)}–{Math.round(maxima)} °C</strong>
        </span>

        <span>
          Promedio: <strong>{Math.round(promedio)} °C</strong>
        </span>

        <span>
          Lluvia esperada: <strong>{lluviaMm} mm</strong>
        </span>
      </div>

      {dia.estado === "parcial" && (
        <p className="nota">Pronóstico parcial: todavía no cubre todas las horas de este día.</p>
      )}

      {hayLluviaSignificativa(dia) && (
        <p className="clima-advertencia" role="status">
          Advertencia: se esperan {UMBRAL_LLUVIA_MM} mm de lluvia o más este día. Considera priorizar lugares bajo techo.
        </p>
      )}
    </>
  );
}

export default function IndicadorClima({ estado, dia, ahora }: Props) {
  const conDatos = estado === "listo" && dia?.lluviaMm != null;
  const clase = !conDatos ? "sin-datos" : hayLluviaSignificativa(dia) ? "clima-alerta" : "clima-normal";

  return (
    <div className={`indicador-clima ${clase}`}>
      {ahora && ahora.temperaturaC !== null && <Ahora ahora={ahora} />}
      <Pronostico estado={estado} dia={dia} />
    </div>
  );
}
