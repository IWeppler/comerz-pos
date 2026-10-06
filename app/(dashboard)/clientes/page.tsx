import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { ClientsPageClient } from "@/features/clients/ui/clients-page-client";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { getRolActual } from "@/shared/config/supabase/contexto-actual";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  // Verificación de sesión
  const { user } = await getUsuarioActual();
  if (!user) redirect(RUTA_SALIR);

  const rolActual = await getRolActual();
  const userRole = rolActual || "VENDEDOR";
  const isAdmin = userRole === "ADMIN";
  const supabase = createClient(await cookies());
  const [{ data: puedeCorregirCobro }, { data: puedeCrearCliente }] =
    await Promise.all([
      supabase.rpc("tiene_permiso", { clave: "clientes.corregir_cobro_cc" }),
      supabase.rpc("tiene_permiso", { clave: "clientes.crear" }),
    ]);

  return (
    <ClientsPageClient
      isAdmin={isAdmin}
      puedeCorregirCobro={Boolean(puedeCorregirCobro)}
      puedeCrearCliente={Boolean(puedeCrearCliente)}
    />
  );
}
