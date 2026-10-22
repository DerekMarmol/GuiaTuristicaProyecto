import Fastify from "fastify";
import { rutasGastos } from "../src/routes/gastos";
import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

async function probarRegistroGastos() {
  console.log("--- Probando Endpoint de Registro de Gastos (GUI-71) ---\n");

  const app = Fastify();
  await app.register(rutasGastos);
  await app.ready();

  // 1. Crear viaje temporal de prueba con presupuesto de Q1000
  const viajePrueba = await prisma.viaje.create({
    data: {
      destino: "Cobán, Alta Verapaz",
      tipoViaje: "amigos",
      lat: 15.4708,
      lng: -90.3708,
      presupuesto: 1000.0,
      transporte: "Automovil",
      intereses: ["naturaleza"],
      fechaInicio: new Date(),
      fechaFin: new Date(Date.now() + 86400000 * 2),
      hospedaje: false,
    },
  });

  try {
    console.log(`1. Viaje de prueba creado (ID: ${viajePrueba.id}, Presupuesto: Q${viajePrueba.presupuesto})`);

    // 2. Registrar primer gasto (Comida)
    console.log("2. Enviando POST para registrar gasto de comida (Q150)...");
    const resp1 = await app.inject({
      method: "POST",
      url: `/api/viajes/${viajePrueba.id}/gastos`,
      payload: {
        monto: 150.0,
        categoria: "comidas",
        descripcion: "Almuerzo típico en el mercado",
      },
    });

    console.log(`-> Respuesta status: ${resp1.statusCode}`);

    // 3. Registrar segundo gasto (Transporte)
    console.log("3. Enviando POST para registrar gasto de transporte (Q50)...");
    const resp2 = await app.inject({
      method: "POST",
      url: `/api/viajes/${viajePrueba.id}/gastos`,
      payload: {
        monto: 50.0,
        categoria: "transporte",
        descripcion: "Combustible",
      },
    });
    console.log(`-> Respuesta status: ${resp2.statusCode}`);

    // 4. Probar consulta GET de totales para el panel
    console.log("4. Consultando GET del resumen de gastos...");
    const respGet = await app.inject({
      method: "GET",
      url: `/api/viajes/${viajePrueba.id}/gastos`,
    });

    const resumen = JSON.parse(respGet.body);
    console.log(`-> Total gastado calculado: Q${resumen.totalGastado} (esperado: Q200)`);
    console.log(`-> Presupuesto restante: Q${resumen.presupuestoRestante} (esperado: Q800)`);

    const valido =
      resp1.statusCode === 201 &&
      resp2.statusCode === 201 &&
      resumen.totalGastado === 200.0 &&
      resumen.presupuestoRestante === 800.0;

    if (valido) {
      console.log("\n✅ Endpoint de registro de gastos verificado y funcionando correctamente.");
    } else {
      console.error("\n❌ Las operaciones de gastos no arrojaron los resultados esperados.");
    }
  } finally {
    // Limpiar el viaje de prueba (elimina gastos en cascada)
    await prisma.viaje.delete({ where: { id: viajePrueba.id } });
    await prisma.$disconnect();
    await app.close();
  }
}

probarRegistroGastos().catch((err) => {
  console.error("Error al ejecutar la prueba:", err);
  process.exit(1);
});