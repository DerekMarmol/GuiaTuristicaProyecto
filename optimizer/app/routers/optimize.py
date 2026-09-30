import math
from fastapi import APIRouter
from pydantic import BaseModel
from ortools.constraint_solver import routing_enums_pb2, pywrapcp

router = APIRouter()


class Parada(BaseModel):
    id: str
    lat: float
    lng: float
    horaAperturaMin: int
    horaCierreMin: int
    tiempoEstanciaMinutos: int


class OptimizeRequest(BaseModel):
    paradas: list[Parada]


class OptimizeResponse(BaseModel):
    orden: list[str]


def calcular_matriz_tiempos(paradas: list[Parada]) -> list[list[int]]:
    n = len(paradas)
    matriz = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dx = paradas[i].lat - paradas[j].lat
                dy = paradas[i].lng - paradas[j].lng
                distancia = math.sqrt(dx ** 2 + dy ** 2)
                tiempo_viaje = int(distancia * 1000)
                matriz[i][j] = tiempo_viaje + paradas[i].tiempoEstanciaMinutos
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
            parada.horaAperturaMin, parada.horaCierreMin
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

    return OptimizeResponse(orden=orden)