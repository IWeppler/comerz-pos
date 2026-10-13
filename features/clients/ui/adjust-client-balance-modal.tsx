"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, PlusCircle, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DatePickerAR } from "@/shared/components/date-picker-ar";
import { Cliente } from "@/entities/clientes/type";
import { ajustarSaldoAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";
import { formatearMoneda } from "@/shared/utils/formatters";

interface AdjustClientBalanceModalProps {
  cliente: Cliente | null;
  onClose: () => void;
}

interface FilaEntrada {
  id: string;
  fecha: string;
  monto: string;
  nota: string;
}

function hoyIso(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

function nuevaFila(): FilaEntrada {
  return {
    id: crypto.randomUUID(),
    fecha: hoyIso(),
    monto: "",
    nota: "",
  };
}

export function AdjustClientBalanceModal({
  cliente,
  onClose,
}: Readonly<AdjustClientBalanceModalProps>) {
  const [isPending, startTransition] = useTransition();
  const [entradas, setEntradas] = useState<FilaEntrada[]>([nuevaFila()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const resetForm = () => {
    setEntradas([nuevaFila()]);
    setErrores({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const actualizarFila = (
    id: string,
    campo: "fecha" | "monto" | "nota",
    valor: string,
  ) => {
    setEntradas((prev) =>
      prev.map((fila) => (fila.id === id ? { ...fila, [campo]: valor } : fila)),
    );
  };

  const agregarFila = () => {
    setEntradas((prev) => [...prev, nuevaFila()]);
  };

  const quitarFila = (id: string) => {
    setEntradas((prev) =>
      prev.length > 1 ? prev.filter((fila) => fila.id !== id) : prev,
    );
  };

  const totalACargar = entradas.reduce(
    (acc, fila) => acc + (Number(fila.monto) || 0),
    0,
  );

  const validar = (): boolean => {
    const hoy = hoyIso();
    const nuevosErrores: Record<string, string> = {};

    for (const fila of entradas) {
      const monto = Number(fila.monto);
      if (!fila.monto || isNaN(monto) || monto <= 0) {
        nuevosErrores[fila.id] = "Ingresá un monto mayor a $0.";
        continue;
      }
      if (!fila.fecha) {
        nuevosErrores[fila.id] = "Elegí una fecha.";
        continue;
      }
      if (fila.fecha > hoy) {
        nuevosErrores[fila.id] = "No podés cargar una fecha futura.";
      }
    }

    setErrores(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  };

  const handleSubmit = () => {
    if (!cliente) return;
    if (!validar()) {
      toast.error("Revisá los datos marcados en rojo antes de continuar.");
      return;
    }

    startTransition(async () => {
      const result = await ajustarSaldoAction(
        cliente.id,
        entradas.map((fila) => ({
          fecha: fila.fecha,
          monto: Number(fila.monto),
          nota: fila.nota,
        })),
      );

      if (result.success) {
        toast.success(
          entradas.length === 1
            ? "Deuda cargada exitosamente."
            : `${entradas.length} entradas de deuda cargadas exitosamente.`,
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(cliente.id),
        });
        resetForm();
        onClose();
      } else {
        toast.error(result.error || "No se pudo cargar la deuda.");
      }
    });
  };

  return (
    <Dialog open={!!cliente} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[460px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-warning" /> Cargar Saldo
            Inicial
          </DialogTitle>
          <DialogDescription>
            Cargá deuda anterior al sistema para{" "}
            <strong className="text-foreground">{cliente?.nombre}</strong> — una
            fila por cada fecha con su propio monto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2 max-h-[55vh] overflow-y-auto pr-1">
          {entradas.map((fila, index) => (
            <div
              key={fila.id}
              className="space-y-2 rounded-lg border border-border p-3 bg-muted/20 relative"
            >
              {entradas.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => quitarFila(fila.id)}
                  disabled={isPending}
                  aria-label="Quitar esta fecha"
                  className="absolute top-1 right-1 h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}

              <div className="grid grid-cols-2 gap-2 pr-8">
                <div className="space-y-1">
                  <Label
                    htmlFor={`fecha-${fila.id}`}
                    className="text-[11px] font-bold text-muted-foreground"
                  >
                    Fecha
                  </Label>
                  <DatePickerAR
                    id={`fecha-${fila.id}`}
                    value={fila.fecha}
                    max={hoyIso()}
                    onChange={(valor) =>
                      actualizarFila(fila.id, "fecha", valor)
                    }
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-1">
                  <Label
                    htmlFor={`monto-${fila.id}`}
                    className="text-[11px] font-bold text-muted-foreground"
                  >
                    Monto
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <Input
                      id={`monto-${fila.id}`}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="Ej: 15000"
                      value={fila.monto}
                      onChange={(e) =>
                        actualizarFila(fila.id, "monto", e.target.value)
                      }
                      disabled={isPending}
                      className="pl-6 h-10 shadow-none text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor={`nota-${fila.id}`}
                  className="text-[11px] font-bold text-muted-foreground"
                >
                  Nota (opcional)
                </Label>
                <Input
                  id={`nota-${fila.id}`}
                  placeholder={
                    index === 0 ? "Ej: Compra de indumentaria" : undefined
                  }
                  value={fila.nota}
                  onChange={(e) =>
                    actualizarFila(fila.id, "nota", e.target.value)
                  }
                  disabled={isPending}
                  className="h-10 shadow-none text-sm"
                />
              </div>

              {errores[fila.id] && (
                <p className="text-xs font-medium text-destructive">
                  {errores[fila.id]}
                </p>
              )}
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={agregarFila}
          disabled={isPending}
          className="w-full h-10 border-dashed shadow-none"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Agregar otra fecha
        </Button>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 border-t border-border mt-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Total a cargar
          </span>
          <span className="text-lg font-bold text-foreground">
            {formatearMoneda(totalACargar)}
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            className="bg-warning text-white hover:bg-warning/80"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Registrar Deuda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
