import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import optimize, reoptimizacion_clima
from app.services.valhalla import (
    FueraDeCobertura,
    TiempoEsperaValhalla,
    ValhallaNoDisponible,
    obtener_cliente_valhalla,
)

from valhalla_falso import ClienteValhallaFalso


def crear_api(valhalla) -> TestClient:
    app = FastAPI()
    app.include_router(optimize.router)
    app.include_router(reoptimizacion_clima.router)
    app.dependency_overrides[obtener_cliente_valhalla] = lambda: valhalla
    return TestClient(app)


def parada(id, lat=14.6, lng=-90.5, apertura="08:00", cierre="18:00", estancia=30, **extra):
    return {
        "id": id,
        "lat": lat,
        "lng": lng,
        "hora_apertura": apertura,
        "hora_cierre": cierre,
        "tiempo_estancia_minutos": estancia,
        **extra,
    }


ORIGEN = {"lat": 14.55, "lng": -90.73}

def test_reoptimize_con_origen_no_fuerza_la_primera_parada_pendiente():
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 1800, 120],
        [1800, 0, 600],
        [120, 600, 0],
    ])
    api = crear_api(valhalla)

    respuesta = api.post("/reoptimize", json={
        "paradas": [parada("a"), parada("b")],
        "hora_actual_minutos": 600,
        "origen": ORIGEN,
    })

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"] == ["b", "a"]
    coordenadas, _ = valhalla.llamadas[0]
    assert (coordenadas[0].lat, coordenadas[0].lon) == (ORIGEN["lat"], ORIGEN["lng"])


def test_reoptimize_con_origen_suma_el_tramo_inicial_y_no_lo_devuelve():
    valhalla = ClienteValhallaFalso(
        duraciones=[[0, 300, 900], [300, 0, 600], [900, 600, 0]],
        distancias=[[0, 2000, 7000], [2000, 0, 3000], [7000, 3000, 0]],
    )

    respuesta = crear_api(valhalla).post("/reoptimize", json={
        "paradas": [parada("a"), parada("b")],
        "hora_actual_minutos": 600,
        "origen": ORIGEN,
    })

    cuerpo = respuesta.json()
    assert cuerpo["orden_optimo"] == ["a", "b"]
    assert "__origen__" not in cuerpo["orden_optimo"]
    assert cuerpo["distancia_total_km"] == 5.0


def test_reoptimize_con_origen_considera_el_traslado_desde_la_hora_actual():
    paradas = [parada("cierra", apertura="08:00", cierre="14:00", estancia=30)]
    cuerpo = {"paradas": paradas, "hora_actual_minutos": 13 * 60, "origen": ORIGEN}

    cerca = crear_api(ClienteValhallaFalso(duraciones=[[0, 600], [600, 0]])).post("/reoptimize", json=cuerpo)
    lejos = crear_api(ClienteValhallaFalso(duraciones=[[0, 3600], [3600, 0]])).post("/reoptimize", json=cuerpo)

    assert cerca.status_code == 200, cerca.text
    assert lejos.status_code == 422


def test_reoptimize_sin_origen_conserva_el_contrato_anterior():
    valhalla = ClienteValhallaFalso()
    respuesta = crear_api(valhalla).post("/reoptimize", json={
        "paradas": [parada("a"), parada("b")],
        "hora_actual_minutos": 600,
    })

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["orden_optimo"][0] == "a"
    assert len(valhalla.llamadas[0][0]) == 2


def test_reoptimize_rechaza_el_identificador_reservado_del_origen():
    respuesta = crear_api(ClienteValhallaFalso()).post("/reoptimize", json={
        "paradas": [parada("__origen__")],
        "hora_actual_minutos": 600,
        "origen": ORIGEN,
    })

    assert respuesta.status_code == 422

def clima(paradas, sustituciones, origen=ORIGEN, hora=600, **extra):
    return {
        "paradas": paradas,
        "hora_actual_minutos": hora,
        "origen": origen,
        "sustituciones": sustituciones,
        **extra,
    }

