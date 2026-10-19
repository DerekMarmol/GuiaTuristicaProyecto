"""Cliente HTTP de Valhalla para tiempos y distancias de traslado.

Contrato interno: duraciones en segundos y distancias en metros. Una conexión
inexistente se representa con ``None``; nunca con cero.
"""

import logging
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal, get_args

import httpx

from app.config import settings


logger = logging.getLogger(__name__)

ModoTransporte = Literal["auto", "pedestrian"]
MODOS_TRANSPORTE: tuple[str, ...] = get_args(ModoTransporte)

UNIDADES_SOLICITADAS = "kilometers"
METROS_POR_UNIDAD = {"kilometers": 1000.0, "miles": 1609.344}

# Códigos de error documentados por Valhalla.
CODIGOS_FUERA_DE_COBERTURA = {171}
CODIGOS_RUTA_NO_DISPONIBLE = {154, 170, 172, 440, 441, 442, 443}


class ErrorValhalla(Exception):
    def __init__(self, mensaje: str, codigo_valhalla: int | None = None):
        super().__init__(mensaje)
        self.codigo_valhalla = codigo_valhalla


class DatosRutaInvalidos(ErrorValhalla, ValueError):
    """Coordenadas o medio de transporte inválidos (antes de consultar Valhalla)."""


class ValhallaNoDisponible(ErrorValhalla):
    """Valhalla no responde, rechaza la conexión o falla internamente."""


class TiempoEsperaValhalla(ValhallaNoDisponible):
    """Valhalla no respondió dentro del tiempo máximo configurado."""


class RespuestaValhallaInvalida(ErrorValhalla):
    """La respuesta no es JSON válido o no cumple el formato esperado."""


class SolicitudRechazadaValhalla(ErrorValhalla):
    """Valhalla rechazó la solicitud por un motivo distinto a la falta de ruta."""


class RutaNoDisponible(ErrorValhalla):
    """No existe una ruta para el medio de transporte solicitado."""


class FueraDeCobertura(RutaNoDisponible):
    """Una coordenada no está cerca de ninguna vía del mapa cargado."""


def validar_modo(modo: object) -> ModoTransporte:
    if modo not in MODOS_TRANSPORTE:
        raise DatosRutaInvalidos(
            "Medio de transporte no admitido. Usa 'auto' o 'pedestrian'."
        )
    return modo  # type: ignore[return-value]


def _es_numero(valor: object) -> bool:
    return (
        isinstance(valor, (int, float))
        and not isinstance(valor, bool)
        and math.isfinite(valor)
    )


@dataclass(frozen=True)
class Coordenada:
    lat: float
    lon: float

    def __post_init__(self):
        if not _es_numero(self.lat) or not -90 <= self.lat <= 90:
            raise DatosRutaInvalidos(
                "La latitud debe ser un número entre -90 y 90."
            )
        if not _es_numero(self.lon) or not -180 <= self.lon <= 180:
            raise DatosRutaInvalidos(
                "La longitud debe ser un número entre -180 y 180."
            )

    def a_valhalla(self) -> dict[str, float]:
        return {"lat": float(self.lat), "lon": float(self.lon)}


@dataclass(frozen=True)
class Traslado:
    duracion_segundos: float
    distancia_metros: float


@dataclass(frozen=True)
class MatrizTraslados:
    """Matrices cuadradas en el orden original de las coordenadas.

    ``duraciones_segundos[i][j]`` es el traslado de ``i`` hacia ``j``; puede
    diferir de ``[j][i]``. La diagonal es cero.
    """

    modo: ModoTransporte
    duraciones_segundos: tuple[tuple[float | None, ...], ...]
    distancias_metros: tuple[tuple[float | None, ...], ...]

    @property
    def tamano(self) -> int:
        return len(self.duraciones_segundos)

    def traslado(self, origen: int, destino: int) -> Traslado | None:
        duracion = self.duraciones_segundos[origen][destino]
        distancia = self.distancias_metros[origen][destino]
        if duracion is None or distancia is None:
            return None
        return Traslado(duracion, distancia)

    def conexiones_faltantes(self) -> list[tuple[int, int]]:
        return [
            (i, j)
            for i, fila in enumerate(self.duraciones_segundos)
            for j, duracion in enumerate(fila)
            if duracion is None
        ]

    def seleccionar(self, indices: list[int]) -> "MatrizTraslados":
        """Submatriz con las filas y columnas indicadas, en ese orden."""
        if not indices or any(not 0 <= i < self.tamano for i in indices):
            raise DatosRutaInvalidos("Los índices de la submatriz no son válidos.")
        return MatrizTraslados(
            modo=self.modo,
            duraciones_segundos=tuple(
                tuple(self.duraciones_segundos[i][j] for j in indices) for i in indices
            ),
            distancias_metros=tuple(
                tuple(self.distancias_metros[i][j] for j in indices) for i in indices
            ),
        )


