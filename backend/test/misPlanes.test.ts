import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { crearApp } from "../src/app";

async function crearUsuario(app: FastifyInstance, nombre: string): Promise<string> {
  const correo = `${nombre}_${Date.now()}_${Math.round(Math.random() * 1e6)}@prueba.com`;
  const contrasena = "Password123!";
  await app.inject({ method: "POST", url: "/api/auth/registro", payload: { nombre, correo, contrasena } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { correo, contrasena } });
  return login.json().token;
}

const plan = (destino: string) => ({
  destino,
  tipoViaje: "solo",
  lat: 14.6344,
  lng: -89.9898,
  presupuesto: 500,
  transporte: "Moto",
  intereses: ["Compras"],
  fechaInicio: "2026-10-23",
  fechaFin: "2026-10-23",
  hospedaje: false,
  dias: [
    {
      numeroDia: 1,
      fecha: "2026-10-23",
      paradas: ["Plaza San Francisco", "Mercado Municipal", "Casa Real", "Tienda de recuerdos"].map((nombre, i) => ({
        nombre,
        lat: 14.63 + i / 1000,
        lng: -89.99,
        horaApertura: "09:00",
        horaCierre: "19:00",
        tiempoEstanciaMinutos: 60,
        restriccion: { tipoEntorno: "Bajo Techo", sensibilidadClima: "baja" },
      })),
    },
  ],
});

describe("planes guardados del usuario (GUI-114)", () => {
  let app: FastifyInstance;
  let tokenAna: string;
  let tokenBeto: string;
  let idPlan: string;

  before(async () => {
    app = crearApp();
    await app.ready();
    tokenAna = await crearUsuario(app, "ana");
    tokenBeto = await crearUsuario(app, "beto");
    const guardado = await app.inject({
      method: "POST",
      url: "/api/itinerarios/guardar",
      headers: { authorization: `Bearer ${tokenAna}` },
      payload: plan("Jalapa"),
    });
    assert.equal(guardado.statusCode, 201);
    idPlan = guardado.json().id;
  });

  after(() => app.close());

  test("lista los planes del usuario con su resumen", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/api/itinerarios/mis-planes", headers: { authorization: `Bearer ${tokenAna}` } });

    assert.equal(respuesta.statusCode, 200);
    const [primero] = respuesta.json().planes;
    assert.equal(primero.id, idPlan);
    assert.equal(primero.destino, "Jalapa");
    assert.equal(primero.totalDias, 1);
    assert.equal(primero.totalParadas, 4);
  });

  test("devuelve el plan completo con las paradas en el orden en que se guardaron", async () => {
    const respuesta = await app.inject({ method: "GET", url: `/api/itinerarios/${idPlan}`, headers: { authorization: `Bearer ${tokenAna}` } });

    assert.equal(respuesta.statusCode, 200);
    const nombres = respuesta.json().plan.itinerarios[0].paradas.map((p: { nombre: string }) => p.nombre);
    assert.deepEqual(nombres, ["Plaza San Francisco", "Mercado Municipal", "Casa Real", "Tienda de recuerdos"]);
  });

  test("otro usuario no puede ver, listar ni exportar el plan", async () => {
    const lista = await app.inject({ method: "GET", url: "/api/itinerarios/mis-planes", headers: { authorization: `Bearer ${tokenBeto}` } });
    assert.deepEqual(lista.json().planes, []);

    const ver = await app.inject({ method: "GET", url: `/api/itinerarios/${idPlan}`, headers: { authorization: `Bearer ${tokenBeto}` } });
    assert.equal(ver.statusCode, 404);

    const exportar = await app.inject({ method: "GET", url: `/api/itinerarios/${idPlan}/exportar`, headers: { authorization: `Bearer ${tokenBeto}` } });
    assert.equal(exportar.statusCode, 404);
  });

  test("sin sesión responde 401", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/api/itinerarios/mis-planes" });
    assert.equal(respuesta.statusCode, 401);
  });
});
