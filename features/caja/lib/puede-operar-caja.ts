import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿Esta persona opera caja (abre/cierra turno, carga gastos)?
 *
 * Decide si se muestra el botón de estado de caja en la barra. La puerta
 * real son `abrirTurnoAction`, `cerrarTurnoAction` y `registrarEgresoAction`,
 * que vuelven a chequear. Cacheada por request, como `puedeCobrarCuentaCorriente`.
 */
export const puedeOperarCaja = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  return tienePermiso(supabase, PERMISOS.CAJA_OPERAR);
});
