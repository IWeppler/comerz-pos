"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CreditCard, Percent, Clock, Loader2, TrendingUp } from "lucide-react";
import { editPaymentAction } from "../actions/manage-payment";
import { toast } from "sonner";
import { MetodoPago } from "@/entities/payments/types";
import { getCuentasFinancierasAction, type CuentaFinanciera } from "@/features/caja/actions/cuentas-financieras";

const SIN_CUENTA = "sin-cuenta";

export function EditPaymentModal({
  pago,
  open,
  onOpenChange,
}: {
  pago: MetodoPago;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [cuentaDestinoId, setCuentaDestinoId] = useState(pago.cuenta_destino_id ?? SIN_CUENTA);
  useEffect(() => {
    if (!open) return;
    setCuentaDestinoId(pago.cuenta_destino_id ?? SIN_CUENTA);
    getCuentasFinancierasAction().then((data) => setCuentas(data.filter((c) => c.codigo !== "POR_ACREDITAR")));
  }, [open, pago.cuenta_destino_id]);
  const [, formAction, isPending] = useActionState(
    async (
      previousState: { error: string | null; success: boolean },
      formData: FormData,
    ) => {
      formData.append("id", pago.id);
      const result = await editPaymentAction(previousState, formData);

      if (result.success) {
        toast.success("Método actualizado correctamente.");
        onOpenChange(false);
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    { error: null, success: false },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Editar Método de Pago
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-5 pt-4">
          <input type="hidden" name="cuenta_destino_id" value={cuentaDestinoId === SIN_CUENTA ? "" : cuentaDestinoId} />
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre a mostrar en caja</Label>
            <Input
              id="nombre"
              name="nombre"
              defaultValue={pago.nombre}
              required
              className="rounded-lg shadow-none"
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Pago</Label>
            <Select name="tipo" defaultValue={pago.tipo}>
              <SelectTrigger className="rounded-lg shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EFECTIVO">Efectivo / Cash</SelectItem>
                <SelectItem value="TRANSFERENCIA">
                  Transferencia Bancaria
                </SelectItem>
                <SelectItem value="BILLETERA_VIRTUAL">
                  Billetera Virtual (MP, MODO)
                </SelectItem>
                <SelectItem value="TARJETA">
                  Tarjeta (Débito/Crédito)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <Label className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-warning" />
              Recargo al cliente (%)
            </Label>
            <Input
              name="recargo_porcentaje"
              type="number"
              min="0"
              max="100"
              step="any"
              defaultValue={pago.recargo_porcentaje ?? 0}
              required
              className="rounded-lg shadow-none bg-card"
            />
            <p className="text-[10px] text-muted-foreground leading-tight">
              Se le SUMA al total del ticket cuando el cliente paga con este
              método (0 = sin recargo). Distinto de la comisión de abajo, que
              es lo que te cobra el procesador y no se le muestra al cliente.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                Comisión (%)
              </Label>
              <Input
                name="comision"
                type="number"
                min="0"
                step="any"
                defaultValue={pago.comision}
                required
                className="rounded-lg shadow-none"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                Acreditación (Días)
              </Label>
              <Input
                name="acreditacion_dias"
                type="number"
                min="0"
                defaultValue={pago.acreditacion_dias}
                required
                className="rounded-lg shadow-none"
              />
              <p className="text-[10px] text-muted-foreground leading-tight">
                0 = Inmediata
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cuenta donde acredita</Label>
            <Select value={cuentaDestinoId} onValueChange={setCuentaDestinoId}>
              <SelectTrigger className="rounded-lg shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA}>Sin configurar todavía</SelectItem>
                {cuentas.map((cuenta) => <SelectItem key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Los cobros diferidos quedan primero en Por acreditar y se liquidan después a esta cuenta.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="cursor-pointer"
              disabled={isPending}
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Actualizar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
