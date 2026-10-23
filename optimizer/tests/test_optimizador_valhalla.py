import pytest

from app.routers.optimize import calcular_matriz_tiempos, Parada
from app.services.valhalla import (
    FueraDeCobertura,
    RespuestaValhallaInvalida,
    RutaNoDisponible,
    TiempoEsperaValhalla,
    ValhallaNoDisponible,
)

from valhalla_falso import ClienteValhallaFalso, crear_cliente_api, crear_matriz


def parada(id, lat, lng, apertura="08:00", cierre="18:00", estancia=0, **extra):
    return {
        "id": id,
        "lat": lat,
        "lng": lng,
        "hora_apertura": apertura,
        "hora_cierre": cierre,
        "tiempo_estancia_minutos": estancia,
        **extra,
    }

INICIO = parada("inicio", 14.6000, -90.5000)
CERCA = parada("cerca", 14.6010, -90.5010)
LEJOS = parada("lejos", 14.7000, -90.6000)


def optimizar(cliente_valhalla, paradas, **extra):
    api = crear_cliente_api(cliente_valhalla)
    return api.post("/optimize", json={"paradas": paradas, **extra})


def test_usa_tiempos_de_valhalla_en_lugar_de_velocidad_fija():
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 3000, 300],
        [3000, 0, 600],
        [300, 600, 0],
    ])

    respuesta = optimizar(valhalla, [INICIO, CERCA, LEJOS])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["inicio", "lejos", "cerca"]


def test_matriz_de_or_tools_suma_estancia_del_origen_en_segundos():
    paradas = [
        Parada(**parada("a", 14.6, -90.5, estancia=30)),
        Parada(**parada("b", 14.7, -90.6, estancia=45)),
    ]
    matriz = crear_matriz([[0, 0.4], [125.2, 0]])

    tiempos = calcular_matriz_tiempos(paradas, matriz)

    assert tiempos == [[0, 30 * 60 + 1], [45 * 60 + 126, 0]]


def test_conserva_estancia_y_traslado_sin_duplicarlos():
    paradas = [
        parada("inicio", 14.6, -90.5, apertura="09:00", estancia=60),
        parada("museo", 14.7, -90.6, apertura="09:00", cierre="11:00", estancia=30),
    ]

    justo = optimizar(ClienteValhallaFalso(duraciones=[[0, 1800], [1800, 0]]), paradas)
    tarde = optimizar(ClienteValhallaFalso(duraciones=[[0, 1801], [1801, 0]]), paradas)

    assert justo.status_code == 200, justo.text
    assert justo.json()["orden_optimo"] == ["inicio", "museo"]
    assert tarde.status_code == 422


def test_horarios_consideran_el_traslado_de_valhalla():
    paradas = [
        parada("inicio", 14.6, -90.5, apertura="09:00", cierre="18:00"),
        parada("cierra_pronto", 14.61, -90.51, apertura="09:00", cierre="10:00", estancia=30),
        parada("abierto", 14.62, -90.52, apertura="09:00", cierre="18:00", estancia=60),
    ]
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 1200, 600],
        [1200, 0, 600],
        [600, 600, 0],
    ])

    respuesta = optimizar(valhalla, paradas)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["inicio", "cierra_pronto", "abierto"]


def test_no_selecciona_conexiones_inexistentes():
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, None, 1000],
        [1000, 0, 1000],
        [1000, 1000, 0],
    ])

    respuesta = optimizar(valhalla, [INICIO, CERCA, LEJOS])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["inicio", "lejos", "cerca"]


def test_no_selecciona_conexiones_inexistentes_al_priorizar_clima():
    lluvia_tarde = {
        "tipo_entorno": "exterior",
        "sensibilidad_clima": 1.0,
        "pronostico_horario": [
            {"hora": "08:00", "probabilidad_lluvia": 0},
            {"hora": "11:00", "probabilidad_lluvia": 100},
        ],
    }
    paradas = [
        parada("inicio", 14.6, -90.5),
        parada("parque", 14.61, -90.51, estancia=60, **lluvia_tarde),
        parada("museo", 14.62, -90.52, estancia=180, tipo_entorno="interior"),
    ]
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 300, 300],
        [300, 0, None],
        [300, 300, 0],
    ])

    respuesta = optimizar(valhalla, paradas)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["inicio", "museo", "parque"]


def test_sin_conexion_viable_responde_422():
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, None, 1000],
        [1000, 0, 1000],
        [1000, None, 0],
    ])

    respuesta = optimizar(valhalla, [INICIO, CERCA, LEJOS])

    assert respuesta.status_code == 422
    assert "rutas disponibles" in respuesta.json()["detail"]


def test_distancia_total_usa_los_tramos_seleccionados():
    valhalla = ClienteValhallaFalso(
        duraciones=[
            [0, 3000, 300],
            [3000, 0, 600],
            [300, 600, 0],
        ],
        distancias=[
            [0, 9000, 4250],
            [9100, 0, 1330],
            [4300, 1500, 0],
        ],
    )

    respuesta = optimizar(valhalla, [INICIO, CERCA, LEJOS])

    assert respuesta.json()["orden_optimo"] == ["inicio", "lejos", "cerca"]
    assert respuesta.json()["distancia_total_km"] == 5.75


