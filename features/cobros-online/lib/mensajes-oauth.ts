/**
 * Por qué la conexión no se completó. Viaja en la URL de vuelta a Cobros
 * (`?mp=<codigo>`), así que es un código cerrado y nunca un texto de MP.
 */
export type CodigoResultadoOAuth =
  | "conectado"
  | "cancelado"
  | "state_invalido"
  | "otra_sesion"
  | "rechazado"
  | "sin_configurar"
  | "sin_permiso"
  | "modulo_apagado"
  | "error";

export const MENSAJES_OAUTH: Record<CodigoResultadoOAuth, string> = {
  conectado: "¡Listo! Tu Mercado Pago quedó conectado.",
  cancelado: "Cancelaste la conexión en Mercado Pago. Cuando quieras, probá de nuevo.",
  state_invalido:
    "El enlace de conexión venció o ya se usó. Tocá «Conectar Mercado Pago» otra vez.",
  otra_sesion:
    "La conexión se empezó con otro usuario. Volvé a tocar «Conectar Mercado Pago» desde tu cuenta.",
  rechazado:
    "Mercado Pago no aceptó la conexión. Revisá que tu cuenta esté verificada y probá de nuevo.",
  sin_configurar:
    "La conexión con Mercado Pago todavía no está habilitada. Escribinos y lo activamos.",
  sin_permiso: "Solo un administrador del comercio puede conectar Mercado Pago.",
  modulo_apagado: "Los cobros online no están activados para tu comercio.",
  error: "No pudimos completar la conexión. Probá de nuevo en unos minutos.",
};

export function esCodigoResultado(valor: string | null | undefined): valor is CodigoResultadoOAuth {
  return !!valor && Object.prototype.hasOwnProperty.call(MENSAJES_OAUTH, valor);
}
