interface Props {
  actual: number;
  total?: number;
}

export default function Stepper({ actual, total = 4 }: Props) {
  return (
    <div className="stepper">
      <p className="stepper-text">Paso {actual} de {total}</p>
      <div
        className="stepper-bar"
        role="progressbar"
        aria-label={`Paso ${actual} de ${total}`}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={actual}
      >
        <div className="stepper-fill" style={{ width: `${(actual / total) * 100}%` }} />
      </div>
    </div>
  );
}