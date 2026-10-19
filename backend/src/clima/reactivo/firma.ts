import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ItinerarioActivo, ParadaPropuesta } from "../../../../shared/types";

export interface CargaPropuesta {
  v: 1;
  id: string;
  itinerarioId: string;
  huellaOrigen: string;
  huellaResultado: string;
  venceEn: number;
  paradasPendientes: ParadaPropuesta[];
}

export interface Firmador {
  firmar(carga: CargaPropuesta): string;
  verificar(token: string): CargaPropuesta | null;
}

const base64url = (texto: string | Buffer) => Buffer.from(texto).toString("base64url");

// Sin CLIMA_REACTIVO_SECRETO la clave es aleatoria por proceso: reiniciar el servidor invalida las propuestas pendientes.
export function crearFirmador(secreto?: string): Firmador {
  const clave = secreto?.trim() || randomBytes(32).toString("hex");
  const firmarTexto = (texto: string) => createHmac("sha256", clave).update(texto).digest();

  return {
    firmar(carga) {
      const cuerpo = base64url(JSON.stringify(carga));
      return `${cuerpo}.${base64url(firmarTexto(cuerpo))}`;
    },
    verificar(token) {
      const partes = token.split(".");
      if (partes.length !== 2) return null;
      const [cuerpo, firma] = partes;
      const esperada = firmarTexto(cuerpo);
      const recibida = Buffer.from(firma, "base64url");
      if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
        return null;
      }
      try {
        const carga = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as CargaPropuesta;
        return carga && carga.v === 1 && Array.isArray(carga.paradasPendientes) ? carga : null;
      } catch {
        return null;
      }
    },
  };
}

const redondear = (valor: number) => Math.round(valor * 1e6) / 1e6;

// Identifica el estado del itinerario que importa para aplicar una propuesta: orden, estados, ubicación y horarios.
export function huellaItinerario({ id, fecha, paradas }: ItinerarioActivo): string {
  const canonico = JSON.stringify({
    id,
    fecha,
    paradas: paradas.map((p) => [p.id, p.estado, redondear(p.lat), redondear(p.lng), p.horaApertura, p.horaCierre, p.tiempoEstanciaMinutos]),
  });
  return createHash("sha256").update(canonico).digest("hex");
}
