import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/shared/config/supabase/server";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { conciliarPagosNegocio } from "@/features/cobros-online/lib/conciliar-servidor";
import { OrdenesPanel, type OrdenPanel } from "@/features/ordenes-tienda/ui/ordenes-panel";

export const dynamic = "force-dynamic";

/**
 * Órdenes del catálogo con pago online.
 *
 * Antes de listar: concilia los pagos (checkout y transferencias) contra el
 * Mercado Pago del comercio y después vence las impagas (STOPGAP #1: sin job,
 * lo dispara la lectura). Una orden ya pagada aparece directamente cobrada.
 *
 * La lista sale con la SESIÓN: la RLS exige `tienda.ver_ordenes` (tienen los
 * roles que cobran). Sin el módulo prendido, 404.
 */
export default async function OrdenesPage() {
  const supabase = createClient(await cookies());
  const { data: negocioId } = await supabase.rpc("negocio_actual");
  if (!negocioId) notFound();

  const { data: negocio } = await supabase
    .from("negocios")
    .select("pagos_online_habilitado")
    .eq("id", negocioId as string)
    .maybeSingle();
  if (negocio?.pagos_online_habilitado !== true) notFound();

  // Conciliar ANTES de vencer: un pago del último minuto se registra antes de
  // que su orden devuelva el stock. Si la conciliación no corrió (corrió hace
  // menos de 30 s), igual se vence.
  await conciliarPagosNegocio(negocioId as string);
  await createAdminClient().rpc("liberar_ordenes_tienda_vencidas", { p_negocio: negocioId });

  const [{ data: ordenes, error }, puedeCobrar] = await Promise.all([
    supabase
      .from("ordenes_tienda")
      .select(
        "id, numero, estado, medio, cliente_nombre, cliente_telefono, modalidad_entrega, localidad, direccion, nota, total, vence_en, creado_en, pagada_en, venta_id, ordenes_tienda_items ( nombre, variante, cantidad, subtotal )",
      )
      .order("creado_en", { ascending: false })
      .limit(100),
    tienePermiso(supabase, PERMISOS.VENTAS_COBRAR),
  ]);

  if (error) {
    console.error("[ORDENES] lista", error.code, error.message);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 md:py-6">
      <OrdenesPanel ordenes={(ordenes ?? []) as OrdenPanel[]} puedeCobrar={puedeCobrar} sinPermiso={!!error} />
    </div>
  );
}
