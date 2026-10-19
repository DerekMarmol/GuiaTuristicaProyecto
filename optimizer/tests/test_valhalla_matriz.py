import json

import httpx
import pytest

from app.services.valhalla import (
    Coordenada,
    FueraDeCobertura,
    RespuestaValhallaInvalida,
)

from valhalla_falso import crear_cliente_http_simulado as crear_cliente, error_valhalla


PUNTOS = [
    Coordenada(lat=14.6425, lon=-90.5133),
    Coordenada(lat=14.6420, lon=-90.5116),
    Coordenada(lat=14.6066, lon=-90.5059),
]


def respuesta_matriz(tiempos, distancias_km, unidades="kilometers"):
    filas = [
        [
            {
                "from_index": i,
                "to_index": j,
                "time": tiempos[i][j],
                "distance": distancias_km[i][j],
            }
            for j in range(len(tiempos[i]))
        ]
        for i in range(len(tiempos))
    ]
    return {"units": unidades, "sources_to_targets": filas}


def responder(cuerpo):
    return lambda _: httpx.Response(200, json=cuerpo)


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_matriz_de_dos_lugares(modo):
    cliente, solicitudes = crear_cliente(responder(respuesta_matriz(
        [[0, 120], [150, 0]],
        [[0, 1.2], [1.5, 0]],
    )))

    matriz = cliente.matriz(PUNTOS[:2], modo)

    assert matriz.modo == modo
    assert matriz.duraciones_segundos == ((0.0, 120.0), (150.0, 0.0))
    assert matriz.distancias_metros == ((0.0, 1200.0), (1500.0, 0.0))

    assert solicitudes[0].url.path == "/sources_to_targets"
    cuerpo = json.loads(solicitudes[0].content)
    assert cuerpo["costing"] == modo
    assert cuerpo["units"] == "kilometers"
    assert cuerpo["sources"] == cuerpo["targets"] == [
        {"lat": 14.6425, "lon": -90.5133},
        {"lat": 14.6420, "lon": -90.5116},
    ]


def test_matriz_multiple_conserva_orden_e_indices():
    tiempos = [[0, 100, 300], [110, 0, 250], [320, 260, 0]]
    distancias = [[0, 1.0, 3.0], [1.1, 0, 2.5], [3.2, 2.6, 0]]
    cuerpo = respuesta_matriz(tiempos, distancias)
    # Valhalla ubica cada celda por sus índices, no por su posición en la fila.
    for fila in cuerpo["sources_to_targets"]:
        fila.reverse()

    cliente, solicitudes = crear_cliente(responder(cuerpo))
    matriz = cliente.matriz(PUNTOS, "auto")

    assert len(solicitudes) == 1
    assert matriz.tamano == 3
    assert all(len(fila) == 3 for fila in matriz.duraciones_segundos)
    assert matriz.duraciones_segundos == (
        (0.0, 100.0, 300.0), (110.0, 0.0, 250.0), (320.0, 260.0, 0.0)
    )
    assert matriz.distancias_metros[2][1] == pytest.approx(2600.0)
    assert matriz.distancias_metros[1][2] == pytest.approx(2500.0)


def test_matriz_diferencia_ida_y_regreso():
    cliente, _ = crear_cliente(responder(respuesta_matriz(
        [[0, 100], [400, 0]],
        [[0, 1.0], [4.0, 0]],
    )))

    matriz = cliente.matriz(PUNTOS[:2], "auto")

    assert matriz.traslado(0, 1).duracion_segundos == 100.0
    assert matriz.traslado(1, 0).duracion_segundos == 400.0
    assert matriz.traslado(1, 0).distancia_metros == 4000.0


def test_matriz_de_un_lugar_no_consulta_valhalla():
    def sin_red(_):
        raise AssertionError("No debe consultarse Valhalla con un solo lugar.")

    cliente, solicitudes = crear_cliente(sin_red)
    matriz = cliente.matriz(PUNTOS[:1], "pedestrian")

    assert solicitudes == []
    assert matriz.duraciones_segundos == ((0.0,),)
    assert matriz.distancias_metros == ((0.0,),)


def test_matriz_diagonal_es_cero():
    cliente, _ = crear_cliente(responder(respuesta_matriz(
        [[3, 100], [90, 2]],
        [[0.01, 1.0], [0.9, 0.02]],
    )))

    matriz = cliente.matriz(PUNTOS[:2], "auto")

    assert matriz.duraciones_segundos[0][0] == 0.0
    assert matriz.duraciones_segundos[1][1] == 0.0
    assert matriz.distancias_metros[0][0] == 0.0
    assert matriz.distancias_metros[1][1] == 0.0


def test_matriz_conserva_conexiones_inaccesibles_sin_cero():
    cliente, _ = crear_cliente(responder(respuesta_matriz(
        [[0, None, 300], [110, 0, 250], [320, None, 0]],
        [[0, None, 3.0], [1.1, 0, 2.5], [3.2, None, 0]],
    )))

    matriz = cliente.matriz(PUNTOS, "pedestrian")

    assert matriz.duraciones_segundos[0][1] is None
    assert matriz.distancias_metros[2][1] is None
    assert matriz.traslado(0, 1) is None
    assert matriz.traslado(1, 0).duracion_segundos == 110.0
    assert matriz.conexiones_faltantes() == [(0, 1), (2, 1)]


def test_matriz_convierte_millas():
    cliente, _ = crear_cliente(responder(respuesta_matriz(
        [[0, 60], [60, 0]], [[0, 1], [2, 0]], "miles"
    )))

    matriz = cliente.matriz(PUNTOS[:2], "auto")

    assert matriz.distancias_metros[0][1] == pytest.approx(1609.344)
    assert matriz.distancias_metros[1][0] == pytest.approx(3218.688)


def test_matriz_fuera_de_cobertura():
    cliente, _ = crear_cliente(
        lambda _: error_valhalla(400, 171, "No suitable edges near location")
    )

    with pytest.raises(FueraDeCobertura):
        cliente.matriz(PUNTOS, "auto")


def _sin_fila(cuerpo):
    cuerpo["sources_to_targets"].pop()
    return cuerpo


def _fila_corta(cuerpo):
    cuerpo["sources_to_targets"][0].pop()
    return cuerpo


def _indice_repetido(cuerpo):
    cuerpo["sources_to_targets"][0][1]["to_index"] = 0
    return cuerpo


def _indice_fuera_de_rango(cuerpo):
    cuerpo["sources_to_targets"][1][0]["from_index"] = 7
    return cuerpo


def _ausencia_parcial(cuerpo):
    cuerpo["sources_to_targets"][0][1]["distance"] = None
    return cuerpo


def _duracion_negativa(cuerpo):
    cuerpo["sources_to_targets"][0][1]["time"] = -1
    return cuerpo


def _sin_matriz(cuerpo):
    del cuerpo["sources_to_targets"]
    return cuerpo


@pytest.mark.parametrize("alterar", [
    _sin_fila,
    _fila_corta,
    _indice_repetido,
    _indice_fuera_de_rango,
    _ausencia_parcial,
    _duracion_negativa,
    _sin_matriz,
])
def test_matriz_inconsistente(alterar):
    cuerpo = alterar(respuesta_matriz(
        [[0, 100, 300], [110, 0, 250], [320, 260, 0]],
        [[0, 1.0, 3.0], [1.1, 0, 2.5], [3.2, 2.6, 0]],
    ))
    cliente, _ = crear_cliente(responder(cuerpo))

    with pytest.raises(RespuestaValhallaInvalida):
        cliente.matriz(PUNTOS, "auto")
