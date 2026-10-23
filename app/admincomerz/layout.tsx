import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Bell, LogOut } from "lucide-react";
import { logoutAction } from "@/features/auth/actions/logout";
import {
  AdminShell,
  COOKIE_NAV_COLAPSADO,
} from "@/features/admin/ui/admin-shell";
import { CampanaAdminServidor } from "@/features/admin/ui/campana-admin-servidor";

export default async function AdminComerzLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(RUTA_SALIR);

  // Validamos si es el super admin usando la función de base de datos
  const { data: isAdmin, error } = await supabase.rpc("is_super_admin");

  if (error || !isAdmin) {
    redirect("/"); // Si no es super admin, lo mandamos al inicio del POS
  }

  const colapsadoInicial =
    cookieStore.get(COOKIE_NAV_COLAPSADO)?.value === "1";

  return (
    <AdminShell
      colapsadoInicial={colapsadoInicial}
      email={user.email}
      // La campana trae el feed (varias consultas): va en un Suspense para que
      // no frene la pantalla. Mientras llega, el ícono vacío ocupa su lugar.
      campana={
        <Suspense
          fallback={
            <span className="flex size-10 items-center justify-center text-white/30">
              <Bell className="size-[18px]" />
            </span>
          }
        >
          <CampanaAdminServidor />
        </Suspense>
      }
      cerrarSesion={
        <form action={logoutAction}>
          <button
            type="submit"
            title={`Cerrar sesión (${user.email})`}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10 md:justify-start"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">Cerrar sesión</span>
          </button>
        </form>
      }
    >
      {children}
    </AdminShell>
  );
}
