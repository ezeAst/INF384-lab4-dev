const { version } = require('../package.json');

const PATRON_USUARIO = /^[a-z][a-z0-9_]{2,31}$/;

function validarMonto(monto) {
  if (typeof monto !== 'number' || !Number.isFinite(monto)) {
    return 'monto debe ser numerico';
  }
  if (monto < 0) {
    return 'monto debe ser mayor que cero';
  }
  if (Math.abs(Math.round(monto * 100) - monto * 100) > 1e-6) {
    return 'monto admite dos decimales';
  }
  return null;
}

function validarUsuario(usuario) {
  return typeof usuario === 'string' && PATRON_USUARIO.test(usuario);
}

function aCentimos(monto) {
  return Math.round(monto * 100);
}

function aSoles(centimos) {
  return centimos / 100;
}

function respuesta(statusCode, cuerpo) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

function ok(cuerpo) {
  return respuesta(200, cuerpo);
}

function error(statusCode, mensaje) {
  return respuesta(statusCode, { error: mensaje });
}

function obtenerVersion() {
  return process.env.APP_VERSION || version;
}

function obtenerCommit() {
  return process.env.APP_COMMIT || 'local';
}

module.exports = {
  validarMonto,
  validarUsuario,
  aCentimos,
  aSoles,
  respuesta,
  ok,
  error,
  obtenerVersion,
  obtenerCommit,
};
