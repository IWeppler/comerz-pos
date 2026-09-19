"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  CreditCard,
  Edit2,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { CuentaCorrienteMovimiento } from "@/entities/clientes/type";
import { MetodoPago } from "@/entities/payments/types";
import { getSupabaseRelation } from "@/entities/ventas/types";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";
import { anularMovimientoManualAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";
import { EditMovimientoCCModal } from "./edit-movimiento-cc-modal";
import { CorregirCobroCCModal } from "./corregir-cobro-cc-modal";

interface MovimientoCCCardProps {
  mov: CuentaCorrienteMovimiento;
  isAdmin: boolean;
  puedeCorregirCobro: boolean;
  metodosPago: MetodoPago[];
}

export function MovimientoCCCard({
  mov,
  isAdmin,
  puedeCorregirCobro,
  metodosPago,
}: Readonly<MovimientoCCCardProps>) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCorregirOpen, setIsCorregirOpen] = useState(false);
  const [isAnularConfirmOpen, setIsAnularConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  // Discriminador real manual-vs-sistema: un movimiento generado por una
  // venta o un cobro siempre trae venta_id o pago_id seteado.
  const esManual = !mov.venta_id && !mov.pago_id;
  const puedeGestionar = isAdmin && esManual && !mov.anulado;
  const pago = getSupabaseRelation(mov.pago);
  const turno = getSupabaseRelation(pago?.turno);
  const puedeCorregir =
    puedeCorregirCobro &&
    !mov.anulado &&
    mov.tipo === "CREDITO" &&
    pago?.estado_pago_operacion === "CONFIRMADO" &&
    (turno?.estado !== "CERRADO" || isAdmin);
  const mostrarMenu = puedeGestionar || puedeCorregir;

  const fechaMostrada = mov.fecha_origen
    ? new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(mov.fecha_origen))
    : formatearFechaHora(mov.creado_en);

  const handleAnular = () => {
    startTransition(async () => {
      const result = await anularMovimientoManualAction(mov.id);
      if (result.success) {
        toast.success("Movimiento anulado.");
        setIsAnularConfirmOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(mov.cliente_id),
        });
      } else {
        toast.error(result.error || "No se pudo anular el movimiento.");
      }
    });
  };

  return (
    <>
      <div
        className={`flex items-center justify-between p-2 bg-background border border-border rounded-lg ${
          mov.anulado ? "opacity-50" : ""
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`shrink-0 ${mov.tipo === "DEBITO" ? "text-danger" : "text-success"}`}
          >
            {mov.tipo === "DEBITO" ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                className={`text-sm font-semibold text-foreground truncate ${mov.anulado ? "line-through" : ""}`}
              >
                {mov.descripcion ||
                  (mov.tipo === "DEBITO"
                    ? "Cargo por Compra"
                    : "Abono a Cuenta")}
              </p>
              {mov.anulado && (
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground border-border text-[9px] uppercase font-bold tracking-wider shrink-0"
                >
                  Anulado
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs text-muted-foreground mt-0.5">
                {fechaMostrada}
              </p>
              <span
                className={`font-mono font-medium ${
                  mov.anulado
                    ? "line-through text-muted-foreground"
                    : mov.tipo === "DEBITO"
                      ? "text-danger"
                      : "text-success"
                }`}
              >
                {mov.tipo === "DEBITO" ? "+" : "-"}
                {formatearMoneda(Number(mov.monto))}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {mostrarMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label="Opciones del movimiento"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {puedeCorregir && (
                  <DropdownMenuItem onClick={() => setIsCorregirOpen(true)}>
                    <CreditCard className="w-3.5 h-3.5 mr-2 text-info" />
                    Corregir medio de pago
                  </DropdownMenuItem>
                )}
                {puedeGestionar && (
                  <>
                    {puedeCorregir && <DropdownMenuSeparator />}
                    <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                      <Edit2 className="w-3.5 h-3.5 mr-2 text-info" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setIsAnularConfirmOpen(true)}
                      className="text-destructive hover:bg-destructive/10 focus:text-destructive"
                    >
                      <Ban className="w-3.5 h-3.5 mr-2" />
                      Anular
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {isEditOpen && (
        <EditMovimientoCCModal
          mov={mov}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => setIsEditOpen(false)}
        />
      )}

      {pago && isCorregirOpen && (
        <CorregirCobroCCModal
          pagoId={pago.id}
          metodoActualId={pago.metodo_pago_id}
          metodoActualNombre={pago.metodo_nombre}
          montoBase={Number(pago.monto_base)}
          totalActual={Number(pago.monto_bruto)}
          recargoActual={Number(pago.recargo_monto)}
          turnoCerrado={turno?.estado === "CERRADO"}
          metodosPago={metodosPago}
          open={isCorregirOpen}
          onOpenChange={setIsCorregirOpen}
          onSaved={() => {
            queryClient.invalidateQueries({
              queryKey: queryKeys.clientes.listado,
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.clientes.detalle(mov.cliente_id),
            });
          }}
        />
      )}

      <AlertDialog
        open={isAnularConfirmOpen}
        onOpenChange={setIsAnularConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a anular {formatearMoneda(Number(mov.monto))} del{" "}
              {fechaMostrada}. Va a seguir visible en el historial marcado como
              anulado, pero deja de contar para el saldo y el vencimiento del
              cliente. Esta acción se puede revertir por soporte técnico, pero
              no desde acá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleAnular}
              disabled={isPending}
            >
              {isPending ? "Anulando..." : "Anular"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
