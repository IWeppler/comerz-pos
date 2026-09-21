"use client";

import { useActionState, useState } from "react";
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
import { MetodoPago, TipoMetodo } from "@/entities/payments/types";
import { SelectorCuentaDestino } from "./selector-cuenta-destino";
import {
  requiereCuentaDestino,
  validarCuentaDestino,
} from "../lib/cuenta-destino-metodo";

export function EditPaymentModal({
  pago,
  open,
  onOpenChange,
}: {
  pago: MetodoPago;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [cuentaDestinoId, setCuentaDestinoId] = useState(
    pago.cuenta_destino_id ?? "",
  );
  // El tipo pasa a ser estado porque de él depende si hace falta la cuenta y
  // qué tipo de cuenta se sugiere al crear una.
  const [tipo, setTipo] = useState<TipoMetodo>(pago.tipo);

  // Sin `useEffect` de sincronización a propósito: `payments-panel.tsx` monta
  // este modal con `{editingPayment && <EditPaymentModal …/>}`, así que se
  // desmonta al cerrar y los `useState` de arriba ya arrancan con el método
  // correcto en cada apertura. El efecto que había antes existía solo para
  // cargar las cuentas, y eso ahora vive adentro de `SelectorCuentaDestino`.

  const [, formAction, isPending] = useActionState(
    async (
      previousState: { error: string | null; success: boolean },
      formData: FormData,
    ) => {
      formData.append("id", pago.id);

      const faltaCuenta = validarCuentaDestino(tipo, cuentaDestinoId);
      if (faltaCuenta) {
        toast.error(faltaCuenta);
        return { error: faltaCuenta, success: false };
      }

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
          <input type="hidden" name="cuenta_destino_id" value={cuentaDestinoId} />
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
            <Select
              name="tipo"
              value={tipo}
              onValueChange={(val) => {
                setTipo(val as TipoMetodo);
                // Cambiar el tipo invalida la cuenta: la de un banco no es la
                // misma decision que la de una billetera. La base hace lo
                // mismo en asignar_cuenta_financiera_actual.
                setCuentaDestinoId("");
              }}
            >
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

          {/* Ya no existe "sin configurar": un metodo digital sin cuenta
              manda sus cobros al puente y no salen. Ver
              `cuenta-destino-metodo.ts`. */}
          <SelectorCuentaDestino
            tipo={tipo}
            valor={cuentaDestinoId}
            onChange={setCuentaDestinoId}
          />

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
              disabled={
                isPending || (requiereCuentaDestino(tipo) && !cuentaDestinoId)
              }
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
