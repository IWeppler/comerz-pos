/**
 * Los códigos que lanzan `crear_presupuesto` y la trigger
 * `presupuestos_solo_estado_editable`, en palabras de mostrador.
 *
 * Un código que no está acá se muestra genérico y se loguea: mejor un
 * "no se pudo" que un texto de Postgres en la pantalla de la vendedora.
 */
const MENSAJES: Record<string, string> = {
  SIN_NEGOCIO_ACTIVO: "No hay un negocio activo en esta sesión. Volvé a entrar.",
  MODULO_NO_HABILITADO: "El módulo de presupuestos no está habilitado en este negocio.",
  SIN_PERMISO: "No tenés permiso para armar cotizaciones.",
  PRESUPUESTO_SIN_RENGLONES: "La cotización no tiene renglones.",
  PRESUPUESTO_DEMASIADOS_RENGLONES: "La cotización tiene demasiados renglones.",
  MODALIDAD_INVALIDA: "Elegí cuándo se entrega la mercadería.",
  SIN_CONFIGURACION: "Falta la configuración del comercio.",
  VIGENCIA_INVALIDA: "La vigencia tiene que ser de 1 a 365 días.",
  CLIENTE_NO_ENCONTRADO: "El cliente elegido ya no existe.",
  VENTA_LIBRE_INVALIDA: "Un renglón sin producto tiene la descripción o el precio mal cargados.",
  PRODUCTO_NO_ENCONTRADO: "Un producto del carrito ya no existe o cambió. Actualizá el catálogo y volvé a intentar.",
  SIN_PRECIO: "Hay un producto sin precio cargado",
  CANTIDAD_INVALIDA: "Hay una cantidad inválida",
  PRESUPUESTO_SIN_TOTAL: "La cotización da $0.",
  PRESUPUESTO_INMUTABLE: "Una cotización emitida no se edita: anulala y hacé otra.",
  PRESUPUESTO_YA_RESUELTO: "Esa cotización ya estaba cerrada.",
  PRESUPUESTO_TRANSICION_INVALIDA: "Ese cambio de estado no está permitido.",
};

/** `detail` trae el nombre del producto en SIN_PRECIO y CANTIDAD_INVALIDA. */
export function mensajeErrorPresupuesto(
  error: { message?: string; details?: string | null } | null | undefined,
): string {
  const codigo = (error?.message ?? "").trim();
  const base = MENSAJES[codigo];
  if (!base) return "No se pudo guardar la cotización. Probá de nuevo.";
  const detalle = (error?.details ?? "").trim();
  if ((codigo === "SIN_PRECIO" || codigo === "CANTIDAD_INVALIDA") && detalle) {
    return `${base}: ${detalle}.`;
  }
  return base.endsWith(".") ? base : `${base}.`;
}

export function esErrorConocido(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && MENSAJES[error.message.trim()]);
}
