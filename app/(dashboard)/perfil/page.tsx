import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileDashboard } from "@/features/perfil/ui/profile-dashboard";
import { createClient } from "@/shared/config/supabase/server";
import {
  getPlanDelNegocioAction,
  getPlanesCompletosAction,
} from "@/features/admin/actions/planes-actions";
import { getUsoDelPlanAction } from "@/features/planes/actions/uso-del-plan";
import { getSolicitudPendienteAction } from "@/features/planes/actions/solicitud-plan";
import { SuscripcionPanel } from "@/features/planes/ui/suscripcion/suscripcion-panel";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";

export const dynamic = "force-dynamic";

const TABS = ["perfil", "seguridad", "plan"] as const;

const ProfilePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) => {
  // `?tab=plan` lo usan "Mejorar plan" del menú de la cuenta y los paywalls.
  // Un valor desconocido cae a la pestaña de siempre.
  const { tab } = await searchParams;
  const tabInicial = TABS.find((t) => t === tab) ?? "perfil";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { user } = await getUsuarioActual();
  if (!user) redirect(RUTA_SALIR);

  // La página venía con todo en blanco (id, nombre, email y plan hardcodeados
  // en ""). Ahora sale del perfil global y del negocio activo.
  //
  // Las cuatro consultas van en paralelo: la pestaña de suscripción necesita
  // el plan del negocio, la lista de planes activos (para la comparativa) y el
  // uso real de los límites, y ninguna depende de otra.
  const [{ data: perfil }, plan, planes, uso, solicitudPendiente] =
    await Promise.all([
      supabase
        .from("perfiles")
        .select("nombre, email")
        .eq("id", user.id)
        .single(),
      getPlanDelNegocioAction(),
      getPlanesCompletosAction(),
      getUsoDelPlanAction(),
      // Si ya pidió el cambio, el botón se reemplaza por el estado del pedido.
      getSolicitudPendienteAction(),
    ]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden p-2 md:p-4 md:pl-0 h-screen">
      <ProfileDashboard
        usuario={{
          id: user.id,
          nombre: perfil?.nombre ?? "",
          email: perfil?.email ?? user.email ?? "",
        }}
        plan={plan}
        tabInicial={tabInicial}
        suscripcion={
          <SuscripcionPanel
            plan={plan}
            planes={planes}
            uso={uso}
            solicitudPendiente={solicitudPendiente}
          />
        }
      />
    </div>
  );
};

export default ProfilePage;
