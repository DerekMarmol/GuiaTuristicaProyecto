import { crearApp } from "../src/app";

async function ejecutarPruebas() {
  console.log("Iniciando pruebas de autenticación con TypeScript...\n");

  const app = crearApp();
  await app.ready();

  const usuarioPrueba = {
    nombre: "Usuario TS Test",
    correo: `test_${Date.now()}@test.com`,
    contrasena: "Password123!",
  };

  // 1. Registro
  console.log("1. Probando POST /api/auth/registro...");
  const resRegistro = await app.inject({
    method: "POST",
    url: "/api/auth/registro",
    payload: usuarioPrueba,
  });

  console.log(`Estado: ${resRegistro.statusCode}`);
  console.log("Cuerpo:", resRegistro.json());
  if (resRegistro.statusCode !== 201) {
    console.error("❌ Falló el registro");
    process.exit(1);
  }

  // 2. Login
  console.log("\n2. Probando POST /api/auth/login...");
  const resLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      correo: usuarioPrueba.correo,
      contrasena: usuarioPrueba.contrasena,
    },
  });

  console.log(`Estado: ${resLogin.statusCode}`);
  const datosLogin = resLogin.json();
  const token = datosLogin.token;

  // 3. Ruta Protegida SIN Token (Esperado: 401)
  console.log("\n3. Probando GET /api/auth/verificar SIN token...");
  const resSinToken = await app.inject({
    method: "GET",
    url: "/api/auth/verificar",
  });
  console.log(`Estado: ${resSinToken.statusCode} (debe ser 401)`);

  // 4. Ruta Protegida CON Token (Esperado: 200)
  console.log("\n4. Probando GET /api/auth/verificar CON Bearer token...");
  const resConToken = await app.inject({
    method: "GET",
    url: "/api/auth/verificar",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  console.log(`Estado: ${resConToken.statusCode} (debe ser 200)`);
  console.log("Usuario autenticado:", resConToken.json());

  console.log("\n Pruebas completadas con éxito.");
  await app.close();
}

ejecutarPruebas().catch((err) => {
  console.error("Error durante las pruebas:", err);
  process.exit(1);
});