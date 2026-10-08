const { ErrorApi } = require("../errores");

const PROVEEDOR = "geoapify";
const CLAVE_CATEGORIA = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function textoNoVacio(valor) {
  return typeof valor === "string" && valor.trim() !== "";
}

function coordenadaValida(valor, limite) {
  return typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;
}

function categoriasValidas(valor) {
  if (!Array.isArray(valor)) {
    return [];
  }
  return [...new Set(valor.filter((categoria) => typeof categoria === "string" && CLAVE_CATEGORIA.test(categoria)))];
}

function transformarLugar(feature) {
  const propiedades = feature && typeof feature === "object" ? feature.properties : null;
  if (!propiedades || typeof propiedades !== "object") {
    return null;
  }

  const { place_id: idExterno, name: nombre, lat, lon } = propiedades;
  if (!textoNoVacio(idExterno) || !textoNoVacio(nombre)) {
    return null;
  }
  if (!coordenadaValida(lat, 90) || !coordenadaValida(lon, 180)) {
    return null;
  }

  const categorias = categoriasValidas(propiedades.categories);
  if (categorias.length === 0) {
    return null;
  }

  return {
    idExterno,
    proveedor: PROVEEDOR,
    nombre,
    direccion: textoNoVacio(propiedades.formatted) ? propiedades.formatted : null,
    lat,
    lng: lon,
    categorias,
  };
}

function transformarLugares(datos) {
  if (!datos || typeof datos !== "object" || !Array.isArray(datos.features)) {
    throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta con formato inesperado.");
  }

  const vistos = new Set();
  const lugares = [];

  for (const feature of datos.features) {
    const lugar = transformarLugar(feature);
    if (!lugar || vistos.has(lugar.idExterno)) {
      continue;
    }
    vistos.add(lugar.idExterno);
    lugares.push(lugar);
  }

  return lugares;
}

module.exports = { transformarLugares };