def test_sustituye_la_parada_afectada_por_el_candidato_mas_cercano():
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 600, 600, 1500, 300],
        [600, 0, 600, 1500, 300],
        [600, 600, 0, 1500, 300],
        [1500, 1500, 1500, 0, 1500],
        [300, 300, 300, 1500, 0],
    ])
    cuerpo = clima(
        [parada("parque", estancia=60), parada("catedral", estancia=45)],
        [{"parada_id": "parque", "candidatos": [parada("museo_lejano", estancia=60), parada("museo_cerca", estancia=60)]}],
    )

    respuesta = crear_api(valhalla).post("/reoptimize-clima", json=cuerpo)

    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    assert datos["sustituciones"] == [{"parada_id": "parque", "alternativa_id": "museo_cerca"}]
    assert set(datos["ruta_propuesta"]["orden"]) == {"museo_cerca", "catedral"}
    assert "parque" not in datos["ruta_propuesta"]["orden"]
    assert datos["ruta_actual"]["orden"] == ["parque", "catedral"]
    assert len(valhalla.llamadas) == 1
    assert len(valhalla.llamadas[0][0]) == 5


def test_las_visitas_empiezan_en_la_hora_actual_e_incluyen_traslado_y_estancia():
    valhalla = ClienteValhallaFalso(
        duraciones=[[0, 300, 1500], [300, 0, 300], [1500, 300, 0]],
        distancias=[[0, 4000, 6000], [4000, 0, 1500], [6000, 1500, 0]],
    )
    cuerpo = clima([parada("parque", estancia=60), parada("catedral", estancia=45)], [], hora=10 * 60)

    datos = crear_api(valhalla).post("/reoptimize-clima", json=cuerpo).json()

    visitas = datos["ruta_propuesta"]["visitas"]
    assert [v["parada_id"] for v in visitas] == ["parque", "catedral"]
    assert (visitas[0]["inicio_minutos"], visitas[0]["fin_minutos"]) == (605, 665)
    assert (visitas[1]["inicio_minutos"], visitas[1]["fin_minutos"]) == (670, 715)
    assert visitas[0]["traslado_segundos"] == 300
    assert datos["ruta_propuesta"]["distancia_total_km"] == 5.5
    assert datos["ruta_propuesta"]["duracion_traslado_minutos"] == 10


def test_descarta_el_candidato_que_cierra_antes_de_poder_visitarlo():
    valhalla = ClienteValhallaFalso()
    cuerpo = clima(
        [parada("parque", estancia=60)],
        [{"parada_id": "parque", "candidatos": [
            parada("museo_cierra", apertura="08:00", cierre="10:30", estancia=60),
            parada("museo_abierto", apertura="08:00", cierre="18:00", estancia=60),
        ]}],
        hora=10 * 60,
    )

    datos = crear_api(valhalla).post("/reoptimize-clima", json=cuerpo).json()

    assert datos["sustituciones"] == [{"parada_id": "parque", "alternativa_id": "museo_abierto"}]


def test_sin_alternativa_viable_conserva_la_parada_original():
    cuerpo = clima(
        [parada("parque", estancia=60)],
        [{"parada_id": "parque", "candidatos": [parada("museo_cierra", cierre="10:30", estancia=60)]}],
        hora=10 * 60,
    )

    datos = crear_api(ClienteValhallaFalso()).post("/reoptimize-clima", json=cuerpo).json()

    assert datos["sustituciones"] == []
    assert datos["sin_sustitucion"] == [{"parada_id": "parque", "motivo": "sin_alternativa_viable"}]
    assert datos["ruta_propuesta"]["orden"] == ["parque"]


def test_no_usa_el_mismo_lugar_para_sustituir_dos_paradas():
    compartido = parada("museo", estancia=30)
    cuerpo = clima(
        [parada("parque", estancia=30), parada("mirador", estancia=30)],
        [
            {"parada_id": "parque", "candidatos": [compartido]},
            {"parada_id": "mirador", "candidatos": [compartido, parada("galeria", estancia=30)]},
        ],
    )

    valhalla = ClienteValhallaFalso()
    datos = crear_api(valhalla).post("/reoptimize-clima", json=cuerpo).json()

    assert datos["sustituciones"] == [
        {"parada_id": "parque", "alternativa_id": "museo"},
        {"parada_id": "mirador", "alternativa_id": "galeria"},
    ]
    assert len(set(datos["ruta_propuesta"]["orden"])) == 2
    # origen, 2 pendientes y 2 candidatos únicos.
    assert len(valhalla.llamadas[0][0]) == 5


