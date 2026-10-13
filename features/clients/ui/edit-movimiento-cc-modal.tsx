"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { CuentaCorrienteMovimiento } from "@/entities/clientes/type";
import { editarMovimientoManualAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";

interface EditMovimientoCCModalProps {
  /** Solo se monta mientras el modal está abierto (ver movimiento-cc-card.tsx)
   * — así el form arranca siempre con los valores actuales del movimiento,
   * sin necesitar un efecto que resincronice estado desde una prop. */
  mov: CuentaCorrienteMovimiento;
  onClose: () => void;
  onSaved: () => void;
}

function hoyIso(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

/** Extrae la nota que escribió la dueña de la descripción armada en la
 * carga original ("Saldo inicial (deuda del DD/MM/AAAA): <nota>"). Si no
 * matchea ese formato (movimientos viejos o importados por CSV), el campo
 * arranca vacío en vez de mostrar el texto crudo. */
function extraerNota(descripcion: string | null | undefined): string {
  if (!descripcion) return "";
  const match = descripcion.match(/^Saldo inicial \([^)]*\): (.+)$/);
  return match ? match[1] : "";
}

export function EditMovimientoCCModal({
  mov,
  onClose,
  onSaved,
}: Readonly<EditMovimientoCCModalProps>) {
  const [isPending, startTransition] = useTransition();
  const [fecha, setFecha] = useState(() => mov.fecha_origen || hoyIso());
  const [monto, setMonto] = useState(() => String(mov.monto));
  const [nota, setNota] = useState(() => extraerNota(mov.descripcion));
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const montoNum = Number(monto);
    if (!monto || isNaN(montoNum) || montoNum <= 0) {
      setError("Ingresá un monto mayor a $0.");
      return;
    }
    if (!fecha) {
      setError("Elegí una fecha.");
      return;
    }
    if (fecha > hoyIso()) {
      setError("No podés cargar una fecha futura.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await editarMovimientoManualAction(mov.id, {
        fecha,
        monto: montoNum,
        nota,
      });

      if (result.success) {
        toast.success("Movimiento actualizado.");
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(mov.cliente_id),
        });
        onSaved();
      } else {
        toast.error(result.error || "No se pudo actualizar el movimiento.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px] border-border bg-card">
        <DialogHeader>
          <DialogTitle>Editar movimiento</DialogTitle>
          <DialogDescription>
            Corregí la fecha, el monto o la nota de esta carga de saldo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="edit-mov-fecha" className="text-xs font-bold">
                Fecha
              </Label>
              <DatePickerAR
                id="edit-mov-fecha"
                value={fecha}
                max={hoyIso()}
                onChange={setFecha}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-mov-monto" className="text-xs font-bold">
                Monto
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  id="edit-mov-monto"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  disabled={isPending}
                  className="pl-6 h-10 shadow-none text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-mov-nota" className="text-xs font-bold">
              Nota (opcional)
            </Label>
            <Input
              id="edit-mov-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              disabled={isPending}
              className="h-10 shadow-none text-sm"
            />
          </div>

          {error && (
            <p className="text-xs font-medium text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