def test_conserva_priorizacion_climatica():
    pronostico = [
        {"hora": "09:00", "probabilidad_lluvia": 80},
        {"hora": "12:00", "probabilidad_lluvia": 50},
    ]
    paradas = [
        parada("inicio", 14.6349, -90.5069, apertura="09:00"),
        parada("parque", 14.6350, -90.5070, apertura="09:00", estancia=60,
               tipo_entorno="exterior", sensibilidad_clima=1.0, pronostico_horario=pronostico),
        parada("museo", 14.6351, -90.5071, apertura="09:00", estancia=180,
               tipo_entorno="interior", sensibilidad_clima=0.0),
    ]

    respuesta = optimizar(ClienteValhallaFalso(), paradas)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["inicio", "museo", "parque"]


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
@pytest.mark.parametrize("endpoint, extra", [
    ("/optimize", {}),
    ("/reoptimize", {"hora_actual_minutos": 600}),
])
def test_transmite_el_medio_de_transporte(modo, endpoint, extra):
    valhalla = ClienteValhallaFalso()
    api = crear_cliente_api(valhalla)

    respuesta = api.post(endpoint, json={
        "paradas": [INICIO, CERCA, LEJOS],
        "modo_transporte": modo,
        **extra,
    })

    assert respuesta.status_code == 200, respuesta.text
    assert set(respuesta.json()) == {"orden_optimo", "distancia_total_km"}
    assert len(valhalla.llamadas) == 1
    coordenadas, modo_enviado = valhalla.llamadas[0]
    assert modo_enviado == modo
    assert [(c.lat, c.lon) for c in coordenadas] == [
        (14.6000, -90.5000), (14.6010, -90.5010), (14.7000, -90.6000)
    ]


@pytest.mark.parametrize("endpoint, extra", [
    ("/optimize", {}),
    ("/reoptimize", {"hora_actual_minutos": 600}),
])
def test_solicitudes_anteriores_usan_auto(endpoint, extra):
    valhalla = ClienteValhallaFalso()
    api = crear_cliente_api(valhalla)

    respuesta = api.post(endpoint, json={"paradas": [INICIO, CERCA], **extra})

    assert respuesta.status_code == 200, respuesta.text
    assert valhalla.llamadas[0][1] == "auto"


@pytest.mark.parametrize("modo", ["bicycle", "Auto", "a pie", "", None])
def test_rechaza_modos_no_admitidos(modo):
    valhalla = ClienteValhallaFalso()

    respuesta = optimizar(valhalla, [INICIO, CERCA], modo_transporte=modo)

    assert respuesta.status_code == 422
    assert "modo_transporte" in str(respuesta.json()["detail"])
    assert valhalla.llamadas == []


@pytest.mark.parametrize("lat, lng", [(91, -90.5), (14.6, -181)])
def test_rechaza_coordenadas_fuera_de_rango(lat, lng):
    valhalla = ClienteValhallaFalso()

    respuesta = optimizar(valhalla, [INICIO, parada("x", lat, lng)])

    assert respuesta.status_code == 422
    assert valhalla.llamadas == []


@pytest.mark.parametrize("error, estado", [
    (ValhallaNoDisponible("caído"), 503),
    (TiempoEsperaValhalla("lento"), 503),
    (FueraDeCobertura("fuera", 171), 422),
    (RutaNoDisponible("sin ruta", 442), 422),
    (RespuestaValhallaInvalida("rota"), 502),
])
def test_errores_de_valhalla_se_controlan(error, estado):
    respuesta = optimizar(ClienteValhallaFalso(error=error), [INICIO, CERCA])

    assert respuesta.status_code == estado
    assert isinstance(respuesta.json()["detail"], str)


def test_reoptimize_parte_de_la_hora_actual_con_tiempos_de_valhalla():
    paradas = [
        parada("actual", 14.6, -90.5, apertura="08:00", cierre="18:00"),
        parada("cierra", 14.61, -90.51, apertura="08:00", cierre="14:00", estancia=30),
    ]
    api_cerca = crear_cliente_api(ClienteValhallaFalso(duraciones=[[0, 600], [600, 0]]))
    api_lejos = crear_cliente_api(ClienteValhallaFalso(duraciones=[[0, 3600], [3600, 0]]))
    cuerpo = {"paradas": paradas, "hora_actual_minutos": 13 * 60, "modo_transporte": "pedestrian"}

    # 13:00 + 10 min llega a tiempo; 13:00 + 60 min ya no deja 30 min de visita.
    assert api_cerca.post("/reoptimize", json=cuerpo).status_code == 200
    assert api_lejos.post("/reoptimize", json=cuerpo).status_code == 422