def test_grupo_sin_candidatos_se_informa_y_la_parada_se_conserva():
    datos = crear_api(ClienteValhallaFalso()).post("/reoptimize-clima", json=clima(
        [parada("parque")], [{"parada_id": "parque", "candidatos": []}],
    )).json()

    assert datos["sin_sustitucion"] == [{"parada_id": "parque", "motivo": "sin_candidatos"}]
    assert datos["ruta_propuesta"]["orden"] == ["parque"]


def test_no_elige_un_candidato_sin_conexion_en_valhalla():
    # Nodos: origen, parque, museo_aislado, museo_conectado.
    valhalla = ClienteValhallaFalso(duraciones=[
        [0, 600, None, 900],
        [600, 0, None, 600],
        [None, None, 0, None],
        [900, 600, None, 0],
    ])
    datos = crear_api(valhalla).post("/reoptimize-clima", json=clima(
        [parada("parque")],
        [{"parada_id": "parque", "candidatos": [parada("museo_aislado"), parada("museo_conectado")]}],
    )).json()

    assert datos["sustituciones"] == [{"parada_id": "parque", "alternativa_id": "museo_conectado"}]


def test_sin_solucion_completa_no_declara_una_ruta_viable():
    cuerpo = clima([parada("cerrado", apertura="08:00", cierre="09:00", estancia=30)], [], hora=10 * 60)

    respuesta = crear_api(ClienteValhallaFalso()).post("/reoptimize-clima", json=cuerpo)

    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    assert datos["ruta_propuesta"] is None
    assert datos["motivo_sin_ruta"]
    assert datos["ruta_actual"]["viable"] is False


def test_sin_origen_la_primera_pendiente_es_el_punto_de_partida():
    valhalla = ClienteValhallaFalso()
    datos = crear_api(valhalla).post("/reoptimize-clima", json=clima(
        [parada("a"), parada("b")], [], origen=None,
    )).json()

    assert datos["ruta_propuesta"]["orden"][0] == "a"
    assert datos["ruta_propuesta"]["visitas"][0]["traslado_segundos"] == 0
    assert len(valhalla.llamadas[0][0]) == 2


@pytest.mark.parametrize("modo", ["auto", "pedestrian"])
def test_transmite_el_medio_de_transporte(modo):
    valhalla = ClienteValhallaFalso()

    respuesta = crear_api(valhalla).post("/reoptimize-clima", json=clima([parada("a")], [], modo_transporte=modo))

    assert respuesta.status_code == 200, respuesta.text
    assert valhalla.llamadas[0][1] == modo


@pytest.mark.parametrize("error, estado", [
    (ValhallaNoDisponible("caído"), 503),
    (TiempoEsperaValhalla("lento"), 503),
    (FueraDeCobertura("fuera", 171), 422),
])
def test_errores_de_valhalla_no_se_reemplazan_por_tiempos_ficticios(error, estado):
    respuesta = crear_api(ClienteValhallaFalso(error=error)).post(
        "/reoptimize-clima", json=clima([parada("a")], [{"parada_id": "a", "candidatos": [parada("m")]}])
    )

    assert respuesta.status_code == estado


@pytest.mark.parametrize("sustituciones", [
    [{"parada_id": "no_existe", "candidatos": []}],
    [{"parada_id": "a", "candidatos": []}, {"parada_id": "a", "candidatos": []}],
    [{"parada_id": "a", "candidatos": [parada("b")]}],
    [{"parada_id": "a", "candidatos": [parada(f"m{i}") for i in range(6)]}],
    [{"parada_id": "a", "candidatos": [parada("__origen__")]}],
])
def test_rechaza_grupos_invalidos_sin_consultar_valhalla(sustituciones):
    valhalla = ClienteValhallaFalso()

    respuesta = crear_api(valhalla).post("/reoptimize-clima", json=clima([parada("a"), parada("b")], sustituciones))

    assert respuesta.status_code == 422
    assert valhalla.llamadas == []
