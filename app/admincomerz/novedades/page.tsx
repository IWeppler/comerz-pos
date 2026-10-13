import { listarNovedadesAdminAction } from "@/features/admin/actions/novedades";
import { NovedadesEditor } from "@/features/admin/ui/novedades-editor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Novedades | Comerz" };

/** N5 (docs/notificaciones.md): lo que se publica acá aparece en la pestaña
 * "Novedades" de la campana de todos los usuarios. */
export default async function AdminNovedadesPage() {
  const novedades = await listarNovedadesAdminAction();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novedades</h1>
        <p className="text-sm text-white/50">
          Lo que publiques acá aparece en la campana de todos los usuarios, en la pestaña &quot;Novedades&quot;.
        </p>
      </div>
      <NovedadesEditor novedades={novedades} />
    </div>
  );
}
