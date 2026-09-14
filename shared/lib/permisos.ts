import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Envoltorio del RPC `tiene_permiso(clave)` — la única fuente de verdad de
 * permisos. Es SECURITY DEFINER y resuelve por `auth.uid()`, así que devuelve
 * el permiso del usuario de ESTA sesión: nunca hay que pasarle un userId ni
 * combinarlo con `is_admin()` desde el código (la función ya da true para
 * cualquier ADMIN por su cuenta).
 *
 * Fail-closed: si el RPC falla (red, permiso, clave inexistente) devolvemos
 * false. Un permiso no se otorga por un error de infraestructura.
 */
export async function tienePermiso(
  supabase: SupabaseClient,
  clave: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("tiene_permiso", { clave });

  if (error) {
    console.error(`Error verificando permiso "${clave}":`, error);
    return false;
  }

  return Boolean(data);
}

/** Claves usadas desde el código. Evita que un typo en el string se lea como
 * "no tiene permiso" en silencio, que es lo que hace fail-closed. */
export const PERMISOS = {
  CAJA_CERRAR_AJENA: "caja.cerrar_ajena",
  CAJA_VER_GERENCIAL: "caja.ver_gerencial",
  STOCK_IMPORTAR_PLANILLA: "stock.importar_planilla",
  STOCK_INGRESAR_REMITO: "stock.ingresar_remito",
  CLIENTES_COBRAR_CC: "clientes.cobrar_cc",
  CONFIGURACION_FACTURACION: "configuracion.facturacion",
  VENTAS_ELEGIR_COMPROBANTE: "ventas.elegir_comprobante",
  VENTAS_ANULAR: "ventas.anular",
  VENTAS_COBRAR: "ventas.cobrar",
  CAJA_OPERAR: "caja.operar",
  REPORTES_VER_MODULO: "reportes.ver_modulo",
} as const;
