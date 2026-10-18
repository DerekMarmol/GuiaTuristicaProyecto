
import math
from itertools import permutations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from ortools.constraint_solver import routing_enums_pb2, pywrapcp


router = APIRouter()


class PronosticoHora(BaseModel):
    hora: str
    probabilidad_lluvia: float


class Parada(BaseModel):
    id: str
    lat: float
    lng: float
    hora_apertura: str
    hora_cierre: str
    tiempo_estancia_minutos: int

    tipo_entorno: str = "desconocido"
    sensibilidad_clima: float = 0.0
    probabilidad_lluvia: float | None = None
    pronostico_horario: list[PronosticoHora] = Field(default_factory=list)


class OptimizeRequest(BaseModel):
    paradas: list[Parada]


class ReoptimizeRequest(BaseModel):
    paradas: list[Parada]
    hora_actual_minutos: int


class OptimizeResponse(BaseModel):
    orden_optimo: list[str]
    distancia_total_km: float


def hora_a_minutos(hora: str) -> int:
    horas, minutos = hora.split(":")
    return int(horas) * 60 + int(minutos)


def distancia_km(lat1, lng1, lat2, lng2) -> float:
    radio_tierra_km = 6371

    lat1_rad = math.radians(lat1)
    lng1_rad = math.radians(lng1)
    lat2_rad = math.radians(lat2)
    lng2_rad = math.radians(lng2)

    dlat = lat2_rad - lat1_rad
    dlng = lng2_rad - lng1_rad

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(dlng / 2) ** 2
    )

    c = 2 * math.asin(math.sqrt(a))
    return radio_tierra_km * c


def calcular_penalizacion_clima(parada: Parada) -> int:
    if parada.probabilidad_lluvia is None:
        return 0

    probabilidad = max(
        0.0,
        min(100.0, parada.probabilidad_lluvia)
    )

    sensibilidad = max(
        0.0,
        min(1.0, parada.sensibilidad_clima)
    )

    tipo = parada.tipo_entorno.strip().lower()

    factores_entorno = {
        "interior": 0.1,
        "exterior": 1.0,
        "mixto": 0.5,
        "desconocido": 0.5
    }

    factor = factores_entorno.get(tipo, 0.5)

    penalizacion = probabilidad * sensibilidad * factor

    return round(penalizacion)


def calcular_matriz_penalizaciones(
    paradas: list[Parada]
) -> list[list[int]]:
    n = len(paradas)
    matriz = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i != j:
                matriz[i][j] = calcular_penalizacion_clima(
                    paradas[j]
                )

    return matriz


def calcular_penalizacion_por_hora(
    parada: Parada,
    minuto_visita: int
) -> int:
    if not parada.pronostico_horario:
        return calcular_penalizacion_clima(parada)

    hora_visita = minuto_visita // 60

    pronostico = min(
        parada.pronostico_horario,
        key=lambda p: abs(
            hora_a_minutos(p.hora) // 60 - hora_visita
        )
    )

    parada_temporal = parada.model_copy(
        update={
            "probabilidad_lluvia": pronostico.probabilidad_lluvia
        }
    )

    return calcular_penalizacion_clima(parada_temporal)


def calcular_costo_climatico_ruta(
    paradas: list[Parada],
    orden_indices: list[int],
    minuto_inicio: int
) -> int:
    minuto_actual = minuto_inicio
    penalizacion_total = 0

    for posicion, indice in enumerate(orden_indices):
        parada = paradas[indice]

        minuto_actual = max(
            minuto_actual,
            hora_a_minutos(parada.hora_apertura)
        )

        penalizacion_total += calcular_penalizacion_por_hora(
            parada,
            minuto_actual
        )

        minuto_actual += parada.tiempo_estancia_minutos

        if posicion + 1 < len(orden_indices):
            siguiente = paradas[orden_indices[posicion + 1]]

            distancia = distancia_km(
                parada.lat,
                parada.lng,
                siguiente.lat,
                siguiente.lng
            )

            minuto_actual += int((distancia / 40) * 60)

    return penalizacion_total


