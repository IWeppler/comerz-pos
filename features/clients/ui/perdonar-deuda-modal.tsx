"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HandCoins, Loader2 } from "lucide-react";
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
import { Cliente } from "@/entities/clientes/type";
import { perdonarDeudaAction } from "../actions/manage-clients";
import { validarPerdonDeuda } from "../lib/validar-perdon-deuda";
import { queryKeys } from "@/shared/lib/query-keys";
import { formatearMoneda } from "@/shared/utils/formatters";

interface PerdonarDeudaModalProps {
  cliente: Cliente | null;
  onClose: () => void;
}

/**
 * Perdonar una deuda: baja el saldo del cliente SIN registrar un cobro.
 *
 * La distinción es el motivo por el que este modal existe y no alcanzaba con
 * "registrar pago": un pago mete plata en la caja, y acá no entró plata. Usar
 * el cobro para bajar un saldo perdonado rompe el arqueo del turno.
 *
 * Arranca con el saldo completo cargado porque el caso normal es perdonar todo
 * (un recargo por mora que se decide no cobrar), pero se puede editar para
 * perdonar una parte.
 */
export function PerdonarDeudaModal({
  cliente,
  onClose,
}: Readonly<PerdonarDeudaModalProps>) {
  const saldo = Number(cliente?.saldo_pendiente || 0);
  const [monto, setMonto] = useState(String(saldo));
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  if (!cliente) return null;

  // La MISMA validación que corre el server, para avisar antes de mandar. El
  // server la vuelve a correr contra el saldo real: un formulario no es un
  // control de acceso.
  const validacion = validarPerdonDeuda(
    { monto: Number(monto), motivo },
    saldo,
  );
  const restante = validacion.ok ? validacion.saldoFinal : saldo;

  const confirmar = () => {
    if (!validacion.ok) {
      toast.error(validacion.error);
      return;
    }

    startTransition(async () => {
      const result = await perdonarDeudaAction(cliente.id, {
        monto: validacion.monto,
        motivo: validacion.motivo,
      });

      if (result.success) {
        toast.success(
          restante === 0
            ? `Se perdonó la deuda de ${cliente.nombre}.`
            : `Se perdonaron ${formatearMoneda(validacion.monto)} de la deuda.`,
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(cliente.id),
        });
        onClose();
      } else {
        toast.error(result.error || "No se pudo perdonar la deuda.");
      }
    });
  };

  return (
    <Dialog open={cliente !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-warning" />
            Perdonar deuda
          </DialogTitle>
          <DialogDescription>
            Baja la deuda de {cliente.nombre} sin registrar un cobro. No entra
            plata a la caja: queda anotado en su cuenta como deuda perdonada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Debe hoy</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatearMoneda(saldo)}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="monto-perdon" className="text-xs">
              Cuánto perdonar
            </Label>
            <Input
              id="monto-perdon"
              type="number"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-[11px] text-muted-foreground">
              {restante > 0
                ? `Le va a quedar ${formatearMoneda(restante)} de deuda.`
                : "Le va a quedar la cuenta en cero."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-perdon" className="text-xs">
              Motivo
            </Label>
            <Input
              id="motivo-perdon"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se le perdona el recargo por mora"
              maxLength={120}
            />
            <p className="text-[11px] text-muted-foreground">
              Queda en el historial: es lo que va a explicar dentro de seis
              meses por qué bajó el saldo sin que entrara plata.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={isPending || !validacion.ok}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Perdonar deuda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
