
interface AlertaHorarioProps {
  nombreLugar: string;
  estado: "ajustada" | "descartada";
  mensaje: string;
}

export default function AlertaHorario({
  nombreLugar,
  estado,
  mensaje,
}: AlertaHorarioProps) {
  const descartada = estado === "descartada";

  return (
    <div
      role="status"
      className={
        descartada
          ? "alerta-horario alerta-horario-descartada"
          : "alerta-horario alerta-horario-ajustada"
      }
    >
      <strong>
        {descartada
          ? `Visita descartada: ${nombreLugar}`
          : `Horario ajustado: ${nombreLugar}`}
      </strong>

      <p>{mensaje}</p>
    </div>
  );
}