def calcular_matriz_tiempos(
    paradas: list[Parada]
) -> list[list[int]]:
    n = len(paradas)
    velocidad_promedio_kmh = 40
    matriz = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i != j:
                km = distancia_km(
                    paradas[i].lat,
                    paradas[i].lng,
                    paradas[j].lat,
                    paradas[j].lng
                )

                minutos_viaje = int(
                    (km / velocidad_promedio_kmh) * 60
                )

                matriz[i][j] = (
                    minutos_viaje
                    + paradas[i].tiempo_estancia_minutos
                )

    return matriz


def calcular_distancia_ruta(
    paradas: list[Parada],
    orden_indices: list[int]
) -> float:
    distancia_total = 0.0

    for i in range(len(orden_indices) - 1):
        actual = paradas[orden_indices[i]]
        siguiente = paradas[orden_indices[i + 1]]

        distancia_total += distancia_km(
            actual.lat,
            actual.lng,
            siguiente.lat,
            siguiente.lng
        )

    return distancia_total


def ruta_respeta_horarios(
    paradas: list[Parada],
    orden_indices: list[int],
    minuto_inicio: int
) -> bool:
    minuto_actual = minuto_inicio

    for posicion, indice in enumerate(orden_indices):
        parada = paradas[indice]

        apertura = hora_a_minutos(parada.hora_apertura)
        cierre = hora_a_minutos(parada.hora_cierre)

        minuto_actual = max(minuto_actual, apertura)

        if minuto_actual + parada.tiempo_estancia_minutos > cierre:
            return False

        minuto_actual += parada.tiempo_estancia_minutos

        if posicion + 1 < len(orden_indices):
            siguiente = paradas[orden_indices[posicion + 1]]

            distancia = distancia_km(
                parada.lat,
                parada.lng,
                siguiente.lat,
                siguiente.lng
            )

            minuto_actual += int((distancia / 40) * 60)

    return True



def seleccionar_mejor_ruta(
    paradas: list[Parada],
    rutas_candidatas,
    minuto_inicio: int
) -> list[int] | None:
    mejor_ruta = None
    mejor_costo = float("inf")

    for ruta in rutas_candidatas:
        if not ruta_respeta_horarios(
            paradas,
            ruta,
            minuto_inicio
        ):
            continue

        distancia = calcular_distancia_ruta(
            paradas,
            ruta
        )

        penalizacion = calcular_costo_climatico_ruta(
            paradas,
            ruta,
            minuto_inicio
        )

        tiempo_viaje = (distancia / 40) * 60
        costo_total = tiempo_viaje + penalizacion

        if costo_total < mejor_costo:
            mejor_costo = costo_total
            mejor_ruta = ruta

    return mejor_ruta


def validar_paradas(paradas: list[Parada]) -> None:
    if not paradas:
        raise HTTPException(
            status_code=422,
            detail="Debes proporcionar al menos una parada."
        )

    if len({p.id for p in paradas}) != len(paradas):
        raise HTTPException(
            status_code=422,
            detail="Las paradas deben tener identificadores únicos."
        )

    for parada in paradas:
        try:
            apertura = hora_a_minutos(parada.hora_apertura)
            cierre = hora_a_minutos(parada.hora_cierre)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"Horario inválido en la parada {parada.id}."
            )

        if (
            apertura < 0
            or cierre > 24 * 60
            or apertura > cierre
            or parada.tiempo_estancia_minutos < 0
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Horario inválido en la parada {parada.id}."
            )


