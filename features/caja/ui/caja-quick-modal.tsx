"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Lock,
  Unlock,
  Clock,
  TrendingDown,
  Repeat2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { abrirTurnoAction, cerrarTurnoAction } from "../actions/caja-action";
import {
  AvisoVentasPendientes,
  useFrenoVentasPendientes,
} from "@/features/caja/ui/freno-ventas-pendientes";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { CajaActionState } from "@/entities/caja/types";
import { formatearMoneda } from "@/shared/utils/formatters";

interface CajaQuickModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modoCaja: string;
  userId: string;
  /** Abre el modal de egreso (cerrando este). El egreso es plata que sale
   * del cajón: su lugar es acá, no en el header del panel. */
  onAnotarGasto: () => void;
}

/**
 * Versión rápida de abrir/cerrar turno, disponible desde cualquier
 * pantalla vía el botón de estado del navbar — no reemplaza /caja (que
 * sigue siendo el lugar para historial, movimientos y el Cierre Z con
 * desglose completo). Usa las mismas server actions que ya validan
 * Multicaja (única/por_usuario, quién puede cerrar ajena) — este modal
 * no reimplementa ningún chequeo, solo muestra lo que la action devuelva.
 */
export function CajaQuickModal({
  open,
  onOpenChange,
  modoCaja,
  userId,
  onAnotarGasto,
}: Readonly<CajaQuickModalProps>) {
  const router = useRouter();
  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);
  const turno = useCajaStatusStore((state) => state.turno);
  const notifyCajaChanged = useCajaStatusStore(
    (state) => state.notifyCajaChanged,
  );

  const [, abrirAction, isAbrirPending] = useActionState(
    async (prevState: CajaActionState, formData: FormData) => {
      const res = await abrirTurnoAction(prevState, formData);
      if (res.success) {
        toast.success("Caja abierta correctamente.");
        notifyCajaChanged();
        router.refresh();
        onOpenChange(false);
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    { error: null, success: false },
  );

  // El turno no se cierra con ventas cobradas sin señal todavía en el
  // celular: entrarían contra un arqueo ya firmado. Ver
  // freno-ventas-pendientes.tsx.
  const { bloqueado: ventasSinSubir } = useFrenoVentasPendientes();

  const [, cerrarAction, isCerrarPending] = useActionState(
    async (prevState: CajaActionState, formData: FormData) => {
      const res = await cerrarTurnoAction(prevState, formData);
      if (res.success) {
        toast.success("Turno cerrado. Arqueo guardado.");
        notifyCajaChanged();
        router.refresh();
        onOpenChange(false);
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    { error: null, success: false },
  );

  const mostrarCierre = isCajaAbierta && turno;

  // Acciones secundarias: nunca compiten con abrir/cerrar turno, que es a lo
  // que se entra a este modal. Cierran este diálogo ANTES de abrir el otro —
  // dos Dialog anidados de Radix se pelean el foco y el scroll-lock.
  //
  // El gasto es plata que sale del cajón sin ser una venta: por eso vive acá,
  // además de su acceso propio en /caja. El cobro de cuenta corriente NO va
  // acá a propósito: tiene su lugar en el POS y en Clientes, y desde el
  // navbar solo agregaba un tercer camino a lo mismo.
  const accionesSecundarias = (
    <div className="flex flex-col gap-1 border-t border-border px-6 py-3">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          onOpenChange(false);
          onAnotarGasto();
        }}
        className="h-9 w-full justify-center text-muted-foreground"
      >
        <TrendingDown className="mr-2 h-4 w-4" />
        Anotar gasto
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          onOpenChange(false);
          router.push("/caja?vista=dinero&accion=transferir");
        }}
        className="h-9 w-full justify-center text-muted-foreground"
      >
        <Repeat2 className="mr-2 h-4 w-4" />
        Mover dinero entre cuentas
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] p-0 overflow-hidden border-border">
        {mostrarCierre ? (
          <>
            <DialogHeader className="p-6 pb-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <Unlock className="h-4 w-4 text-success" />
                Turno abierto
              </DialogTitle>
              <DialogDescription className="sr-only">
                Resumen del turno de caja actual y cierre rápido.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 pb-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Efectivo esperado ahora
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {formatearMoneda(turno.montoActual)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fondo inicial</span>
                <span className="font-mono font-medium text-foreground">
                  {formatearMoneda(turno.monto_inicial)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Apertura
                </span>
                <span className="font-medium text-foreground">
                  {new Date(turno.fecha_apertura).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {modoCaja === "UNICA" && turno.vendedor_id !== userId && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Abierta por</span>
                  <span className="font-medium text-foreground">
                    {turno.vendedor_nombre || "Otro usuario"}
                  </span>
                </div>
              )}
            </div>

            <form
              action={cerrarAction}
              className="space-y-4 border-t border-border p-6 pt-4"
            >
              <input type="hidden" name="turno_id" value={turno.id} />
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Efectivo real en cajón
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
                    $
                  </span>
                  <Input
                    name="monto_final"
                    type="number"
                    min="0"
                    required
                    className="h-11 pl-8 font-mono"
                    placeholder="Ej: 5000"
                  />
                </div>
              </div>
              <AvisoVentasPendientes />

              <Button
                type="submit"
                disabled={isCerrarPending || ventasSinSubir}
                className="h-11 w-full"
              >
                {isCerrarPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                Cerrar turno
              </Button>
            </form>

            {accionesSecundarias}
          </>
        ) : (
          <>
            <DialogHeader className="p-6 pb-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Abrir turno
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Declará el efectivo inicial para empezar a vender.
              </DialogDescription>
            </DialogHeader>
            <form action={abrirAction} className="space-y-4 p-6 pt-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fondo inicial
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
                    $
                  </span>
                  <Input
                    name="monto_inicial"
                    type="number"
                    min="0"
                    required
                    className="h-11 pl-8 font-mono"
                    placeholder="Ej: 5000"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={isAbrirPending}
                className="h-11 w-full"
              >
                {isAbrirPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unlock className="mr-2 h-4 w-4" />
                )}
                Abrir turno
              </Button>
            </form>

            {accionesSecundarias}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
