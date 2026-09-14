"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { useTieneFeature } from "@/features/planes/ui/plan-provider";
import { configurarPedidosACajaAction } from "../actions/configurar";

/**
 * "Varios puestos, una caja", en Empleados y Permisos.
 *
 * Vive acá y no en Caja porque lo que cambia es QUIÉN hace qué: al
 * prenderlo, VENDEDOR deja de cobrar (pierde `ventas.cobrar`) y solo manda
 * pedidos; ENCARGADO y ADMIN cobran desde "Por cobrar". Un toggle en Caja
 * que dejara los permisos como estaban dejaba la feature a medias.
 *
 * El ajuste fino (una vendedora puntual que sí cobra) sigue siendo la
 * matriz de permisos de abajo, que es la fuente de verdad.
 */
export function CobroCentralizado({
  activo,
}: Readonly<{ activo: boolean }>) {
  const [valor, setValor] = useState(activo);
  const [pendiente, startTransition] = useTransition();
  const router = useRouter();
  const incluido = useTieneFeature("pedidos_a_caja");

  const cambiar = (nuevo: boolean) => {
    setValor(nuevo);
    startTransition(async () => {
      const r = await configurarPedidosACajaAction(nuevo);
      if (!r.success) {
        setValor(!nuevo);
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(
        nuevo
          ? "Listo: las vendedoras mandan pedidos y la caja cobra."
          : "Listo: todos vuelven a cobrar en su puesto.",
      );
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            Varios puestos, una caja
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-prose">
            Las vendedoras arman el ticket en su puesto y lo{" "}
            <strong className="text-foreground">envían a la caja</strong> con
            un número; el encargado lo abre en &quot;Por cobrar&quot; y cobra.
            Al prenderlo, el rol <strong className="text-foreground">Vendedor</strong>{" "}
            deja de cobrar y de operar la caja (no ve el botón de turno);
            Encargado y Administrador cobran. Podés afinar quién hace qué con
            &quot;Cobrar en el mostrador&quot; y &quot;Operar la caja&quot; en la
            matriz de abajo.
          </p>
          {!incluido && (
            <p className="text-xs text-warning">
              Disponible en los planes Gestión y Empresa.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pendiente && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={valor}
            disabled={pendiente || (!incluido && !valor)}
            onCheckedChange={cambiar}
            aria-label="Enviar pedidos a la caja"
          />
        </div>
      </div>
    </section>
  );
}