def resolver_ruta(
    paradas: list[Parada],
    hora_inicio_minutos: int | None = None
) -> OptimizeResponse:
    matriz_tiempos = calcular_matriz_tiempos(paradas)

    manager = pywrapcp.RoutingIndexManager(
        len(paradas), 1, 0
    )
    routing = pywrapcp.RoutingModel(manager)

    def tiempo_callback(from_index, to_index):
        origen = manager.IndexToNode(from_index)
        destino = manager.IndexToNode(to_index)

        if routing.IsEnd(to_index):
            return 0

        return matriz_tiempos[origen][destino]

    callback_index = routing.RegisterTransitCallback(
        tiempo_callback
    )

    routing.SetArcCostEvaluatorOfAllVehicles(callback_index)

    routing.AddDimension(
        callback_index,
        60,
        24 * 60,
        False,
        "Tiempo"
    )

    dimension = routing.GetDimensionOrDie("Tiempo")

    for i, parada in enumerate(paradas):
        indice = manager.NodeToIndex(i)

        if i == 0:
            indice = routing.Start(0)

        apertura = hora_a_minutos(parada.hora_apertura)
        cierre = hora_a_minutos(parada.hora_cierre)

        ultimo_inicio = cierre - parada.tiempo_estancia_minutos

        if ultimo_inicio < apertura:
            raise HTTPException(
                status_code=422,
                detail=f"No hay tiempo suficiente para visitar {parada.id}."
            )

        if i == 0 and hora_inicio_minutos is not None:
            apertura = max(apertura, hora_inicio_minutos)

            if apertura > ultimo_inicio:
                raise HTTPException(
                    status_code=422,
                    detail=f"Ya no se alcanza a llegar a tiempo a {parada.id} desde la hora actual."
                )

        dimension.CumulVar(indice).SetRange(
            apertura,
            ultimo_inicio
        )

    parametros = pywrapcp.DefaultRoutingSearchParameters()

    parametros.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(parametros)

    if solution is None:
        raise HTTPException(
            status_code=422,
            detail="No se encontró un itinerario válido con los horarios proporcionados."
        )

    orden_original = []
    indice = routing.Start(0)

    while not routing.IsEnd(indice):
        nodo = manager.IndexToNode(indice)
        orden_original.append(nodo)
        indice = solution.Value(routing.NextVar(indice))

    mejor_orden = orden_original

    hay_clima = any(
        p.probabilidad_lluvia is not None
        or bool(p.pronostico_horario)
        for p in paradas
    )
    minuto_inicio = solution.Value(
        dimension.CumulVar(routing.Start(0))
    )

    if hay_clima and len(paradas) > 1:
        if len(paradas) <= 8:
            rutas_candidatas = (
                [0] + list(orden)
                for orden in permutations(range(1, len(paradas)))
            )
        else:
            alternativas = [orden_original]

            for i in range(1, len(orden_original)):
                for j in range(i + 1, len(orden_original)):
                    alternativa = orden_original.copy()
                    alternativa[i], alternativa[j] = (
                        alternativa[j], alternativa[i]
                    )
                    alternativas.append(alternativa)

            rutas_candidatas = alternativas

        ruta_climatica = seleccionar_mejor_ruta(
            paradas,
            rutas_candidatas,
            minuto_inicio
        )

        if ruta_climatica is not None:
            mejor_orden = ruta_climatica

    orden_ids = [
        paradas[i].id for i in mejor_orden
    ]

    distancia_total = calcular_distancia_ruta(
        paradas,
        mejor_orden
    )

    return OptimizeResponse(
        orden_optimo=orden_ids,
        distancia_total_km=round(distancia_total, 2)
    )


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest):
    validar_paradas(request.paradas)
    return resolver_ruta(request.paradas)


@router.post("/reoptimize", response_model=OptimizeResponse)
def reoptimize(request: ReoptimizeRequest):
    validar_paradas(request.paradas)

    if request.hora_actual_minutos < 0 or request.hora_actual_minutos > 24 * 60:
        raise HTTPException(
            status_code=422,
            detail="hora_actual_minutos debe estar entre 0 y 1440."
        )

    return resolver_ruta(request.paradas, hora_inicio_minutos=request.hora_actual_minutos)
