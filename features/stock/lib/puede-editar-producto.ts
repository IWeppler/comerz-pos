import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿Este usuario puede crear productos, editarlos y cargar mercadería
 * (`stock.editar_producto`)?
 *
 * Solo decide QUÉ MOSTRAR: "Nuevo producto", "Editar producto" y la carga
 * rápida (en Inventario y en el POS). La puerta real es la base
 * (`20261023000000`: trigger de `productos`, `guardar_variantes_producto`,
 * `ajustar_stock_*`). Hasta el 23/10/2026 la pantalla miraba el ROL ADMIN: a un
 * encargado con el permiso le escondía la edición, y la carga rápida no la
 * escondía a nadie. Cacheada por request, mismo criterio que
 * `puedeFiarSinRecargo`.
 */
export const puedeEditarProducto = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.STOCK_EDITAR_PRODUCTO);
});
