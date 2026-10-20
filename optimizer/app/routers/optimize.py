
import math
from itertools import permutations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ortools.constraint_solver import routing_enums_pb2, pywrapcp

from app.services.valhalla import (
    ClienteValhalla,
    Coordenada,
    DatosRutaInvalidos,
    ErrorValhalla,
    FueraDeCobertura,
    MatrizTraslados,
    ModoTransporte,
    RutaNoDisponible,
    TiempoEsperaValhalla,
    ValhallaNoDisponible,
    obtener_cliente_valhalla,
)


router = APIRouter()

SEGUNDOS_POR_MINUTO = 60
HORIZONTE_SEGUNDOS = 24 * 60 * SEGUNDOS_POR_MINUTO
ESPERA_MAXIMA_SEGUNDOS = 60 * SEGUNDOS_POR_MINUTO
TIEMPO_INALCANZABLE = HORIZONTE_SEGUNDOS + 1
# Nodo de partida sintético: no es una visita y nunca aparece en el orden devuelto.
ID_ORIGEN = "__origen__"


class PronosticoHora(BaseModel):
    hora: str
    probabilidad_lluvia: float


class Parada(BaseModel):
    id: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    hora_apertura: str
    hora_cierre: str
    tiempo_estancia_minutos: int

    tipo_entorno: str = "desconocido"
    sensibilidad_clima: float = 0.0
    probabilidad_lluvia: float | None = None
    pronostico_horario: list[PronosticoHora] = Field(default_factory=list)


