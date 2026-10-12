const { CATEGORIAS_PERMITIDAS } = require("../config/categorias");
const { CATEGORIAS_POR_INTERES, INTERESES_PERMITIDOS } = require("../config/intereses");
const { ErrorApi } = require("../errores");

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ENTERO = /^\d+$/;

function leerTexto(query, nombre, obligatorio, errores) {
  const valor = query[nombre];

  if (valor === undefined) {
    if (obligatorio) {
      errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} es obligatorio.` });
    }
    return null;
  }

  if (typeof valor !== "string") {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe enviarse una sola vez como valor simple.` });
    return null;
  }

  if (valor === "") {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} no puede estar vacío.` });
    return null;
  }

  return valor;
}

function validarDecimal(query, nombre, minimo, maximo, errores) {
  const texto = leerTexto(query, nombre, true, errores);
  if (texto === null) {
    return null;
  }

  const numero = Number(texto);
  if (!DECIMAL.test(texto) || !Number.isFinite(numero)) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe ser un número decimal válido.` });
    return null;
  }

  if (numero < minimo || numero > maximo) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe estar entre ${minimo} y ${maximo}.` });
    return null;
  }

  return numero;
}

function validarEntero(query, nombre, minimo, maximo, predeterminado, errores) {
  if (query[nombre] === undefined) {
    return predeterminado;
  }

  const texto = leerTexto(query, nombre, false, errores);
  if (texto === null) {
    return null;
  }

  const numero = Number(texto);
  if (!ENTERO.test(texto) || !Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe ser un número entero entre ${minimo} y ${maximo}.` });
    return null;
  }

  return numero;
}

function normalizarInteres(texto) {
  return texto.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const INTERES_POR_CLAVE = new Map(INTERESES_PERMITIDOS.map((interes) => [normalizarInteres(interes), interes]));

function validarCategoria(query, errores) {
  const texto = leerTexto(query, "categoria", false, errores);
  if (texto === null) {
    return null;
  }

  if (!CATEGORIAS_PERMITIDAS.includes(texto)) {
    errores.push({
      parametro: "categoria",
      mensaje: `La categoría no es admitida. Valores permitidos: ${CATEGORIAS_PERMITIDAS.join(", ")}.`,
    });
    return null;
  }

  return texto;
}

function validarIntereses(query, errores) {
  const texto = leerTexto(query, "intereses", false, errores);
  if (texto === null) {
    return null;
  }

  const elementos = texto.split(",").map((elemento) => elemento.trim());
  if (elementos.some((elemento) => elemento === "")) {
    errores.push({ parametro: "intereses", mensaje: "El parámetro intereses no puede contener elementos vacíos." });
    return null;
  }

  const intereses = [];
  const desconocidos = [];
  for (const elemento of elementos) {
    const interes = INTERES_POR_CLAVE.get(normalizarInteres(elemento));
    if (!interes) {
      desconocidos.push(elemento);
    } else if (!intereses.includes(interes)) {
      intereses.push(interes);
    }
  }

  if (desconocidos.length > 0) {
    errores.push({
      parametro: "intereses",
      mensaje: `Intereses no admitidos: ${desconocidos.join(", ")}. Valores permitidos: ${INTERESES_PERMITIDOS.join(", ")}.`,
    });
    return null;
  }

  return intereses;
}

function combinarCategorias(categoria, intereses) {
  const categorias = new Set(categoria ? [categoria] : []);
  for (const interes of intereses) {
    for (const categoriaInteres of CATEGORIAS_POR_INTERES[interes]) {
      categorias.add(categoriaInteres);
    }
  }
  return [...categorias];
}

function validarConsultaLugares(query) {
  const errores = [];

  const lat = validarDecimal(query, "lat", -90, 90, errores);
  const lng = validarDecimal(query, "lng", -180, 180, errores);
  const categoria = validarCategoria(query, errores);
  const intereses = validarIntereses(query, errores);
  const radio = validarEntero(query, "radio", 1, 50000, 5000, errores);
  const limite = validarEntero(query, "limite", 1, 100, 20, errores);

  if (query.categoria === undefined && query.intereses === undefined) {
    errores.push({ parametro: "categoria", mensaje: "Debes indicar el parámetro categoria, intereses o ambos." });
  }

  if (errores.length > 0) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Los parámetros de la consulta no son válidos.", errores);
  }

  return {
    lat,
    lng,
    categorias: combinarCategorias(categoria, intereses ?? []),
    intereses: intereses ?? [],
    radio,
    limite,
  };
}

module.exports = { validarConsultaLugares, normalizarInteres };
