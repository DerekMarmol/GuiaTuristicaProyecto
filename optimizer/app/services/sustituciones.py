"""Selección de alternativas interiores para paradas afectadas por el clima.

Se pide una sola matriz a Valhalla con el origen, las paradas pendientes y
todos los candidatos; cada combinación evaluada usa una submatriz de ella.
La búsqueda es voraz: por cada parada afectada se prueba cada candidato con
OR-Tools y se queda el que produce la ruta viable con menor tiempo de
traslado. El número de resoluciones es como máximo grupos × candidatos + 1.
"""

from dataclasses import dataclass, field
from typing import Literal

from fastapi import HTTPException

from app.routers.optimize import (
    ID_ORIGEN,
    SEGUNDOS_POR_MINUTO,
    Origen,
    Parada,
    calcular_inicios_visita,
    estancia_segundos,
    parada_origen,
    resolver_orden,
    ruta_respeta_horarios,
)
from app.services.valhalla import MatrizTraslados

MotivoSinSustitucion = Literal["sin_candidatos", "sin_alternativa_viable"]


@dataclass(frozen=True)
class Grupo:
    parada_id: str
    candidatos: list[Parada]


@dataclass(frozen=True)
class Visita:
    parada_id: str
    inicio_minutos: int
    fin_minutos: int
    traslado_segundos: int
    distancia_metros: float


@dataclass(frozen=True)
class Ruta:
    orden: list[str]
    viable: bool
    distancia_total_km: float | None
    duracion_traslado_minutos: int | None
    visitas: list[Visita]


@dataclass
class Resultado:
    ruta_actual: Ruta
    ruta_propuesta: Ruta | None
    motivo_sin_ruta: str | None
    sustituciones: list[tuple[str, str]] = field(default_factory=list)
    sin_sustitucion: list[tuple[str, MotivoSinSustitucion]] = field(default_factory=list)


class Nodos:
    """Origen opcional, paradas pendientes y candidatos únicos, en ese orden."""

    def __init__(self, origen: Origen | None, paradas: list[Parada], grupos: list[Grupo]):
        self.con_origen = origen is not None
        self.lista: list[Parada] = [parada_origen(origen)] if origen is not None else []
        self.lista.extend(paradas)
        for grupo in grupos:
            for candidato in grupo.candidatos:
                if candidato.id not in {p.id for p in self.lista}:
                    self.lista.append(candidato)
        self.indice = {p.id: i for i, p in enumerate(self.lista)}

    def indices(self, ids: list[str]) -> list[int]:
        return ([0] if self.con_origen else []) + [self.indice[i] for i in ids]


def evaluar_orden(
    nodos: Nodos,
    matriz: MatrizTraslados,
    indices: list[int],
    segundo_inicio: int,
) -> Ruta:
    """Programa las visitas en el orden dado, sin reordenar."""
    paradas = nodos.lista
    ids = [paradas[i].id for i in indices if paradas[i].id != ID_ORIGEN]
    inicios = calcular_inicios_visita(paradas, indices, segundo_inicio, matriz)
    if inicios is None:
        return Ruta(ids, False, None, None, [])

    visitas: list[Visita] = []
    traslado_total = 0
    distancia_total = 0.0
    for posicion, (indice, inicio) in enumerate(zip(indices, inicios)):
        if paradas[indice].id == ID_ORIGEN:
            continue
        traslado = matriz.traslado(indices[posicion - 1], indice) if posicion > 0 else None
        segundos = 0 if traslado is None else round(traslado.duracion_segundos)
        metros = 0.0 if traslado is None else traslado.distancia_metros
        traslado_total += segundos
        distancia_total += metros
        visitas.append(Visita(
            parada_id=paradas[indice].id,
            inicio_minutos=inicio // SEGUNDOS_POR_MINUTO,
            fin_minutos=(inicio + estancia_segundos(paradas[indice])) // SEGUNDOS_POR_MINUTO,
            traslado_segundos=segundos,
            distancia_metros=round(metros, 1),
        ))

    return Ruta(
        orden=ids,
        viable=ruta_respeta_horarios(paradas, indices, segundo_inicio, matriz),
        distancia_total_km=round(distancia_total / 1000, 2),
        duracion_traslado_minutos=round(traslado_total / SEGUNDOS_POR_MINUTO),
        visitas=visitas,
    )


def _resolver(
    nodos: Nodos,
    matriz: MatrizTraslados,
    ids: list[str],
    hora_actual_minutos: int,
) -> list[int]:
    """Orden óptimo de ``ids`` como índices globales; 422 si no hay solución."""
    indices = nodos.indices(ids)
    sub_paradas = [nodos.lista[i] for i in indices]
    orden = resolver_orden(sub_paradas, matriz.seleccionar(indices), hora_actual_minutos)
    return [indices[k] for k in orden]


def _costo(matriz: MatrizTraslados, orden: list[int]) -> tuple[float, float]:
    tiempo = 0.0
    distancia = 0.0
    for origen, destino in zip(orden, orden[1:]):
        traslado = matriz.traslado(origen, destino)
        if traslado is None:
            return float("inf"), float("inf")
        tiempo += traslado.duracion_segundos
        distancia += traslado.distancia_metros
    return tiempo, distancia


def seleccionar_sustituciones(
    nodos: Nodos,
    matriz: MatrizTraslados,
    paradas: list[Parada],
    grupos: list[Grupo],
    hora_actual_minutos: int,
) -> Resultado:
    segundo_inicio = hora_actual_minutos * SEGUNDOS_POR_MINUTO
    actuales = [p.id for p in paradas]
    resultado = Resultado(
        ruta_actual=evaluar_orden(nodos, matriz, nodos.indices(actuales), segundo_inicio),
        ruta_propuesta=None,
        motivo_sin_ruta=None,
    )

    usados: set[str] = set()
    for grupo in grupos:
        if not grupo.candidatos:
            resultado.sin_sustitucion.append((grupo.parada_id, "sin_candidatos"))
            continue
        mejor: tuple[tuple[float, float], list[str], str] | None = None
        for candidato in grupo.candidatos:
            if candidato.id in usados or candidato.id in actuales:
                continue
            prueba = [candidato.id if i == grupo.parada_id else i for i in actuales]
            try:
                orden = _resolver(nodos, matriz, prueba, hora_actual_minutos)
            except HTTPException as exc:
                if exc.status_code != 422:
                    raise
                continue
            costo = _costo(matriz, orden)
            if mejor is None or costo < mejor[0]:
                mejor = (costo, prueba, candidato.id)
        if mejor is None:
            resultado.sin_sustitucion.append((grupo.parada_id, "sin_alternativa_viable"))
            continue
        actuales = mejor[1]
        usados.add(mejor[2])
        resultado.sustituciones.append((grupo.parada_id, mejor[2]))

    try:
        orden_final = _resolver(nodos, matriz, actuales, hora_actual_minutos)
    except HTTPException as exc:
        if exc.status_code != 422:
            raise
        resultado.motivo_sin_ruta = str(exc.detail)
        return resultado

    propuesta = evaluar_orden(nodos, matriz, orden_final, segundo_inicio)
    if not propuesta.viable:
        resultado.motivo_sin_ruta = "La ruta propuesta no respeta los horarios con los tiempos de traslado disponibles."
        return resultado
    resultado.ruta_propuesta = propuesta
    return resultado
