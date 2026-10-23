import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { redirect } from "next/navigation";
import { getStockAction } from "@/features/stock/actions/get-product";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { normalizarRubro } from "@/entities/config/types";
import { CargaRapidaPageClient } from "@/features/carga-rapida/ui/carga-rapida-page-client";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { puedeEditarProducto } from "@/features/stock/lib/puede-editar-producto";

export const dynamic = "force-dynamic";

export default async function CargaRapidaPage() {
  const { user } = await getUsuarioActual();
  if (!user) redirect(RUTA_SALIR);

  // La carga rápida crea productos y suma stock: pide `stock.editar_producto`
  // (la base lo frena igual, `20261023000000`). Sin el permiso los botones no
  // aparecen; esto cubre al link directo o guardado.
  if (!(await puedeEditarProducto())) redirect("/stock");

  // El rubro sale de `leerConfigPos`, que los layouts de este mismo request ya
  // llamaron: `cache()` lo devuelve sin viajar de nuevo. Era la segunda lectura
  // de la misma fila en la misma request.
  const [{ data: productos }, config] = await Promise.all([
    getStockAction(),
    leerConfigPos(),
  ]);

  // Solo para ahorrarle al cliente el round-trip (y el spinner "Buscando en
  // el Catálogo Maestro…") cuando el comercio no es de electro. El chequeo
  // que MANDA está en buscarEnCatalogoMaestroAction: esto es UX, no seguridad.
  return (
    <CargaRapidaPageClient
      productosIniciales={productos ?? []}
      rubro={normalizarRubro(config?.rubro)}
    />
  );
}
