class ErrorApi extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.name = "ErrorApi";
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

function manejarErrores(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ErrorApi) {
    const error = { codigo: err.codigo, mensaje: err.message };
    if (err.detalles) {
      error.detalles = err.detalles;
    }
    return res.status(err.estado).json({ error });
  }

  console.error("Error interno no controlado:", err && err.name);
  return res.status(500).json({
    error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno en el servidor." },
  });
}

module.exports = { ErrorApi, manejarErrores };
