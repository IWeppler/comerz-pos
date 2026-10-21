/**
 * Reglas de los planes, del lado del código.
 *
 * La fuente de verdad es la columna `planes.reglas` (JSON) en la base: acá
 * sólo viven los tipos y el cálculo de precio, que no depende del plan sino de
 * la modalidad de cobro.
 */

export const DESCUENTO_SEMESTRAL = 0.2;

export type Modalidad = "mensual" | "semestral";

export interface ReglasPlan {
  max_usuarios?: number | null;
  max_sucursales?: number | null;
  max_clientes_cuenta_corriente?: number | null;
  /** Tope de productos del catálogo. Frena SOLO el alta: lo ya cargado se
   * sigue vendiendo y editando aunque el comercio esté por encima (los que
   * venían de antes conservan "sin límite" por `negocios.reglas_override`). */
  max_productos?: number | null;
  features?: string[];
}

/**
 * Precio mensual efectivo. El semestral no es un precio distinto guardado en
 * otra fila: es el mismo plan con 15% off, así un cambio de lista no deja dos
 * verdades conviviendo.
 */
export function precioMensualEfectivo(
  precioLista: number,
  modalidad: Modalidad,
): number {
  return modalidad === "semestral"
    ? Math.round(precioLista * (1 - DESCUENTO_SEMESTRAL))
    : precioLista;
}

/** Lo que se cobra de una vez en cada ciclo. */
export function precioPorCiclo(
  precioLista: number,
  modalidad: Modalidad,
): number {
  const mensual = precioMensualEfectivo(precioLista, modalidad);
  return modalidad === "semestral" ? mensual * 6 : mensual;
}

export function tieneFeature(
  reglas: ReglasPlan | null | undefined,
  clave: string,
): boolean {
  // Sin plan cargado no se bloquea nada: los comercios que ya venían
  // trabajando no tienen plan asignado y apagarles medio sistema sería un
  // incidente, no un control de facturación. Mismo criterio que en la base.
  if (!reglas || Object.keys(reglas).length === 0) return true;
  return reglas.features?.includes(clave) ?? false;
}

/**
 * Cómo se muestra el plan del negocio activo (sidebar, banners de paywall).
 *
 * El nombre sale de `planes.nombre` y NO se hardcodea en ningún lado: si mañana
 * se renombra un plan o se agrega uno nuevo, la UI lo sigue sola. El prefijo
 * "Plan " se agrega acá para no repetirlo en cada fila de la tabla.
 */
export function etiquetaPlan(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return "Sin plan";
  return /^plan\b/i.test(limpio) ? limpio : `Plan ${limpio}`;
}

/** Etiquetas para mostrar; las claves son las que viajan en `features`. */
export const NOMBRE_FEATURE: Record<string, string> = {
  pos: "Punto de venta",
  caja: "Caja",
  ventas: "Ventas",
  stock: "Control de stock",
  catalogo_publico: "Catálogo online",
  clientes: "Registro de clientes",
  cuenta_corriente: "Cuenta corriente",
  cuenta_corriente_ilimitada: "Cuenta corriente ilimitada",
  tickets: "Tickets digitales",
  historial_ventas: "Historial completo de ventas",
  insights_basico: "Comerz Intelligence (básico)",
  resumen_semanal: "Resumen semanal por mail",
  catalogo_sin_marca: "Catálogo sin marca Comerz",
  reportes: "Reportes de ventas y productos",
  reportes_exportar: "Exportación de reportes",
  multicaja: "Múltiples cajas",
  roles: "Roles de usuarios",
  auditoria: "Historial de acciones",
  multisucursal: "Múltiples sucursales",
  stock_por_sucursal: "Stock por sucursal",
  transferencias_sucursal: "Transferencias entre sucursales",
  dashboard_consolidado: "Dashboard consolidado",
  permisos_avanzados: "Permisos avanzados",
  facturacion_electronica: "Facturación electrónica (ARCA)",
  integraciones: "Impresoras y lectores",
  api: "API",
};
