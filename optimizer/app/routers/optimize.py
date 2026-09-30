import math
from fastapi import APIRouter
from pydantic import BaseModel
from ortools.constraint_solver import routing_enums_pb2, pywrapcp

router = APIRouter()


class Parada(BaseModel):
    id: str
    lat: float
    lng: float
    hora_apertura: str
    hora_cierre: str
    tiempo_estancia_minutos: int


class OptimizeRequest(BaseModel):
    paradas: list[Parada]


class OptimizeResponse(BaseModel):
    orden_optimo: list[str]
    distancia_total_km: float


def hora_a_minutos(hora: str) -> int:
    horas, minutos = hora.split(":")
    return int(horas) * 60 + int(minutos)


def distancia_km(lat1, lng1, lat2, lng2) -> float:
    radio_tierra_km = 6371
    lat1_rad, lng1_rad = math.radians(lat1), math.radians(lng1)
    lat2_rad, lng2_rad = math.radians(lat2), math.radians(lng2)
    dlat = lat2_rad - lat1_rad
    dlng = lng2_rad - lng1_rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return radio_tierra_km * c


def calcular_matriz_tiempos(paradas: list[Parada]) -> list[list[int]]:
    n = len(paradas)
    velocidad_promedio_kmh = 40
    matriz = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                km = distancia_km(paradas[i].lat, paradas[i].lng, paradas[j].lat, paradas[j].lng)
                minutos_viaje = int((km / velocidad_promedio_kmh) * 60)
                matriz[i][j] = minutos_viaje + paradas[i].tiempo_estancia_minutos
    return matriz


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest):
    paradas = request.paradas
    matriz_tiempos = calcular_matriz_tiempos(paradas)

    manager = pywrapcp.RoutingIndexManager(len(matriz_tiempos), 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def tiempo_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matriz_tiempos[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(tiempo_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    routing.AddDimension(
        transit_callback_index,
        60,
        24 * 60,
        False,
        "Tiempo",
    )
    time_dimension = routing.GetDimensionOrDie("Tiempo")

    for i, parada in enumerate(paradas):
        index = manager.NodeToIndex(i)
        time_dimension.CumulVar(index).SetRange(
            hora_a_minutos(parada.hora_apertura),
            hora_a_minutos(parada.hora_cierre),
        )

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )

    solution = routing.SolveWithParameters(search_parameters)

    orden = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        orden.append(paradas[node].id)
        index = solution.Value(routing.NextVar(index))

    distancia_total = 0.0
    for k in range(len(orden) - 1):
        parada_actual = next(p for p in paradas if p.id == orden[k])
        parada_siguiente = next(p for p in paradas if p.id == orden[k + 1])
        distancia_total += distancia_km(
            parada_actual.lat, parada_actual.lng,
            parada_siguiente.lat, parada_siguiente.lng,
        )

    return OptimizeResponse(
        orden_optimo=orden,
        distancia_total_km=round(distancia_total, 2),
    )