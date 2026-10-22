import { getResumenPagosRemitosAction } from "@/features/purchases/actions/pago-remito";
import { ComprasPanel } from "@/features/purchases/ui/compras-panel";
import { bloquearVendedor } from "@/shared/config/supabase/guard-rol";

export const dynamic = "force-dynamic";

/**
 * Compras: cuánto se le debe a cada proveedor, los remitos sin responder
 * "¿Lo pagaste?" y la mercadería que se subió y no ingresó
 * (docs/asistente-ia.md, C1). Todo sale de `resumen_pagos_remitos`.
 */
export default async function ComprasPage() {
  await bloquearVendedor();
  const remitos = await getResumenPagosRemitosAction();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 md:py-6">
      <ComprasPanel remitos={remitos} />
    </div>
  );
}
