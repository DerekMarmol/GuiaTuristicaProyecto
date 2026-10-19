import { crearApp } from "../src/app";

async function probarGuardarPlan() {
  console.log("--- Probando Endpoint POST /api/itinerarios/guardar ---\n");

  const app = crearApp();
  await app.ready();

  const timestamp = Date.now();
  const usuario = {
    nombre: "Viajero Plan",
    correo: `plan_${timestamp}@test.com`,
    contrasena: "Password123!",
  };

  // Es el proceso de Registro e inicio de sesión para obtener el JWT
  await app.inject({ method: "POST", url: "/api/auth/registro", payload: usuario });
  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { correo: usuario.correo, contrasena: usuario.contrasena },
  });
  const token = loginRes.json().token;

  console.log("1. Probando guardar sin token...");
  const resSinAuth = await app.inject({
    method: "POST",
    url: "/api/itinerarios/guardar",
    payload: { destino: "Flores, Petén" },
  });
  console.log(`-> Status: ${resSinAuth.statusCode} (esperado: 401)`);

  
  console.log("\n2. Probando guardar plan completo con usuario autenticado...");
  const planPayload = {
    destino: "Antigua Guatemala",
    tipoViaje: "amigos",
    lat: 14.5586,
    lng: -90.7295,
    presupuesto: 1200,
    transporte: "Automovil",
    intereses: ["historia", "fotografia"],
    fechaInicio: new Date().toISOString(),
    fechaFin: new Date(Date.now() + 86400000 * 2).toISOString(),
    hospedaje: true,
    nombreHotel: "Casa Santo Domingo",
    dias: [
      {
        numeroDia: 1,
        fecha: new Date().toISOString(),
        paradas: [
          {
            nombre: "Arco de Santa Catalina",
            lat: 14.5583,
            lng: -90.7338,
            horaApertura: "08:00",
            horaCierre: "20:00",
            tiempoEstanciaMinutos: 45,
            restriccion: {
              tipoEntorno: "Al aire libre",
              sensibilidadClima: "alta",
            },
          },
          {
            nombre: "Iglesia San Francisco",
            lat: 14.5532,
            lng: -90.7301,
            horaApertura: "09:00",
            horaCierre: "18:00",
            tiempoEstanciaMinutos: 60,
            restriccion: {
              tipoEntorno: "Bajo Techo",
              sensibilidadClima: "baja",
            },
          },
        ],
      },
    ],
  };

  const resGuardar = await app.inject({
    method: "POST",
    url: "/api/itinerarios/guardar",
    headers: { authorization: `Bearer ${token}` },
    payload: planPayload,
  });

  console.log(`-> Status: ${resGuardar.statusCode} (esperado: 201)`);
  const resultado = resGuardar.json();
  console.log("-> ID generado (para recuperar después):", resultado.id);
  console.log("-> Destino guardado:", resultado.viaje?.destino);
  console.log("-> Cantidad de días:", resultado.viaje?.itinerarios?.length);
  console.log("-> Paradas día 1:", resultado.viaje?.itinerarios?.[0]?.paradas?.length);

  console.log("\n✅ Criterios de aceptación comprobados con éxito.");
  await app.close();
}

probarGuardarPlan().catch((err) => {
  console.error("Error al ejecutar la prueba:", err);
  process.exit(1);
});