import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Envoltorio del RPC `tiene_feature(clave)` — la autoridad sobre qué incluye
 * el plan del negocio activo, del mismo modo que `tiene_permiso` lo es sobre
 * los permisos.
 *
 * Se usa para gatear MÓDULOS enteros en el server. El PaywallGate del cliente
 * es aviso, no control: esconder el link del sidebar deja la ruta viva, y
 * tipear /reportes a mano seguía mostrando la facturación del comercio con un
 * plan que no la incluye.
 *
 * OJO con la dirección del fail: acá se falla ABIERTO (ante un error del RPC
 * se devuelve true), al revés que `tienePermiso`. No es un descuido, es la
 * misma regla que ya tiene la base: un permiso protege datos de terceros y por
 * eso se niega ante la duda, mientras que una feature protege facturación
 * propia — apagarle un módulo a un comercio que sí lo pagó por un error de red
 * es un incidente, y dejarlo entrar de más un rato no le hace daño a nadie.
 */
export async function tieneFeatureServer(
  supabase: SupabaseClient,
  clave: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("tiene_feature", { clave });

  if (error) {
    console.error(`[PLAN] Error verificando la feature "${clave}":`, error);
    return true;
  }

  return data !== false;
}

/** Claves de feature usadas desde el código, para que un typo no se lea como
 * "el plan no la incluye". Mismo criterio que PERMISOS en shared/lib/permisos. */
export const FEATURES = {
  REPORTES: "reportes",
  REPORTES_EXPORTAR: "reportes_exportar",
  MULTICAJA: "multicaja",
  ROLES: "roles",
  AUDITORIA: "auditoria",
  PEDIDOS_A_CAJA: "pedidos_a_caja",
} as const;