def _numero_no_negativo(valor: object, campo: str) -> float:
    if not _es_numero(valor) or valor < 0:
        raise RespuestaValhallaInvalida(
            f"Valhalla devolvió un valor inválido en '{campo}'."
        )
    return float(valor)


def _metros_por_unidad(datos: dict[str, Any]) -> float:
    unidades = datos.get("units", UNIDADES_SOLICITADAS)
    if unidades not in METROS_POR_UNIDAD:
        raise RespuestaValhallaInvalida(
            "Valhalla devolvió unidades de distancia desconocidas."
        )
    return METROS_POR_UNIDAD[unidades]


def normalizar_ruta(datos: dict[str, Any]) -> Traslado:
    viaje = datos.get("trip")
    if not isinstance(viaje, dict) or not isinstance(viaje.get("summary"), dict):
        raise RespuestaValhallaInvalida(
            "La respuesta de Valhalla no contiene el resumen de la ruta."
        )
    if viaje.get("status", 0) != 0:
        raise RutaNoDisponible(
            "Valhalla no encontró una ruta entre las coordenadas."
        )

    resumen = viaje["summary"]
    duracion = _numero_no_negativo(resumen.get("time"), "trip.summary.time")
    distancia = _numero_no_negativo(resumen.get("length"), "trip.summary.length")
    return Traslado(
        duracion_segundos=duracion,
        distancia_metros=distancia * _metros_por_unidad(viaje),
    )


def normalizar_matriz(
    datos: dict[str, Any],
    cantidad: int,
    modo: ModoTransporte
) -> MatrizTraslados:
    filas = datos.get("sources_to_targets")
    if not isinstance(filas, list) or len(filas) != cantidad:
        raise RespuestaValhallaInvalida(
            "La matriz de Valhalla no tiene una fila por cada parada."
        )

    factor = _metros_por_unidad(datos)
    duraciones: list[list[float | None]] = [[None] * cantidad for _ in range(cantidad)]
    distancias: list[list[float | None]] = [[None] * cantidad for _ in range(cantidad)]
    celdas_vistas: set[tuple[int, int]] = set()

    for fila in filas:
        if not isinstance(fila, list) or len(fila) != cantidad:
            raise RespuestaValhallaInvalida(
                "La matriz de Valhalla no tiene una columna por cada parada."
            )
        for celda in fila:
            if not isinstance(celda, dict):
                raise RespuestaValhallaInvalida(
                    "La matriz de Valhalla contiene celdas con formato inválido."
                )
            origen = celda.get("from_index")
            destino = celda.get("to_index")
            if (
                not isinstance(origen, int) or isinstance(origen, bool)
                or not isinstance(destino, int) or isinstance(destino, bool)
                or not 0 <= origen < cantidad
                or not 0 <= destino < cantidad
                or (origen, destino) in celdas_vistas
            ):
                raise RespuestaValhallaInvalida(
                    "La matriz de Valhalla tiene índices inválidos o repetidos."
                )
            celdas_vistas.add((origen, destino))

            tiempo = celda.get("time")
            distancia = celda.get("distance")
            if tiempo is None and distancia is None:
                continue
            if tiempo is None or distancia is None:
                raise RespuestaValhallaInvalida(
                    "La matriz de Valhalla mezcla tiempos y distancias ausentes."
                )
            duraciones[origen][destino] = _numero_no_negativo(tiempo, "time")
            distancias[origen][destino] = (
                _numero_no_negativo(distancia, "distance") * factor
            )

    for i in range(cantidad):
        duraciones[i][i] = 0.0
        distancias[i][i] = 0.0

    return MatrizTraslados(
        modo=modo,
        duraciones_segundos=tuple(tuple(fila) for fila in duraciones),
        distancias_metros=tuple(tuple(fila) for fila in distancias),
    )


def _extraer_error(respuesta: httpx.Response) -> tuple[int | None, str | None]:
    try:
        cuerpo = respuesta.json()
    except ValueError:
        return None, None
    if not isinstance(cuerpo, dict):
        return None, None
    codigo = cuerpo.get("error_code")
    mensaje = cuerpo.get("error")
    return (
        codigo if isinstance(codigo, int) and not isinstance(codigo, bool) else None,
        mensaje if isinstance(mensaje, str) else None,
    )


