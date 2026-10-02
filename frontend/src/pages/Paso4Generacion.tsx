import { useEffect, useMemo, useRef, useState } from "react";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import Recomendaciones from "../components/Recomendaciones";
import { MapaSeguro } from "../components/MapaSeguro";
import { generarItinerario, PASOS_GENERACION } from "../services/itinerario";
import { construirRecomendaciones } from "../services/recomendaciones";
import { calcularHorarios } from "../utils/horarios";
import { diasDeViaje, fechaCorta } from "../utils/fechas";
import "./pasos.css";

const MONEDA = "Q";

const TIPOS = { solo: "Solo", pareja: "En pareja", familia: "En familia", amigos: "Con amigos" } as const;

type Fase = "generando" | "listo" | "error";
type Voto = "favor" | "contra";

export default function Paso4Generacion() {
  const { viaje, itinerarios, setItinerarios, irAPaso, reiniciar } = useViaje();
  const [fase, setFase] = useState<Fase>(itinerarios ? "listo" : "generando");
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);
  const [diaActivo, setDiaActivo] = useState(0);
  const [votos, setVotos] = useState<Record<string, Voto>>({});
  const [copiado, setCopiado] = useState("");
  // Código de ejemplo: el enlace real lo dará el servidor cuando exista la votación en vivo.
  const [codigo] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const enlaceRef = useRef<HTMLInputElement>(null);

  // La votación solo aplica a viajes "Con amigos" (no pareja, familia ni solo).
  const esGrupo = viaje.tipoViaje === "amigos";
  const dias = diasDeViaje(viaje.fechaInicio, viaje.fechaFin);
  const enlace = `https://guiaturistica.example/votar/${codigo}`;

  useEffect(() => {
    if (itinerarios) {
      setFase("listo");
      return;
    }
    let cancelado = false;
    setFase("generando");
    setProgreso(0);
    setError("");
    generarItinerario(viaje, (n) => {
      if (!cancelado) setProgreso(n);
    })
      .then((res) => {
        if (cancelado) return;
        setItinerarios(res);
        setDiaActivo(0);
        setVotos({});
        setFase("listo");
      })
      .catch((err) => {
        if (cancelado) return;
        setError(err instanceof Error ? err.message : "No se pudo generar el itinerario.");
        setFase("error");
      });
    return () => {
      cancelado = true;
    };
  }, [intento]);

  function regenerar() {
    setItinerarios(null);
    setIntento((n) => n + 1);
  }

  function votar(id: string, voto: Voto) {
    setVotos((prev) => {
      const siguiente = { ...prev };
      if (prev[id] === voto) delete siguiente[id];
      else siguiente[id] = voto;
      return siguiente;
    });
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado("Enlace copiado.");
    } catch {
      enlaceRef.current?.select();
      setCopiado("Presiona Ctrl+C para copiar el enlace.");
    }
    setTimeout(() => setCopiado(""), 2500);
  }

  const dia = itinerarios?.[diaActivo];
  const lugares = useMemo(() => (itinerarios ? construirRecomendaciones(viaje, itinerarios) : []), [itinerarios]);
  // Los hoteles solo se recomiendan si el usuario lo pidió en el Paso 2.
  const mostrarHoteles = viaje.hospedaje === false && !viaje.sinHotel;
  const horarios = dia ? calcularHorarios(dia.paradas) : [];

  return (
    <div className="card">
      <Stepper actual={4} />

      {fase === "generando" && (
        <>
          <h2>Generando tu itinerario</h2>
          <p>Estamos armando el plan para <b>{viaje.destino}</b>. Esto toma unos segundos.</p>
          <ol className="proceso" aria-live="polite">
            {PASOS_GENERACION.map((texto, i) => (
              <li key={texto} className={i < progreso ? "hecho" : i === progreso ? "activo" : ""}>{texto}</li>
            ))}
          </ol>
          <div
            className="stepper-bar"
            role="progressbar"
            aria-label="Progreso de la generación"
            aria-valuemin={0}
            aria-valuemax={PASOS_GENERACION.length}
            aria-valuenow={progreso}
          >
            <div className="stepper-fill" style={{ width: `${(progreso / PASOS_GENERACION.length) * 100}%` }} />
          </div>
        </>
      )}

      {fase === "error" && (
        <>
          <h2>No pudimos generar el itinerario</h2>
          <p className="aviso-error" role="alert">{error}</p>
          <div className="acciones">
            <button type="button" className="btn-secundario" onClick={() => irAPaso(3)}>Atrás</button>
            <button type="button" className="btn-primario" onClick={regenerar}>Reintentar</button>
          </div>
        </>
      )}

      {fase === "listo" && itinerarios && dia && (
        <>
          <h2>Tu itinerario para {viaje.destino}</h2>
          <ul className="datos">
            <li className="dato">{dias} {dias === 1 ? "día" : "días"}</li>
            {viaje.tipoViaje && <li className="dato">{TIPOS[viaje.tipoViaje]}</li>}
            {viaje.presupuesto !== undefined && (
              <li className="dato">{MONEDA} {viaje.presupuesto.toLocaleString("es-GT")} en total</li>
            )}
            {viaje.transporte && <li className="dato">{viaje.transporte}</li>}
          </ul>
          {!viaje.sinHotel && (
            <p className="nota">
              {viaje.hospedaje
                ? `Cada día sale desde: ${viaje.nombreHotel}.`
                : "Hospedaje: te sugeriremos opciones cerca de este itinerario."}
            </p>
          )}

          <div className="dias" role="tablist" aria-label="Días del viaje">
            {itinerarios.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                id={`tab-${it.id}`}
                aria-selected={i === diaActivo}
                aria-controls="panel-dia"
                className="dia"
                onClick={() => setDiaActivo(i)}
              >
                Día {it.numeroDia} · {fechaCorta(it.fecha)}
              </button>
            ))}
          </div>

          <div className="mapa-dia" role="region" aria-label={`Mapa de las paradas del día ${dia.numeroDia}`}>
            <MapaSeguro paradas={dia.paradas} />
          </div>

          <ol className="paradas" id="panel-dia" role="tabpanel" aria-labelledby={`tab-${dia.id}`}>
            {dia.paradas.map((p, i) => {
              const voto = votos[p.id];
              return (
                <li key={p.id} className="parada">
                  <div className="hora">
                    {horarios[i].inicio}
                    <small>a {horarios[i].fin}</small>
                  </div>
                  <div>
                    <h3>{p.nombre}</h3>
                    <p>Abre {p.horaApertura} · Cierra {p.horaCierre} · Estancia {p.tiempoEstanciaMinutos} min</p>
                    {esGrupo && (
                      <div className="votos">
                        <button type="button" className="voto favor" aria-pressed={voto === "favor"} onClick={() => votar(p.id, "favor")}>
                          A favor ({voto === "favor" ? 1 : 0})
                        </button>
                        <button type="button" className="voto contra" aria-pressed={voto === "contra"} onClick={() => votar(p.id, "contra")}>
                          En contra ({voto === "contra" ? 1 : 0})
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <Recomendaciones
            lugares={lugares}
            presupuestoDiario={viaje.presupuestoDiario}
            mostrarHoteles={mostrarHoteles}
            dia={dia.numeroDia}
          />

          {esGrupo && (
            <section className="votacion" aria-labelledby="t-votacion">
              <h3 id="t-votacion" style={{ margin: 0, font: "700 1rem var(--font-ui)", textTransform: "uppercase", letterSpacing: ".1em" }}>
                Votación del grupo
              </h3>
              <p className="nota">Comparte este enlace para que tu grupo vote las paradas.</p>
              <div className="enlace-grupo">
                <input ref={enlaceRef} type="text" readOnly value={enlace} aria-label="Enlace para invitar al grupo" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn-secundario" onClick={copiar}>Copiar</button>
              </div>
              <p className="nota" role="status">{copiado || "Vista previa: por ahora solo cuenta tu voto en este dispositivo."}</p>
            </section>
          )}

          <div className="acciones">
            <button type="button" className="btn-secundario" onClick={() => irAPaso(3)}>Atrás</button>
            <button type="button" className="btn-primario" onClick={regenerar}>Regenerar</button>
          </div>
          <button type="button" className="enlace" onClick={reiniciar}>Empezar un viaje nuevo</button>
        </>
      )}
    </div>
  );
}