import { crearApp } from "../src/app";

async function probarExportacion() {
  console.log("--- Probando Endpoint GET /api/itinerarios/:id/exportar ---\n");

  const app = crearApp();
  await app.ready();

  const timestamp = Date.now();
  const usuario = {
    nombre: "Viajero Exportador",
    correo: `export_${timestamp}@test.com`,
    contrasena: "Password123!",
  };

  await app.inject({
    method: "POST",
    url: "/api/auth/registro",
    payload: usuario,
  });

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { correo: usuario.correo, contrasena: usuario.contrasena },
  });

  const token = loginRes.json()?.token;

  console.log("1. Probando exportar sin token...");
  const resSinAuth = await app.inject({
    method: "GET",
    url: "/api/itinerarios/id-demo/exportar",
  });
  console.log(`-> Status: ${resSinAuth.statusCode} (esperado: 401)`);

  console.log("\n2. Guardando plan base en la base de datos...");
  const planPayload = {
    destino: "Lago de Atitlán",
    tipoViaje: "amigos",
    lat: 14.73,
    lng: -91.2,
    presupuesto: 1500,
    transporte: "Automovil",
    intereses: ["naturaleza", "fotografia"],
    fechaInicio: new Date().toISOString(),
    fechaFin: new Date(Date.now() + 86400000 * 2).toISOString(),
    hospedaje: true,
    nombreHotel: "Hotel del Lago",
    dias: [
      {
        numeroDia: 1,
        fecha: new Date().toISOString(),
        paradas: [
          {
            nombre: "Mirador San Jorge",
            lat: 14.745,
            lng: -91.185,
            horaApertura: "07:00",
            horaCierre: "18:00",
            tiempoEstanciaMinutos: 45,
            restriccion: {
              tipoEntorno: "Al aire libre",
              sensibilidadClima: "alta",
            },
          },
          {
            nombre: "Panajachel Santander",
            lat: 14.741,
            lng: -91.155,
            horaApertura: "09:00",
            horaCierre: "21:00",
            tiempoEstanciaMinutos: 90,
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

  const planId = resGuardar.json()?.id;
  console.log(`-> Plan creado con ID: ${planId}`);

  console.log("\n3. Probando exportar plan con usuario autenticado...");
  const resExportar = await app.inject({
    method: "GET",
    url: `/api/itinerarios/${planId}/exportar`,
    headers: { authorization: `Bearer ${token}` },
  });

  console.log(`-> Status: ${resExportar.statusCode} (esperado: 200)`);

  const cabeceraDescarga = resExportar.headers["content-disposition"] || "";
  console.log(`-> Cabecera Content-Disposition: ${cabeceraDescarga}`);

  const datosExportados = resExportar.json();
  console.log("-> Destino en archivo:", datosExportados.viaje?.destino);
  console.log("-> Cantidad de días exportados:", datosExportados.viaje?.totalDias);
  console.log("-> Paradas día 1:", datosExportados.viaje?.dias?.[0]?.paradas?.length);
  console.log("-> Primera parada:", datosExportados.viaje?.dias?.[0]?.paradas?.[0]?.lugar);
  console.log("-> Notas generales incluidas:", datosExportados.viaje?.notasGenerales?.length > 0);

  if (resExportar.statusCode === 200 && String(cabeceraDescarga).includes("attachment")) {
    console.log("\n✅ Criterios de aceptación del backend comprobados con éxito.");
  } else {
    console.error("\n❌ No cumplió con la cabecera de descarga o el formato esperado.");
  }

  await app.close();
}

probarExportacion().catch((err) => {
  console.error("Error al ejecutar la prueba de exportación:", err);
  process.exit(1);
});