class Origen(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class OptimizeRequest(BaseModel):
    paradas: list[Parada]
    modo_transporte: ModoTransporte = "auto"


class ReoptimizeRequest(BaseModel):
    paradas: list[Parada]
    hora_actual_minutos: int
    modo_transporte: ModoTransporte = "auto"
    origen: Origen | None = None


class OptimizeResponse(BaseModel):
    orden_optimo: list[str]
    distancia_total_km: float


def hora_a_minutos(hora: str) -> int:
    horas, minutos = hora.split(":")
    return int(horas) * 60 + int(minutos)


def hora_a_segundos(hora: str) -> int:
    return hora_a_minutos(hora) * SEGUNDOS_POR_MINUTO


def estancia_segundos(parada: Parada) -> int:
    return parada.tiempo_estancia_minutos * SEGUNDOS_POR_MINUTO


def segundos_traslado(
    matriz: MatrizTraslados,
    origen: int,
    destino: int
) -> int | None:
    # Se redondea hacia arriba para que un traslado corto nunca valga cero.
    duracion = matriz.duraciones_segundos[origen][destino]
    if duracion is None:
        return None
    return math.ceil(duracion)


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


def calcular_inicios_visita(
    paradas: list[Parada],
    orden_indices: list[int],
    segundo_inicio: int,
    matriz: MatrizTraslados
) -> list[int] | None:
    """Segundo del día en que empieza cada visita; ``None`` si falta un tramo."""
    segundo_actual = segundo_inicio
    inicios = []

    for posicion, indice in enumerate(orden_indices):
        parada = paradas[indice]

        segundo_actual = max(
            segundo_actual,
            hora_a_segundos(parada.hora_apertura)
        )
        inicios.append(segundo_actual)

        segundo_actual += estancia_segundos(parada)

        if posicion + 1 < len(orden_indices):
            traslado = segundos_traslado(
                matriz,
                indice,
                orden_indices[posicion + 1]
            )

            if traslado is None:
                return None

            segundo_actual += traslado

    return inicios


def calcular_costo_climatico_ruta(
    paradas: list[Parada],
    orden_indices: list[int],
    segundo_inicio: int,
    matriz: MatrizTraslados
) -> int:
    inicios = calcular_inicios_visita(
        paradas,
        orden_indices,
        segundo_inicio,
        matriz
    )

    if inicios is None:
        raise ValueError("La ruta usa una conexión inexistente.")

    return sum(
        calcular_penalizacion_por_hora(
            paradas[indice],
            inicio // SEGUNDOS_POR_MINUTO
        )
        for indice, inicio in zip(orden_indices, inicios)
    )


def calcular_matriz_tiempos(
    paradas: list[Parada],
    matriz: MatrizTraslados
) -> list[list[int]]:
    """Tránsito en segundos para OR-Tools: estancia del origen más traslado."""
    n = len(paradas)
    tiempos = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i != j:
                traslado = segundos_traslado(matriz, i, j)

                tiempos[i][j] = (
                    TIEMPO_INALCANZABLE
                    if traslado is None
                    else traslado + estancia_segundos(paradas[i])
                )

    return tiempos


def calcular_tiempo_traslado_ruta(
    matriz: MatrizTraslados,
    orden_indices: list[int]
) -> int:
    total = 0

    for i in range(len(orden_indices) - 1):
        traslado = segundos_traslado(
            matriz,
            orden_indices[i],
            orden_indices[i + 1]
        )

        if traslado is None:
            raise ValueError("La ruta usa una conexión inexistente.")

        total += traslado

    return total


def calcular_distancia_ruta(
    matriz: MatrizTraslados,
    orden_indices: list[int]
) -> float:
    """Distancia total en kilómetros de los tramos seleccionados."""
    distancia_metros = 0.0

    for i in range(len(orden_indices) - 1):
        tramo = matriz.distancias_metros[orden_indices[i]][orden_indices[i + 1]]

        if tramo is None:
            raise ValueError("La ruta usa una conexión inexistente.")

        distancia_metros += tramo

    return distancia_metros / 1000


def ruta_respeta_horarios(
    paradas: list[Parada],
    orden_indices: list[int],
    segundo_inicio: int,
    matriz: MatrizTraslados
) -> bool:
    inicios = calcular_inicios_visita(
        paradas,
        orden_indices,
        segundo_inicio,
        matriz
    )

    if inicios is None:
        return False

    for indice, inicio in zip(orden_indices, inicios):
        parada = paradas[indice]

        if inicio + estancia_segundos(parada) > hora_a_segundos(parada.hora_cierre):
            return False

    return True


def seleccionar_mejor_ruta(
    paradas: list[Parada],
    rutas_candidatas,
    segundo_inicio: int,
    matriz: MatrizTraslados
) -> list[int] | None:
    mejor_ruta = None
    mejor_costo = float("inf")

    for ruta in rutas_candidatas:
        if not ruta_respeta_horarios(
            paradas,
            ruta,
            segundo_inicio,
            matriz
        ):
            continue

        tiempo_viaje = (
            calcular_tiempo_traslado_ruta(matriz, ruta) / SEGUNDOS_POR_MINUTO
        )

        penalizacion = calcular_costo_climatico_ruta(
            paradas,
            ruta,
            segundo_inicio,
            matriz
        )

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


def obtener_matriz_traslados(
    cliente: ClienteValhalla,
    paradas: list[Parada],
    modo: ModoTransporte
) -> MatrizTraslados:
    try:
        return cliente.matriz(
            [Coordenada(lat=p.lat, lon=p.lng) for p in paradas],
            modo
        )
    except DatosRutaInvalidos as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except FueraDeCobertura:
        raise HTTPException(
            status_code=422,
            detail="Una o más paradas están fuera de la cobertura del mapa de rutas."
        )
    except RutaNoDisponible:
        raise HTTPException(
            status_code=422,
            detail="No existe una ruta entre las paradas para el medio de transporte seleccionado."
        )
    except TiempoEsperaValhalla:
        raise HTTPException(
            status_code=503,
            detail="El servicio de rutas no respondió a tiempo."
        )
    except ValhallaNoDisponible:
        raise HTTPException(
            status_code=503,
            detail="El servicio de rutas no está disponible."
        )
    except ErrorValhalla:
        raise HTTPException(
            status_code=502,
            detail="El servicio de rutas devolvió una respuesta inválida."
        )


def parada_origen(origen: Origen) -> Parada:
    return Parada(
        id=ID_ORIGEN,
        lat=origen.lat,
        lng=origen.lng,
        hora_apertura="00:00",
        hora_cierre="24:00",
        tiempo_estancia_minutos=0,
    )


def validar_sin_origen_reservado(paradas: list[Parada]) -> None:
    if any(p.id == ID_ORIGEN for p in paradas):
        raise HTTPException(
            status_code=422,
            detail=f"El identificador {ID_ORIGEN} está reservado para el origen."
        )


def resolver_ruta(
    paradas: list[Parada],
    matriz: MatrizTraslados,
    hora_inicio_minutos: int | None = None
) -> OptimizeResponse:
    mejor_orden = resolver_orden(paradas, matriz, hora_inicio_minutos)
    return OptimizeResponse(
        orden_optimo=[paradas[i].id for i in mejor_orden],
        distancia_total_km=round(calcular_distancia_ruta(matriz, mejor_orden), 2)
    )


def resolver_orden(
    paradas: list[Parada],
    matriz: MatrizTraslados,
    hora_inicio_minutos: int | None = None
) -> list[int]:
    """Índices de ``paradas`` en el orden elegido; el nodo 0 siempre va primero."""
    if matriz.tamano != len(paradas):
        raise HTTPException(
            status_code=502,
            detail="La matriz de traslados no coincide con las paradas."
        )

    matriz_tiempos = calcular_matriz_tiempos(paradas, matriz)

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
        ESPERA_MAXIMA_SEGUNDOS,
        HORIZONTE_SEGUNDOS,
        False,
        "Tiempo"
    )

    dimension = routing.GetDimensionOrDie("Tiempo")

    conexiones_faltantes = matriz.conexiones_faltantes()

    for origen, destino in conexiones_faltantes:
        # El nodo 0 es el inicio; volver a él no forma parte del itinerario.
        if destino != 0:
            routing.NextVar(manager.NodeToIndex(origen)).RemoveValue(
                manager.NodeToIndex(destino)
            )

    for i, parada in enumerate(paradas):
        indice = manager.NodeToIndex(i)

        if i == 0:
            indice = routing.Start(0)

        apertura = hora_a_segundos(parada.hora_apertura)
        cierre = hora_a_segundos(parada.hora_cierre)

        ultimo_inicio = cierre - estancia_segundos(parada)

        if ultimo_inicio < apertura:
            raise HTTPException(
                status_code=422,
                detail=f"No hay tiempo suficiente para visitar {parada.id}."
            )

        if i == 0 and hora_inicio_minutos is not None:
            apertura = max(
                apertura,
                hora_inicio_minutos * SEGUNDOS_POR_MINUTO
            )

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
        detalle = "No se encontró un itinerario válido con los horarios proporcionados."

        if conexiones_faltantes:
            detalle = (
                "No se encontró un itinerario válido con los horarios y las "
                "rutas disponibles para el medio de transporte seleccionado."
            )

        raise HTTPException(status_code=422, detail=detalle)

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
    segundo_inicio = solution.Value(
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
            segundo_inicio,
            matriz
        )

        if ruta_climatica is not None:
            mejor_orden = ruta_climatica

    return mejor_orden


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(
    request: OptimizeRequest,
    cliente: ClienteValhalla = Depends(obtener_cliente_valhalla)
):
    validar_paradas(request.paradas)
    matriz = obtener_matriz_traslados(
        cliente,
        request.paradas,
        request.modo_transporte
    )
    return resolver_ruta(request.paradas, matriz)


