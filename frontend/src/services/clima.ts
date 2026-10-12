
export interface DatosClima {
  fechaHora: string;
  temperatura: number;
  probabilidadLluvia: number;
  codigoClima: number;
  malClima: boolean;
}

interface RespuestaClima {
  disponible: boolean;
  clima: DatosClima | null;
}

export async function consultarClima(
  lat: number,
  lng: number,
  fechaHora: string,
  signal?: AbortSignal
): Promise<DatosClima | null> {
  const parametros = new URLSearchParams({
    latitud: String(lat),
    longitud: String(lng),
    fechaHora,
  });

  try {
    const respuesta = await fetch(
      `/api/clima?${parametros.toString()}`,
      { signal }
    );

    if (!respuesta.ok) {
      return null;
    }

    const datos: RespuestaClima = await respuesta.json();

    if (!datos.disponible || !datos.clima) {
      return null;
    }

    return datos.clima;
  } catch (error) {
    if (signal?.aborted) {
      return null;
    }

    console.warn("No se pudo consultar el clima:", error);
    return null;
  }
}
