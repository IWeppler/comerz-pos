import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿Este usuario puede elegir, en cada venta, si sale factura o ticket?
 *
 * Solo decide QUÉ MOSTRAR (el selector Factura / Ticket del POS). La puerta
 * real es `registrarVentaAction`, que ignora el valor del request si el
 * permiso no está. Cacheada por request, mismo criterio que
 * `puedeCobrarCuentaCorriente`.
 */
export const puedeElegirComprobante = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.VENTAS_ELEGIR_COMPROBANTE);
});
