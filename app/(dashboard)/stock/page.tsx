import { StockPageClient } from "@/features/stock/ui/stock-page-client";
import { getUsoDelPlanAction } from "@/features/planes/actions/uso-del-plan";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { getRolActual } from "@/shared/config/supabase/contexto-actual";
import { puedeEditarProducto } from "@/features/stock/lib/puede-editar-producto";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const { user } = await getUsuarioActual();

  let userRole = "VENDEDOR";
  if (user) {
    const rolActual = await getRolActual();
    if (rolActual) userRole = rolActual;
  }

  // Cuántos productos hay cargados, para el medidor del tope del plan. Se
  // cuenta en el server con `head: true` (no trae filas) en vez de derivarlo
  // de la lista de la pantalla, que viene filtrada y paginada — y que además
  // topea en 1000 por el límite de PostgREST, justo el número del plan.
  const [uso, puedeEditar] = await Promise.all([
    userRole === "ADMIN" ? getUsoDelPlanAction() : Promise.resolve(null),
    puedeEditarProducto(),
  ]);

  return (
    <StockPageClient
      userRole={userRole}
      uso={uso}
      puedeEditarProducto={puedeEditar}
    />
  );
}
