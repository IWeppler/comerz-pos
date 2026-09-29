import { SupabaseClient } from "@supabase/supabase-js";

/**
 * ¿El negocio activo tiene prendido el módulo de presupuestos?
 *
 * Envoltorio de `modulo_presupuestos_habilitado()`. La llave es
 * `negocios.modulo_presupuestos`, que solo escribe el super admin: el módulo
 * NO va en todos los negocios (ver docs/presupuestos.md).
 *
 * Fail-CLOSED, al revés que `tieneFeatureServer`: una feature protege
 * facturación propia y ante la duda se deja pasar, pero esto es un módulo que
 * mueve plata y crédito y que la mayoría de los comercios no tiene. Mostrarlo
 * por un error de red es ofrecerle a una vendedora cobrar cuotas en un
 * negocio que no las usa.
 */
export async function moduloPresupuestosHabilitado(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("modulo_presupuestos_habilitado");

  if (error) {
    console.error("[PRESUPUESTOS] Error verificando el módulo:", error);
    return false;
  }

  return data === true;
}
