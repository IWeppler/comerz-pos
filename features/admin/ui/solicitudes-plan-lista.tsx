"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  resolverSolicitudPlanAction,
  type SolicitudPlanAdmin,
} from "@/features/admin/actions/solicitudes-plan-admin";

/**
 * Pedidos de cambio de plan esperando respuesta.
 *
 * Marcar "Ya lo cambié" NO cambia el plan: solo cierra el pedido. El cambio se
 * hace en Comercios, después de acordar el pago — por eso la fila lleva un
 * link directo ahí. Si el botón aplicara el plan, atender un pedido y activar
 * el cobro serían la misma acción, y alguien lo va a tocar antes de cobrar.
 */
export function SolicitudesPlanLista({
  solicitudes,
}: Readonly<{ solicitudes: SolicitudPlanAdmin[] }>) {
  const [resolviendo, startResolver] = useTransition();

  if (solicitudes.length === 0) return null;

  const resolver = (id: string, estado: "APLICADA" | "RECHAZADA") => {
    startResolver(async () => {
      const res = await resolverSolicitudPlanAction(id, estado);
      if (res.success) {
        toast.success(
          estado === "APLICADA" ? "Pedido cerrado" : "Pedido rechazado",
        );
      } else {
        toast.error(res.error ?? "No se pudo actualizar.");
      }
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-primary/30 bg-card">
      <div className="border-b border-border bg-primary/5 px-4 py-3">
        <h2 className="text-sm font-semibold">
          {solicitudes.length} pedido{solicitudes.length === 1 ? "" : "s"} de
          cambio de plan
        </h2>
        <p className="text-xs text-muted-foreground">
          El plan se cambia en Comercios; acá solo se cierra el pedido.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {solicitudes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.negocio}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{s.plan_actual ?? "Sin plan"}</span>
                <ArrowRight className="size-3 shrink-0" />
                <span className="font-medium text-foreground">
                  {s.plan_solicitado_nombre}
                </span>
                <span>· {s.modalidad}</span>
                <span>· {new Date(s.creado_en).toLocaleDateString("es-AR")}</span>
              </p>
              {s.nota && (
                <p className="mt-1 text-xs italic text-muted-foreground">
                  “{s.nota}”
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button asChild size="sm" variant="outline" className="h-8">
                {/* Al panel: el plan se cambia desde el menú de acciones de
                    la tabla de comercios. La página /admincomerz/negocios se
                    borró y este link quedaba en un 404. */}
                <Link href="/admincomerz">Cambiar plan</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1"
                disabled={resolviendo}
                onClick={() => resolver(s.id, "APLICADA")}
              >
                <Check className="size-3.5 text-success" />
                Ya está
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                aria-label="Rechazar pedido"
                disabled={resolviendo}
                onClick={() => resolver(s.id, "RECHAZADA")}
              >
                <X className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
