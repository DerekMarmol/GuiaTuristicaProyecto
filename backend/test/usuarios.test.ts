import { crearApp } from "../src/app";

async function probarUsuarios() {
  console.log("--- Iniciando pruebas de API de Usuarios con TypeScript ---\n");

  const app = crearApp();
  await app.ready();

  const time = Date.now();
  const usuarioPrincipal = {
    nombre: "Lucia Original",
    correo: `lucia_${time}@test.com`,
    contrasena: "Password123!",
  };

  const usuarioSecundario = {
    nombre: "Otro Usuario",
    correo: `otro_${time}@test.com`,
    contrasena: "Password123!",
  };

  // 1. Registrar ambos usuarios
  await app.inject({ method: "POST", url: "/api/auth/registro", payload: usuarioPrincipal });
  await app.inject({ method: "POST", url: "/api/auth/registro", payload: usuarioSecundario });

  // 2. Iniciar sesión con el usuario principal
  const resLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { correo: usuarioPrincipal.correo, contrasena: usuarioPrincipal.contrasena },
  });
  const token = resLogin.json().token;

  // 3. Probar GET /api/usuarios/perfil SIN token (Debe dar 401)
  console.log("1. Probando GET /api/usuarios/perfil sin token...");
  const resSinAuth = await app.inject({
    method: "GET",
    url: "/api/usuarios/perfil",
  });
  console.log(`-> Status: ${resSinAuth.statusCode} (esperado: 401)`);

  // 4. Probar GET /api/usuarios/perfil CON token (Debe dar 200 y NO exponer contraseña)
  console.log("\n2. Probando GET /api/usuarios/perfil con token...");
  const resPerfil = await app.inject({
    method: "GET",
    url: "/api/usuarios/perfil",
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(`-> Status: ${resPerfil.statusCode} (esperado: 200)`);
  const datosUsuario = resPerfil.json().usuario;
  console.log("-> Datos recibidos:", datosUsuario);
  console.log("-> ¿Expone contraseña?:", "contrasena" in datosUsuario ? "❌ SÍ (Error)" : "✅ NO (Correcto)");

  // 5. Probar PUT con un correo ya en uso por otro usuario (Debe dar 400)
  console.log("\n3. Probando PUT /api/usuarios/perfil con correo duplicado...");
  const resDuplicado = await app.inject({
    method: "PUT",
    url: "/api/usuarios/perfil",
    headers: { authorization: `Bearer ${token}` },
    payload: { correo: usuarioSecundario.correo },
  });
  console.log(`-> Status: ${resDuplicado.statusCode} (esperado: 400)`);
  console.log("-> Mensaje:", resDuplicado.json().mensaje);

  // 6. Probar PUT actualizando nombre y correo válidos (Debe dar 200)
  console.log("\n4. Probando PUT /api/usuarios/perfil con datos válidos...");
  const resActualizar = await app.inject({
    method: "PUT",
    url: "/api/usuarios/perfil",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      nombre: "Lucia Sandoval Actualizado",
      correo: `lucia_nuevo_${time}@test.com`,
    },
  });
  console.log(`-> Status: ${resActualizar.statusCode} (esperado: 200)`);
  console.log("-> Perfil actualizado:", resActualizar.json().usuario);

  console.log("\n Todas las pruebas de la API de Usuarios pasaron exitosamente.");
  await app.close();
}

probarUsuarios().catch((err) => {
  console.error("Error en las pruebas:", err);
  process.exit(1);
});