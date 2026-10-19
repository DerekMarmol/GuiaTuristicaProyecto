"""Pruebas contra una instancia real de Valhalla con datos de Guatemala.

Se omiten si VALHALLA_URL (por defecto http://localhost:8002) no responde.
"""

import httpx
import pytest

from app.config import settings
from app.services.valhalla import (
    ClienteValhalla,
    Coordenada,
    FueraDeCobertura,
    RutaNoDisponible,
)

from valhalla_falso import crear_cliente_api


def _valhalla_disponible() -> bool:
    try:
        return httpx.get(f"{settings.valhalla_url}/status", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(
    not _valhalla_disponible(),
    reason=f"Valhalla no está disponible en {settings.valhalla_url}",
)

PLAZA_CONSTITUCION = Coordenada(lat=14.6425, lon=-90.5133)
MERCADO_CENTRAL = Coordenada(lat=14.6420, lon=-90.5116)
MUSEO_POPOL_VUH = Coordenada(lat=14.6066, lon=-90.5059)
OCEANO_PACIFICO = Coordenada(lat=10.0, lon=-95.0)


@pytest.fixture(scope="module")
def cliente():
    cliente = ClienteValhalla(settings.valhalla_url, settings.valhalla_timeout_segundos)
    yield cliente
    cliente.cerrar()


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_ruta_real(cliente, modo):
    traslado = cliente.ruta(PLAZA_CONSTITUCION, MUSEO_POPOL_VUH, modo)

    # En línea recta hay unos 4 km; la red vial nunca es más corta.
    assert traslado.distancia_metros > 4000
    assert traslado.duracion_segundos > 0


def test_caminar_tarda_mas_que_conducir(cliente):
    auto = cliente.ruta(PLAZA_CONSTITUCION, MUSEO_POPOL_VUH, "auto")
    pie = cliente.ruta(PLAZA_CONSTITUCION, MUSEO_POPOL_VUH, "pedestrian")

    assert pie.duracion_segundos > auto.duracion_segundos


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_matriz_real(cliente, modo):
    puntos = [PLAZA_CONSTITUCION, MERCADO_CENTRAL, MUSEO_POPOL_VUH]

    matriz = cliente.matriz(puntos, modo)

    assert matriz.tamano == 3
    for i in range(3):
        assert matriz.duraciones_segundos[i][i] == 0.0
        assert matriz.distancias_metros[i][i] == 0.0
        for j in range(3):
            if i != j:
                assert matriz.duraciones_segundos[i][j] > 0
                assert matriz.distancias_metros[i][j] > 0

    ruta = cliente.ruta(PLAZA_CONSTITUCION, MUSEO_POPOL_VUH, modo)
    assert matriz.distancias_metros[0][2] == pytest.approx(ruta.distancia_metros, rel=0.15)


def test_ruta_fuera_de_cobertura(cliente):
    with pytest.raises(FueraDeCobertura):
        cliente.ruta(PLAZA_CONSTITUCION, OCEANO_PACIFICO, "auto")


def test_matriz_fuera_de_cobertura(cliente):
    with pytest.raises(RutaNoDisponible):
        cliente.matriz([PLAZA_CONSTITUCION, OCEANO_PACIFICO], "auto")


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_optimize_de_extremo_a_extremo(cliente, modo):
    api = crear_cliente_api(cliente)
    paradas = [
        {"id": "plaza", "lat": 14.6425, "lng": -90.5133,
         "hora_apertura": "08:00", "hora_cierre": "18:00", "tiempo_estancia_minutos": 30},
        {"id": "popol_vuh", "lat": 14.6066, "lng": -90.5059,
         "hora_apertura": "09:00", "hora_cierre": "17:00", "tiempo_estancia_minutos": 60},
        {"id": "mercado", "lat": 14.6420, "lng": -90.5116,
         "hora_apertura": "07:00", "hora_cierre": "18:00", "tiempo_estancia_minutos": 45},
    ]

    respuesta = api.post("/optimize", json={"paradas": paradas, "modo_transporte": modo})

    assert respuesta.status_code == 200, respuesta.text
    resultado = respuesta.json()
    # El mercado está junto a la plaza; conviene visitarlo antes de ir a la zona 10.
    assert resultado["orden_optimo"] == ["plaza", "mercado", "popol_vuh"]
    assert resultado["distancia_total_km"] > 4


def test_optimize_fuera_de_cobertura_responde_422(cliente):
    api = crear_cliente_api(cliente)
    paradas = [
        {"id": "plaza", "lat": 14.6425, "lng": -90.5133,
         "hora_apertura": "08:00", "hora_cierre": "18:00", "tiempo_estancia_minutos": 30},
        {"id": "oceano", "lat": 10.0, "lng": -95.0,
         "hora_apertura": "08:00", "hora_cierre": "18:00", "tiempo_estancia_minutos": 30},
    ]

    respuesta = api.post("/optimize", json={"paradas": paradas})

    assert respuesta.status_code == 422
