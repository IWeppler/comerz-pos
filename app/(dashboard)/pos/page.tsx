import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { PosPageClient } from "@/features/pos/ui/pos-page-client";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { puedeCobrarCuentaCorriente } from "@/features/clients/lib/puede-cobrar-cc";
import { puedeElegirComprobante } from "@/features/sales/lib/puede-elegir-comprobante";
import { puedeFiarSinRecargo } from "@/features/sales/lib/puede-fiar-sin-recargo";
import { puedeRecargoLibre } from "@/features/sales/lib/puede-recargo-libre";
import { puedeEditarProducto } from "@/features/stock/lib/puede-editar-producto";
import { puedeCobrarAction } from "@/features/pedidos/actions/pedidos";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { normalizarRubro } from "@/entities/config/types";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  // Verificamos permisos
  const { user } = await getUsuarioActual();
  if (!user) redirect(RUTA_SALIR);

  // No cuesta un viaje: el layout ya lo resolvió en este mismo render y
  // `puedeCobrarCuentaCorriente` está cacheada por request.
  const [
    puedeCobrarCc,
    puedeElegirCbte,
    puedeCobrar,
    puedeSinRecargo,
    puedeRecargo,
    puedeCargar,
  ] = await Promise.all([
    puedeCobrarCuentaCorriente(),
    puedeElegirComprobante(),
    puedeCobrarAction(),
    puedeFiarSinRecargo(),
    puedeRecargoLibre(),
    puedeEditarProducto(),
  ]);

  // El rubro, GRATIS: `leerConfigPos` ya la llamaron los dos layouts de este
  // mismo request y está cacheada con `cache()` de React, así que esto no
  // paga ningún viaje. Baja al cliente para que el ticket y la grilla se
  // dibujen bien desde el primer pintado — era lo único que el carrito
  // necesitaba del catálogo, y lo hacía esperar 2,06 MB por un string.
  const config = await leerConfigPos();

  return (
    <PosPageClient
      puedeCobrarCuentaCorriente={puedeCobrarCc}
      puedeElegirComprobante={puedeElegirCbte}
      puedeCobrar={puedeCobrar}
      puedeFiarSinRecargo={puedeSinRecargo}
      puedeRecargoLibre={puedeRecargo}
      puedeEditarProducto={puedeCargar}
      rubroInicial={normalizarRubro(config?.rubro)}
    />
  );
}
