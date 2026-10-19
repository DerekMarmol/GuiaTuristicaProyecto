import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.optimize import router
from app.services.valhalla import (
    ClienteValhalla,
    MatrizTraslados,
    obtener_cliente_valhalla,
)


def crear_cliente_http_simulado(manejador):
    """ClienteValhalla real sobre un transporte simulado que registra las solicitudes."""
    solicitudes = []

    def registrar(solicitud):
        solicitudes.append(solicitud)
        return manejador(solicitud)

    http = httpx.Client(
        base_url="http://valhalla.test",
        transport=httpx.MockTransport(registrar),
    )
    return ClienteValhalla("http://valhalla.test", 5, cliente_http=http), solicitudes


def error_valhalla(estado, codigo, mensaje):
    return httpx.Response(estado, json={
        "error_code": codigo,
        "error": mensaje,
        "status_code": estado,
    })


def crear_matriz(duraciones, distancias=None, modo="auto") -> MatrizTraslados:
    """Matriz controlada; si no hay distancias, se asumen 10 m por segundo."""
    if distancias is None:
        distancias = [
            [None if d is None else d * 10 for d in fila]
            for fila in duraciones
        ]

    return MatrizTraslados(
        modo=modo,
        duraciones_segundos=tuple(tuple(fila) for fila in duraciones),
        distancias_metros=tuple(tuple(fila) for fila in distancias),
    )


def matriz_uniforme(n, segundos=60.0, metros=500.0, modo="auto") -> MatrizTraslados:
    return crear_matriz(
        [[0.0 if i == j else segundos for j in range(n)] for i in range(n)],
        [[0.0 if i == j else metros for j in range(n)] for i in range(n)],
        modo,
    )


class ClienteValhallaFalso:
    """Sustituye a ClienteValhalla y registra cada consulta de matriz."""

    def __init__(self, duraciones=None, distancias=None, error=None):
        self.duraciones = duraciones
        self.distancias = distancias
        self.error = error
        self.llamadas = []

    def matriz(self, coordenadas, modo):
        self.llamadas.append((list(coordenadas), modo))

        if self.error is not None:
            raise self.error

        if self.duraciones is None:
            return matriz_uniforme(len(coordenadas), modo=modo)

        return crear_matriz(self.duraciones, self.distancias, modo)


def crear_cliente_api(cliente_valhalla) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[obtener_cliente_valhalla] = lambda: cliente_valhalla
    return TestClient(app)
