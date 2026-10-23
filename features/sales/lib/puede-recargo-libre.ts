import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿Este usuario puede ponerle un recargo libre a una venta de contado?
 *
 * Solo decide QUÉ MOSTRAR (el "+ Recargo" bajo los descuentos del ticket). La
 * puerta real es `registrarVentaAction` y, detrás, `registrar_venta`
 * (20261023160000). Cacheada por request, mismo criterio que
 * `puedeFiarSinRecargo`.
 */
export const puedeRecargoLibre = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.VENTAS_RECARGO_LIBRE);
});
