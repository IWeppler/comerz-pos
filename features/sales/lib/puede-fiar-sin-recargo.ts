import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿Este usuario puede anular el recargo de cuenta corriente al fiar?
 *
 * Solo decide QUÉ MOSTRAR (el "Anular" de la línea RECARGO CC del ticket). La
 * puerta real es `registrarVentaAction` y, detrás, `registrar_venta`
 * (20261007230000). Cacheada por request, mismo criterio que
 * `puedeElegirComprobante`.
 */
export const puedeFiarSinRecargo = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.VENTAS_FIAR_SIN_RECARGO);
});
