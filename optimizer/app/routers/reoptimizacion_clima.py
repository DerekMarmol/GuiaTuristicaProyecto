from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.routers.optimize import (
    Origen,
    Parada,
    obtener_matriz_traslados,
    validar_paradas,
    validar_sin_origen_reservado,
)
from app.services.sustituciones import (
    Grupo,
    Nodos,
    Ruta,
    seleccionar_sustituciones,
)
from app.services.valhalla import ClienteValhalla, ModoTransporte, obtener_cliente_valhalla


router = APIRouter()

MAX_PARADAS = 25
MAX_GRUPOS = 5
MAX_CANDIDATOS = 5


class GrupoSustitucion(BaseModel):
    parada_id: str
    candidatos: list[Parada] = Field(default_factory=list, max_length=MAX_CANDIDATOS)


class ReoptimizeClimaRequest(BaseModel):
    paradas: list[Parada] = Field(min_length=1, max_length=MAX_PARADAS)
    hora_actual_minutos: int = Field(ge=0, le=24 * 60)
    modo_transporte: ModoTransporte = "auto"
    origen: Origen | None = None
    sustituciones: list[GrupoSustitucion] = Field(default_factory=list, max_length=MAX_GRUPOS)


class VisitaProgramada(BaseModel):
    parada_id: str
    inicio_minutos: int
    fin_minutos: int
    traslado_segundos: int
    distancia_metros: float


class RutaEvaluada(BaseModel):
    orden: list[str]
    viable: bool
    distancia_total_km: float | None
    duracion_traslado_minutos: int | None
    visitas: list[VisitaProgramada]


class SustitucionAplicada(BaseModel):
    parada_id: str
    alternativa_id: str


class SinSustitucion(BaseModel):
    parada_id: str
    motivo: Literal["sin_candidatos", "sin_alternativa_viable"]


class ReoptimizeClimaResponse(BaseModel):
    ruta_actual: RutaEvaluada
    ruta_propuesta: RutaEvaluada | None
    motivo_sin_ruta: str | None
    sustituciones: list[SustitucionAplicada]
    sin_sustitucion: list[SinSustitucion]


def _validar(request: ReoptimizeClimaRequest) -> None:
    validar_paradas(request.paradas)
    validar_sin_origen_reservado(request.paradas)

    pendientes = {p.id for p in request.paradas}
    agrupadas: set[str] = set()
    candidatos: dict[str, Parada] = {}
    for grupo in request.sustituciones:
        if grupo.parada_id not in pendientes or grupo.parada_id in agrupadas:
            raise HTTPException(
                status_code=422,
                detail="Cada grupo de sustitución debe referirse a una parada pendiente distinta."
            )
        agrupadas.add(grupo.parada_id)
        for candidato in grupo.candidatos:
            if candidato.id in pendientes:
                raise HTTPException(
                    status_code=422,
                    detail=f"El candidato {candidato.id} ya es una parada pendiente."
                )
            anterior = candidatos.get(candidato.id)
            if anterior is not None and anterior != candidato:
                raise HTTPException(
                    status_code=422,
                    detail=f"El candidato {candidato.id} aparece con datos distintos."
                )
            candidatos[candidato.id] = candidato

    if candidatos:
        validar_paradas(list(candidatos.values()))
        validar_sin_origen_reservado(list(candidatos.values()))


def _a_modelo(ruta: Ruta) -> RutaEvaluada:
    return RutaEvaluada(
        orden=ruta.orden,
        viable=ruta.viable,
        distancia_total_km=ruta.distancia_total_km,
        duracion_traslado_minutos=ruta.duracion_traslado_minutos,
        visitas=[VisitaProgramada(**vars(v)) for v in ruta.visitas],
    )


@router.post("/reoptimize-clima", response_model=ReoptimizeClimaResponse)
def reoptimize_clima(
    request: ReoptimizeClimaRequest,
    cliente: ClienteValhalla = Depends(obtener_cliente_valhalla)
):
    _validar(request)
    grupos = [Grupo(g.parada_id, list(g.candidatos)) for g in request.sustituciones]
    nodos = Nodos(request.origen, request.paradas, grupos)
    matriz = obtener_matriz_traslados(cliente, nodos.lista, request.modo_transporte)
    resultado = seleccionar_sustituciones(
        nodos, matriz, request.paradas, grupos, request.hora_actual_minutos
    )
    return ReoptimizeClimaResponse(
        ruta_actual=_a_modelo(resultado.ruta_actual),
        ruta_propuesta=None if resultado.ruta_propuesta is None else _a_modelo(resultado.ruta_propuesta),
        motivo_sin_ruta=resultado.motivo_sin_ruta,
        sustituciones=[SustitucionAplicada(parada_id=p, alternativa_id=a) for p, a in resultado.sustituciones],
        sin_sustitucion=[SinSustitucion(parada_id=p, motivo=m) for p, m in resultado.sin_sustitucion],
    )
