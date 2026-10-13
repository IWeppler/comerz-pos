"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  crearSolicitudPlanAction,
  type SolicitudPlan,
  type SolicitudPlanState,
} from "@/features/planes/actions/solicitud-plan";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { Modalidad } from "@/shared/lib/planes";

const estadoInicial: SolicitudPlanState = { error: null, success: false };

export interface PlanElegible {
  id: string;
  nombre: string;
  precio_mensual: number;
}

/**
 * Pedido de cambio de plan.
 *
 * Reemplaza al `mailto:` que abría el cliente de correo del sistema: en una
 * máquina con Outlook sin configurar, eso es una ventana de configuración de
 * cuenta y el pedido no llega a ningún lado. Acá el pedido queda como fila en
 * la base y aparece en /admincomerz.
 *
 * NO cambia el plan: lo aplica Comerz a mano cuando el pago está acordado. El
 * modal lo dice con todas las letras para que nadie espere que el módulo se
 * desbloquee al confirmar.
 */
export function CambiarPlanModal({
  planActual,
  planes,
  modalidad,
  solicitudPendiente,
}: Readonly<{
  planActual: string | null;
  planes: PlanElegible[];
  modalidad: Modalidad;
  solicitudPendiente: SolicitudPlan | null;
}>) {
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<PlanElegible | null>(null);
  const [estado, accion, enviando] = useActionState(
    crearSolicitudPlanAction,
    estadoInicial,
  );

  // Cerrar el modal cuando el envío salió bien se hace DURANTE el render y no
  // en un efecto: un setState dentro de useEffect dispara un render en
  // cascada, y el linter lo marca. Mismo patrón que onboarding-stepper.tsx.
  // `consumido` es lo que evita que se repita en cada render.
  const [consumido, setConsumido] = useState(false);
  if (estado.success && !consumido) {
    setConsumido(true);
    setAbierto(false);
    toast.success("Pedido enviado. Te escribimos para coordinarlo.");
  }

  // Ya pidió y todavía no se resolvió: se muestra el estado en vez del botón.
  // Insistir no acelera nada y la base lo rechaza igual (único parcial).
  if (solicitudPendiente) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <CheckCircle2 className="size-4 shrink-0 text-primary" />
        <p className="text-sm text-foreground">
          Pediste pasar al plan{" "}
          <strong>{solicitudPendiente.plan_solicitado_nombre}</strong>. Te
          escribimos para coordinarlo.
        </p>
      </div>
    );
  }

  const otros = planes.filter((p) => p.nombre !== planActual);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button className="h-11 sm:w-auto">
          <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
          Cambiar de plan
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogTitle>Cambiar de plan</DialogTitle>
        <DialogDescription>
          Elegí a cuál querés pasar y te escribimos para coordinar el pago. El
          cambio lo aplicamos nosotros: no se cobra nada ahora.
        </DialogDescription>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="modalidad" value={modalidad} />
          <input
            type="hidden"
            name="plan_solicitado_id"
            value={elegido?.id ?? ""}
          />
          <input
            type="hidden"
            name="plan_solicitado_nombre"
            value={elegido?.nombre ?? ""}
          />

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Pasar al plan</legend>
            <div className="flex flex-col gap-2">
              {otros.map((plan) => {
                const seleccionado = elegido?.id === plan.id;
                return (
                  <button
                    type="button"
                    key={plan.id}
                    onClick={() => setElegido(plan)}
                    aria-pressed={seleccionado}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      seleccionado
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{plan.nombre}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatearMoneda(plan.precio_mensual)}/mes
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="nota" className="text-sm">
              ¿Algo que quieras aclarar? (opcional)
            </Label>
            <Textarea
              id="nota"
              name="nota"
              rows={2}
              placeholder="Ej: necesito sumar dos vendedoras este mes."
              className="resize-none shadow-none"
            />
          </div>

          {estado.error && (
            <p className="text-sm text-destructive" role="alert">
              {estado.error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setAbierto(false)}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!elegido || enviando}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Enviar pedido"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