@router.post("/reoptimize", response_model=OptimizeResponse)
def reoptimize(
    request: ReoptimizeRequest,
    cliente: ClienteValhalla = Depends(obtener_cliente_valhalla)
):
    validar_paradas(request.paradas)

    if request.hora_actual_minutos < 0 or request.hora_actual_minutos > 24 * 60:
        raise HTTPException(
            status_code=422,
            detail="hora_actual_minutos debe estar entre 0 y 1440."
        )

    if request.origen is None:
        matriz = obtener_matriz_traslados(
            cliente,
            request.paradas,
            request.modo_transporte
        )
        return resolver_ruta(
            request.paradas,
            matriz,
            hora_inicio_minutos=request.hora_actual_minutos
        )

    validar_sin_origen_reservado(request.paradas)
    paradas = [parada_origen(request.origen), *request.paradas]
    matriz = obtener_matriz_traslados(cliente, paradas, request.modo_transporte)
    orden = resolver_orden(
        paradas,
        matriz,
        hora_inicio_minutos=request.hora_actual_minutos
    )
    # La distancia incluye el tramo desde el origen hasta la primera visita.
    return OptimizeResponse(
        orden_optimo=[paradas[i].id for i in orden[1:]],
        distancia_total_km=round(calcular_distancia_ruta(matriz, orden), 2)
    )