class ClienteValhalla:
    def __init__(
        self,
        url_base: str,
        tiempo_espera_segundos: float,
        cliente_http: httpx.Client | None = None
    ):
        if not url_base:
            raise ValueError("Falta la URL base de Valhalla (VALHALLA_URL).")
        if tiempo_espera_segundos <= 0:
            raise ValueError("El tiempo de espera de Valhalla debe ser positivo.")
        self._http = cliente_http or httpx.Client(
            base_url=url_base,
            timeout=tiempo_espera_segundos,
        )

    def cerrar(self) -> None:
        self._http.close()

    def ruta(
        self,
        origen: Coordenada,
        destino: Coordenada,
        modo: str
    ) -> Traslado:
        modo_validado = validar_modo(modo)
        datos = self._post("/route", {
            "locations": [origen.a_valhalla(), destino.a_valhalla()],
            "costing": modo_validado,
            "units": UNIDADES_SOLICITADAS,
            "directions_type": "none",
        })
        return normalizar_ruta(datos)

    def matriz(
        self,
        coordenadas: list[Coordenada],
        modo: str
    ) -> MatrizTraslados:
        modo_validado = validar_modo(modo)
        if not coordenadas:
            raise DatosRutaInvalidos("Se necesita al menos una coordenada.")
        if not all(isinstance(c, Coordenada) for c in coordenadas):
            raise DatosRutaInvalidos("Las coordenadas de la matriz no son válidas.")

        if len(coordenadas) == 1:
            return MatrizTraslados(modo_validado, ((0.0,),), ((0.0,),))

        ubicaciones = [c.a_valhalla() for c in coordenadas]
        datos = self._post("/sources_to_targets", {
            "sources": ubicaciones,
            "targets": ubicaciones,
            "costing": modo_validado,
            "units": UNIDADES_SOLICITADAS,
            "verbose": True,
        })
        return normalizar_matriz(datos, len(coordenadas), modo_validado)

    def _post(self, endpoint: str, cuerpo: dict[str, Any]) -> dict[str, Any]:
        try:
            respuesta = self._http.post(endpoint, json=cuerpo)
        except httpx.TimeoutException as exc:
            logger.warning("Valhalla excedió el tiempo de espera en %s.", endpoint)
            raise TiempoEsperaValhalla(
                "Valhalla no respondió a tiempo."
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "No fue posible conectar con Valhalla en %s (%s).",
                endpoint,
                type(exc).__name__,
            )
            raise ValhallaNoDisponible(
                "No fue posible conectar con Valhalla."
            ) from exc

        if respuesta.status_code >= 400:
            self._lanzar_error_http(endpoint, respuesta)

        try:
            datos = respuesta.json()
        except ValueError as exc:
            logger.warning("Valhalla devolvió JSON inválido en %s.", endpoint)
            raise RespuestaValhallaInvalida(
                "Valhalla devolvió una respuesta que no es JSON válido."
            ) from exc
        if not isinstance(datos, dict):
            raise RespuestaValhallaInvalida(
                "Valhalla devolvió una respuesta con formato inesperado."
            )
        return datos

    @staticmethod
    def _lanzar_error_http(endpoint: str, respuesta: httpx.Response) -> None:
        codigo, mensaje = _extraer_error(respuesta)
        logger.warning(
            "Valhalla respondió HTTP %s en %s (error_code=%s).",
            respuesta.status_code,
            endpoint,
            codigo,
        )
        detalle = mensaje or f"HTTP {respuesta.status_code}"

        if codigo in CODIGOS_FUERA_DE_COBERTURA:
            raise FueraDeCobertura(
                f"Coordenada fuera de la cobertura del mapa: {detalle}.", codigo
            )
        if codigo in CODIGOS_RUTA_NO_DISPONIBLE:
            raise RutaNoDisponible(f"Ruta no disponible: {detalle}.", codigo)
        if respuesta.status_code >= 500:
            raise ValhallaNoDisponible(
                f"Valhalla falló al procesar la solicitud: {detalle}.", codigo
            )
        raise SolicitudRechazadaValhalla(
            f"Valhalla rechazó la solicitud: {detalle}.", codigo
        )


@lru_cache(maxsize=1)
def obtener_cliente_valhalla() -> ClienteValhalla:
    return ClienteValhalla(
        settings.valhalla_url,
        settings.valhalla_timeout_segundos,
    )


def cerrar_cliente_valhalla() -> None:
    if obtener_cliente_valhalla.cache_info().currsize:
        obtener_cliente_valhalla().cerrar()
        obtener_cliente_valhalla.cache_clear()
