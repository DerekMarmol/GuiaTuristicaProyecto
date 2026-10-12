const { interpretarHorario, horarioErrorConsulta } = require("./horario");

const CONCURRENCIA_DETALLES = 4;
const INTERVALO_DETALLES_MS = 250;
const PRESUPUESTO_DETALLES_MS = 10000;

function esperar(ms, senal) {
  return new Promise((resolve) => {
    if (ms <= 0 || senal.aborted) {
      resolve();
      return;
    }
    const temporizador = setTimeout(terminar, ms);
    senal.addEventListener("abort", terminar, { once: true });
    function terminar() {
      clearTimeout(temporizador);
      senal.removeEventListener("abort", terminar);
      resolve();
    }
  });
}

function crearEnriquecedorHorarios({
  consultarDetalles,
  concurrencia = CONCURRENCIA_DETALLES,
  intervaloMs = INTERVALO_DETALLES_MS,
  presupuestoMs = PRESUPUESTO_DETALLES_MS,
}) {
  return async function enriquecerHorarios(lugares) {
    if (lugares.length === 0) {
      return [];
    }

    const identificadores = [...new Set(lugares.map((lugar) => lugar.idExterno))];
    const horarios = new Map();
    const controlador = new AbortController();
    const { signal: senal } = controlador;
    let siguiente = 0;
    let proximoInicio = 0;

    async function obtenerHorario(idExterno) {
      try {
        const propiedades = await consultarDetalles(idExterno, senal);
        return interpretarHorario(propiedades.opening_hours);
      } catch {
        return horarioErrorConsulta();
      }
    }

    async function trabajador() {
      while (siguiente < identificadores.length && !senal.aborted) {
        const idExterno = identificadores[siguiente++];
        const ahora = Date.now();
        const espera = proximoInicio - ahora;
        proximoInicio = Math.max(ahora, proximoInicio) + intervaloMs;
        await esperar(espera, senal);
        if (senal.aborted) {
          return;
        }
        const horario = await obtenerHorario(idExterno);
        if (!senal.aborted) {
          horarios.set(idExterno, horario);
        }
      }
    }

    let temporizador;
    const presupuestoAgotado = new Promise((resolve) => {
      temporizador = setTimeout(() => {
        controlador.abort();
        resolve();
      }, presupuestoMs);
    });
    const trabajadores = Array.from({ length: Math.min(concurrencia, identificadores.length) }, trabajador);

    try {
      await Promise.race([Promise.all(trabajadores), presupuestoAgotado]);
    } finally {
      clearTimeout(temporizador);
    }

    return lugares.map((lugar) => ({ ...lugar, horario: horarios.get(lugar.idExterno) ?? horarioErrorConsulta() }));
  };
}

module.exports = { crearEnriquecedorHorarios, CONCURRENCIA_DETALLES, INTERVALO_DETALLES_MS, PRESUPUESTO_DETALLES_MS };
