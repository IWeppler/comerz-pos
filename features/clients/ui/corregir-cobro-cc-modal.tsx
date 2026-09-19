"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MetodoPago } from "@/entities/payments/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import { corregirCobroCCAction } from "../actions/corregir-cobro-cc";

const pesos = (monto: number) => `$${Math.round(monto).toLocaleString("es-AR")}`;

export function CorregirCobroCCModal({
  pagoId,
  metodoActualId,
  metodoActualNombre,
  montoBase,
  totalActual,
  recargoActual,
  turnoCerrado,
  metodosPago,
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  pagoId: string;
  metodoActualId?: string | null;
  metodoActualNombre: string;
  montoBase: number;
  totalActual: number;
  recargoActual: number;
  turnoCerrado: boolean;
  metodosPago: MetodoPago[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}>) {
  const [elegido, setElegido] = useState<MetodoPago | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, iniciar] = useTransition();
  const metodos = metodosPago.filter(
    (metodo) => metodo.activo && metodo.id !== metodoActualId,
  );
  const recargoNuevo = elegido
    ? calcularRecargoMonto(montoBase, elegido.recargo_porcentaje)
    : 0;
  const totalNuevo = totalActual - recargoActual + recargoNuevo;
  const diferencia = totalNuevo - totalActual;

  const confirmar = () => {
    if (!elegido) return;

    iniciar(async () => {
      const { data, error } = await corregirCobroCCAction(
        pagoId,
        elegido.id,
        motivo,
      );
      if (error || !data) {
        toast.error(error ?? "No se pudo corregir el cobro.");
        return;
      }

      onOpenChange(false);
      setElegido(null);
      setMotivo("");
      onSaved();

      toast.success(`Cobro corregido a ${data.metodoNuevo}.`, {
        description: data.turnoCerrado
          ? "El cierre histórico se conserva y la corrección quedó auditada."
          : "La caja abierta se actualizó automáticamente.",
      });

      if (data.diferenciaTotal !== 0) {
        toast.warning(
          data.diferenciaTotal > 0
            ? `Falta cobrar ${pesos(data.diferenciaTotal)} por el recargo del método nuevo.`
            : `Hay que devolver ${pesos(-data.diferenciaTotal)} por la diferencia de recargo.`,
          { duration: Infinity, closeButton: true },
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir medio de pago</DialogTitle>
          <DialogDescription>
            Este pago a cuenta figura como{" "}
            <strong className="text-foreground">{metodoActualNombre}</strong>.
            Elegí cómo se cobró en realidad. La deuda abonada no cambia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {turnoCerrado && (
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                La caja ya cerró. El arqueo firmado no se reescribe: se guarda
                esta corrección aparte y los reportes pasan a usar el medio real.
              </p>
            </div>
          )}

          {metodos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay otros métodos de pago activos para elegir.
            </p>
          ) : (
            <div className="grid gap-1.5">
              {metodos.map((metodo) => {
                const activo = elegido?.id === metodo.id;
                return (
                  <button
                    key={metodo.id}
                    type="button"
                    onClick={() => setElegido(metodo)}
                    aria-pressed={activo}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      activo
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="truncate text-sm font-medium">
                      {metodo.nombre}
                    </span>
                    {metodo.recargo_porcentaje > 0 && (
                      <span className="shrink-0 text-xs font-medium text-warning">
                        +{metodo.recargo_porcentaje}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {elegido && (
            <div className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Cobro actual</span>
                <span className="font-medium">{pesos(totalActual)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Cobro corregido</span>
                <span className="font-medium">{pesos(totalNuevo)}</span>
              </div>
              {diferencia !== 0 && (
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-warning">
                  <span>{diferencia > 0 ? "Falta cobrar" : "Hay que devolver"}</span>
                  <span>{pesos(Math.abs(diferencia))}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`motivo-cobro-${pagoId}`} className="text-xs">
              Motivo <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id={`motivo-cobro-${pagoId}`}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ej: era débito, no efectivo"
            />
          </div>

          <Button
            type="button"
            className="h-11 w-full"
            disabled={!elegido || enviando}
            onClick={confirmar}
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Corregir cobro"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
