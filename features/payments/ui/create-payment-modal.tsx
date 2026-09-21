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
  DialogTrigger,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  CreditCard,
  Plus,
  Percent,
  Clock,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { createPaymentAction } from "../actions/manage-payment";
import { toast } from "sonner";
import { TipoMetodo } from "@/entities/payments/types";
import { SelectorCuentaDestino } from "./selector-cuenta-destino";
import {
  requiereCuentaDestino,
  validarCuentaDestino,
} from "../lib/cuenta-destino-metodo";

export function CreatePaymentModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoMetodo>("BILLETERA_VIRTUAL");
  const [cuentaDestinoId, setCuentaDestinoId] = useState("");

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setTipo("BILLETERA_VIRTUAL");
      setCuentaDestinoId("");
    }
  };

  const [, formAction, isPending] = useActionState(
    async (previousState: any, formData: FormData) => {
      formData.append("tipo", tipo);
      formData.append("cuenta_destino_id", cuentaDestinoId);

      // El mismo chequeo que corre la action. Acá para no ir al server a
      // buscar un error que ya se sabe; allá porque un server action es un
      // endpoint y el botón deshabilitado no es una validación.
      const faltaCuenta = validarCuentaDestino(tipo, cuentaDestinoId);
      if (faltaCuenta) {
        toast.error(faltaCuenta);
        return { error: faltaCuenta, success: false };
      }

      const result = await createPaymentAction(previousState, formData);

      if (result.success) {
        toast.success("Método de pago creado correctamente.");
        setIsOpen(false);
        setTipo("BILLETERA_VIRTUAL");
        setCuentaDestinoId("");
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    { error: null, success: false },
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-none">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Método
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Configurar Método de Pago
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-5 pt-4">
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre a mostrar en caja</Label>
            <Input
              id="nombre"
              name="nombre"
              placeholder="Ej: Mercado Pago QR, MODO..."
              required
              className="rounded-lg shadow-none"
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Pago</Label>
            <Select
              value={tipo}
              onValueChange={(val) => {
                setTipo(val as TipoMetodo);
                setCuentaDestinoId("");
              }}
            >
              <SelectTrigger className="rounded-lg shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                <SelectItem value="TRANSFERENCIA">
                  Transferencia Bancaria
                </SelectItem>
                <SelectItem value="BILLETERA_VIRTUAL">
                  Billetera Virtual
                </SelectItem>
                <SelectItem value="TARJETA">
                  Tarjeta (Débito/Crédito)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Pegado al tipo, porque la cuenta depende de él: cambiar el tipo
              limpia la elección. */}
          <SelectorCuentaDestino
            tipo={tipo}
            valor={cuentaDestinoId}
            onChange={setCuentaDestinoId}
          />

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
              defaultValue="0"
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
                defaultValue="0"
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
                defaultValue="0"
                required
                className="rounded-lg shadow-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
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
              Guardar Método
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
