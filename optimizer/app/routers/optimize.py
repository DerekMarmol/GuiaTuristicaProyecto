import math
from fastapi import APIRouter
from pydantic import BaseModel
from ortools.constraint_solver import routing_enums_pb2, pywrapcp

router = APIRouter()


class Parada(BaseModel):
    id: str
    lat: float
    lng: float


class OptimizeRequest(BaseModel):
    paradas: list[Parada]


class OptimizeResponse(BaseModel):
    orden: list[str]


def calcular_matriz_distancias(paradas: list[Parada]) -> list[list[int]]:
    n = len(paradas)
    matriz = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dx = paradas[i].lat - paradas[j].lat
                dy = paradas[i].lng - paradas[j].lng
                distancia = math.sqrt(dx ** 2 + dy ** 2)
                matriz[i][j] = int(distancia * 100000)
    return matriz


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest):
    paradas = request.paradas
    matriz = calcular_matriz_distancias(paradas)

    manager = pywrapcp.RoutingIndexManager(len(matriz), 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distancia_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return matriz[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distancia_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

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