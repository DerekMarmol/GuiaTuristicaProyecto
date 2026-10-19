import json

import httpx
import pytest

from app.services.valhalla import (
    ClienteValhalla,
    Coordenada,
    DatosRutaInvalidos,
    FueraDeCobertura,
    RespuestaValhallaInvalida,
    RutaNoDisponible,
    SolicitudRechazadaValhalla,
    TiempoEsperaValhalla,
    Traslado,
    ValhallaNoDisponible,
)

from valhalla_falso import crear_cliente_http_simulado as crear_cliente, error_valhalla


ORIGEN = Coordenada(lat=14.6425, lon=-90.5133)
DESTINO = Coordenada(lat=14.6066, lon=-90.5059)


def respuesta_ruta(tiempo, longitud, unidades="kilometers"):
    return httpx.Response(200, json={
        "trip": {
            "status": 0,
            "units": unidades,
            "summary": {"time": tiempo, "length": longitud},
        }
    })


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_ruta_envia_coordenadas_y_modo(modo):
    cliente, solicitudes = crear_cliente(lambda _: respuesta_ruta(600.5, 7.25))

    traslado = cliente.ruta(ORIGEN, DESTINO, modo)

    assert traslado == Traslado(duracion_segundos=600.5, distancia_metros=7250.0)
    assert solicitudes[0].method == "POST"
    assert solicitudes[0].url.path == "/route"
    cuerpo = json.loads(solicitudes[0].content)
    assert cuerpo["costing"] == modo
    assert cuerpo["units"] == "kilometers"
    assert cuerpo["locations"] == [
        {"lat": 14.6425, "lon": -90.5133},
        {"lat": 14.6066, "lon": -90.5059},
    ]


def test_ruta_convierte_millas_a_metros():
    cliente, _ = crear_cliente(lambda _: respuesta_ruta(60, 1, "miles"))

    assert cliente.ruta(ORIGEN, DESTINO, "auto").distancia_metros == pytest.approx(1609.344)


def test_ruta_inexistente():
    cliente, _ = crear_cliente(
        lambda _: error_valhalla(400, 442, "No path could be found for input")
    )

    with pytest.raises(RutaNoDisponible) as error:
        cliente.ruta(ORIGEN, DESTINO, "pedestrian")

    assert error.value.codigo_valhalla == 442
    assert not isinstance(error.value, FueraDeCobertura)


def test_coordenada_fuera_de_cobertura():
    cliente, _ = crear_cliente(
        lambda _: error_valhalla(400, 171, "No suitable edges near location")
    )

    with pytest.raises(FueraDeCobertura):
        cliente.ruta(ORIGEN, Coordenada(lat=10.0, lon=-95.0), "auto")


def test_error_interno_de_valhalla():
    cliente, _ = crear_cliente(lambda _: httpx.Response(500, text="fallo"))

    with pytest.raises(ValhallaNoDisponible):
        cliente.ruta(ORIGEN, DESTINO, "auto")


def test_solicitud_rechazada_por_otro_motivo():
    cliente, _ = crear_cliente(
        lambda _: error_valhalla(400, 150, "Exceeded max locations")
    )

    with pytest.raises(SolicitudRechazadaValhalla):
        cliente.ruta(ORIGEN, DESTINO, "auto")


def test_tiempo_de_espera_agotado():
    def manejador(solicitud):
        raise httpx.ReadTimeout("lento", request=solicitud)

    cliente, _ = crear_cliente(manejador)

    with pytest.raises(TiempoEsperaValhalla):
        cliente.ruta(ORIGEN, DESTINO, "auto")


def test_servicio_no_disponible():
    def manejador(solicitud):
        raise httpx.ConnectError("conexión rechazada", request=solicitud)

    cliente, _ = crear_cliente(manejador)

    with pytest.raises(ValhallaNoDisponible) as error:
        cliente.ruta(ORIGEN, DESTINO, "auto")

    assert not isinstance(error.value, TiempoEsperaValhalla)


@pytest.mark.parametrize("respuesta", [
    httpx.Response(200, content=b"<html>no es json</html>"),
    httpx.Response(200, json=[1, 2, 3]),
    httpx.Response(200, json={"trip": {}}),
    httpx.Response(200, json={"trip": {"summary": {"time": "10", "length": 1}}}),
    httpx.Response(200, json={"trip": {"summary": {"time": -5, "length": 1}}}),
    httpx.Response(200, json={"trip": {"summary": {"time": 5}}}),
    httpx.Response(200, content=b'{"trip": {"summary": {"time": NaN, "length": 1}}}'),
    httpx.Response(200, json={"trip": {"units": "leguas", "summary": {"time": 5, "length": 1}}}),
])
def test_respuesta_malformada(respuesta):
    cliente, _ = crear_cliente(lambda _: respuesta)

    with pytest.raises(RespuestaValhallaInvalida):
        cliente.ruta(ORIGEN, DESTINO, "auto")


@pytest.mark.parametrize("modo", ["bicycle", "Auto", "", None, "multimodal"])
def test_modo_no_admitido_no_consulta_valhalla(modo):
    cliente, solicitudes = crear_cliente(lambda _: respuesta_ruta(1, 1))

    with pytest.raises(DatosRutaInvalidos):
        cliente.ruta(ORIGEN, DESTINO, modo)

    assert solicitudes == []


@pytest.mark.parametrize("lat, lon", [
    (90.1, 0),
    (-91, 0),
    (0, 180.5),
    (0, -181),
    (float("nan"), 0),
    (0, float("inf")),
    (True, 0),
    ("14.6", -90.5),
])
def test_coordenadas_invalidas(lat, lon):
    with pytest.raises(DatosRutaInvalidos):
        Coordenada(lat=lat, lon=lon)


@pytest.mark.parametrize("url, espera", [("", 5), ("http://valhalla.test", 0)])
def test_configuracion_invalida(url, espera):
    with pytest.raises(ValueError):
        ClienteValhalla(url, espera)
