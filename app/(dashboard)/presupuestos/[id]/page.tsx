import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/shared/config/supabase/server";
import { moduloPresupuestosHabilitado } from "@/features/presupuestos/lib/modulo-habilitado";
import { obtenerPresupuestoAction } from "@/features/presupuestos/actions/presupuestos";
import { getConfiguracionAction } from "@/features/config/actions/config-actions";
import { PresupuestoDetalleView } from "@/features/presupuestos/ui/presupuesto-detalle";

export const dynamic = "force-dynamic";

export default async function PresupuestoPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  if (!(await moduloPresupuestosHabilitado(supabase))) notFound();

  const [{ data, error }, { data: config }, { data: usuario }, { data: esAdmin }] =
    await Promise.all([
      obtenerPresupuestoAction(id),
      getConfiguracionAction(),
      supabase.auth.getUser(),
      supabase.rpc("is_admin"),
    ]);

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      </div>
    );
  }
  if (!data) notFound();

  return (
    <PresupuestoDetalleView
      presupuesto={data}
      comercio={{
        nombre: config?.posName || "Comercio",
        logo: config?.posLogo || null,
        whatsapp: config?.whatsapp || null,
        direccion: config?.direccion || null,
      }}
      // Espejo de la policy `presupuestos_update`: quien la hizo o un ADMIN.
      // Es para no ofrecer un botón que la base va a rechazar; el freno es
      // la policy (y la acción chequea las filas tocadas).
      puedeCerrar={data.vendedor_id === usuario.user?.id || Boolean(esAdmin)}
    />
  );
}
