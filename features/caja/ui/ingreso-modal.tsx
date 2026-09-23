"use client";

import { useEffect, useState, useActionState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { TrendingUp, Loader2 } from "lucide-react";
import type { CajaActionState } from "@/entities/caja/types";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";
import { registrarIngresoAction } from "../actions/ingresos-financieros";
import {
  DEFINICION_TIPO_INGRESO,
  TIPOS_INGRESO,
  type TipoIngreso,
} from "../lib/tipo-ingreso";

/**
 * Registrar plata que entra sin venir de una venta. Espejo de `EgresoModal`
 * con la misma regla de cuenta: elegirla es opcional, y sin elegir la decide
 * la base (con turno abierto → Caja diaria, sin turno → Caja general).
 *
 * El tipo es obligatorio y sin default: la diferencia entre "aporte" y
 * "otro ingreso" es si suma a la ganancia o no, y un default acá es la
 * decisión que se guarda cuando nadie mira.
 */

interface IngresoModalProps {
  /** Controlado desde afuera (el modal de caja lo abre sin trigger propio,
   * igual que al egreso). Sin esta prop el modal se maneja solo. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** false cuando quien abre el modal es otro control (ver CajaStatusButton). */
  mostrarTrigger?: boolean;
  triggerClassName?: string;
  triggerVariant?: "ghost" | "outline" | "secondary";
}

const CUENTA_POR_DEFECTO = "__default__";
const SIN_TIPO = "";

export function IngresoModal({
  open,
  onOpenChange,
  mostrarTrigger = true,
  triggerClassName,
  triggerVariant = "outline",
}: Readonly<IngresoModalProps> = {}) {
  const [isOpenInterno, setIsOpenInterno] = useState(false);
  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : isOpenInterno;
  const setIsOpen = (valor: boolean) => {
    if (!esControlado) setIsOpenInterno(valor);
    onOpenChange?.(valor);
  };
  const [tipo, setTipo] = useState<TipoIngreso | "">(SIN_TIPO);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  const [cuentaId, setCuentaId] = useState("");

  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);

  useEffect(() => {
    if (!isOpen || cuentas !== null) return;
    let cancelado = false;
    getCuentasFinancierasAction().then((data) => {
      if (cancelado) return;
      setCuentas(data.filter((cuenta) => cuenta.codigo !== "POR_ACREDITAR"));
    });
    return () => {
      cancelado = true;
    };
  }, [isOpen, cuentas]);

  const [, formAction, isPending] = useActionState(
    async (prevState: CajaActionState, formData: FormData) => {
      const result = await registrarIngresoAction(prevState, formData);
      if (result.success) {
        toast.success("Ingreso registrado");
        setTipo(SIN_TIPO);
        setCuentaId("");
        setIsOpen(false);
      } else {
        toast.error(result.error || "Ocurrió un error");
      }
      return result;
    },
    { error: null, success: false },
  );

  const definicion = tipo ? DEFINICION_TIPO_INGRESO[tipo] : null;
  const nombreCuentaPorDefecto =
    isCajaAbierta === null
      ? null
      : isCajaAbierta
        ? "Caja diaria (tu turno abierto)"
        : "Caja general (sin turno abierto)";

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {mostrarTrigger && (
        <DialogTrigger asChild>
          <Button
            variant={triggerVariant}
            className={triggerClassName}
            aria-label="Anotar ingreso"
          >
            <TrendingUp className="h-4 w-4" />
            <span>Anotar Ingreso</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Ingreso</DialogTitle>
          <DialogDescription>
            Plata que entra y NO es una venta ni un cobro de deuda: un aporte,
            un préstamo, otro ingreso. Elegir la cuenta es opcional: con turno
            abierto entra a Caja diaria y suma al arqueo; sin turno, a Caja
            general.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="cuenta-destino-ingreso">Entra a (opcional)</Label>
            <input type="hidden" name="cuenta_destino_id" value={cuentaId} />
            <Select
              value={cuentaId || CUENTA_POR_DEFECTO}
              onValueChange={(v) =>
                setCuentaId(v === CUENTA_POR_DEFECTO ? "" : v)
              }
              disabled={!cuentas?.length}
            >
              <SelectTrigger id="cuenta-destino-ingreso" className="w-full">
                <SelectValue placeholder="Cargando cuentas..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUENTA_POR_DEFECTO}>
                  {nombreCuentaPorDefecto ?? "La que corresponda (por defecto)"}
                </SelectItem>
                {(cuentas ?? []).map((cuenta) => (
                  <SelectItem key={cuenta.id} value={cuenta.id}>
                    {cuenta.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tipo-ingreso">Tipo de ingreso</Label>
            {/* El name va en un input oculto: el Select de Radix no es un
                control nativo y no participa del FormData por su cuenta. */}
            <input type="hidden" name="tipo" value={tipo} />
            <Select
              value={tipo || undefined}
              onValueChange={(v) => setTipo(v as TipoIngreso)}
            >
              <SelectTrigger id="tipo-ingreso" className="w-full">
                <SelectValue placeholder="Elegí qué tipo de ingreso es" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INGRESO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DEFINICION_TIPO_INGRESO[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {definicion && (
              <p className="text-[11px] text-muted-foreground">
                {definicion.descripcion}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="concepto-ingreso">Concepto / De dónde viene</Label>
            <Input
              id="concepto-ingreso"
              name="concepto"
              placeholder={
                tipo === "APORTE_SOCIO"
                  ? "Ej: Aporte para comprar mercadería"
                  : tipo === "PRESTAMO"
                    ? "Ej: Préstamo de Juan, a devolver en octubre"
                    : "Ej: Alquiler del local de al lado"
              }
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="monto-ingreso">Monto</Label>
            <Input
              id="monto-ingreso"
              name="monto"
              type="number"
              min="1"
              step="any"
              placeholder="Ej: 150000"
              required
            />
          </div>

          {definicion && !definicion.afectaResultado && (
            <p className="text-[11px] text-warning">
              Suma dinero a la cuenta elegida, pero NO cuenta como ganancia.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !tipo}>
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar Ingreso
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
