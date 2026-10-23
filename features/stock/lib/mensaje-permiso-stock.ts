/**
 * Traduce los frenos de permiso de catálogo y stock que pone la base
 * (`20261023000000`): `trg_proteger_campos_producto`,
 * `guardar_variantes_producto` y `ajustar_stock_*`.
 *
 * La UI todavía no esconde la edición de productos a quien no tiene
 * `stock.editar_producto`, así que el error llega a la pantalla: tiene que decir
 * qué falta y a quién pedírselo, no "hubo un error".
 */
export function mensajePermisoStock(mensaje: string | null | undefined): string | null {
  const m = mensaje ?? "";
  if (m.includes("SIN_PERMISO_EDITAR_PRODUCTO")) {
    return "No tenés permiso para crear productos ni cambiar precios. Pedíselo a quien administra el comercio (Configuración › Empleados y permisos).";
  }
  if (m.includes("SIN_PERMISO_STOCK")) {
    return "No tenés permiso para cambiar el stock. Pedíselo a quien administra el comercio (Configuración › Empleados y permisos).";
  }
  return null;
}
