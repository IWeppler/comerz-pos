"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  registrarPagoAction,
  type ResultadoAccion,
} from "@/features/admin/actions/acciones-comercio";
import {
  calcularPeriodoPago,
  type ModalidadPago,
} from "@/features/admin/lib/periodo-pago";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";
import { SelectSimple } from "./select-simple";
import { formatearMoneda } from "@/shared/utils/formatters";

const estadoInicial: ResultadoAccion = { error: null, success: false };

const MEDIOS = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "mercadopago", etiqueta: "Mercado Pago" },
  { valor: "otro", etiqueta: "Otro" },
];

const MODALIDADES = [
  { valor: "mensual", etiqueta: "Mensual" },
  { valor: "semestral", etiqueta: "Semestral" },
];

/**
 * Carga de un cobro.
 *
 * Tres datos: cuánto, cada cuánto y por qué medio. Nada más.
 *
 * Antes se pedían además la fecha del pago y el período que cubre (desde y
 * hasta, a mano). Las tres se sacaron porque el sistema ya las sabe:
 *
 * - La fecha es HOY. Un pago se registra cuando entra la plata, así que
 *   elegirla era ofrecer equivocarse en el único dato que no hace falta pedir.
 * - El período sale de la modalidad. Dos fechas para decir "un mes más" es una
 *   forma complicada de decirlo, y dejaba escribir un rango de 45 días sin que
 *   nada lo frenara.
 *
 * El período calculado se muestra abajo antes de guardar: se deduce, pero no
 * se esconde.
 */
export function RegistrarPagoModal({
  open,
  onOpenChange,
  negocioId,
  nombre,
  precioSugerido,
  vencimientoActual,
}: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  negocioId: string;
  nombre: string;
  precioSugerido: number;
  /** Para poder mostrar hasta cuándo va a quedar cubierto. */
  vencimientoActual: string | null;
}>) {
  const [modalidad, setModalidad] = useState<string>("mensual");
  const [medio, setMedio] = useState<string>("transferencia");
  const [estado, accion, enviando] = useActionState(
    registrarPagoAction,
    estadoInicial,
  );

  // Cerrar es estado derivado del resultado, así que se ajusta DURANTE el
  // render; el toast va en el efecto, que es donde corresponde un efecto.
  const [ultimoOk, setUltimoOk] = useState(false);
  if (estado.success !== ultimoOk) {
    setUltimoOk(estado.success);
    if (estado.success) onOpenChange(false);
  }

  useEffect(() => {
    if (estado.success) {
      toast.success("Pago registrado y vencimiento actualizado");
    }
  }, [estado.success]);

  // La MISMA función que usa el server para decidir el período. Si acá se
  // calculara distinto, la previsualización mentiría.
  const hoy = new Date().toISOString().slice(0, 10);
  const periodo = calcularPeriodoPago({
    hoy,
    vencimientoActual: vencimientoActual?.slice(0, 10) ?? null,
    modalidad: modalidad as ModalidadPago,
  });

  const formatearFecha = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-md ${CLASE_PORTAL_OSCURO}`}>
        <DialogTitle>Registrar pago</DialogTitle>
        <DialogDescription>{nombre}</DialogDescription>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="negocio_id" value={negocioId} />
          <input type="hidden" name="modalidad" value={modalidad} />
          <input type="hidden" name="medio" value={medio} />

          <div className="space-y-2">
            <Label htmlFor="monto">Monto pagado</Label>
            <Input
              id="monto"
              name="monto"
              type="number"
              min="0"
              step="any"
              required
              defaultValue={precioSugerido || undefined}
              className="h-10 font-mono"
            />
            {precioSugerido > 0 && (
              <p className="text-xs text-muted-foreground">
                Precio del plan: {formatearMoneda(precioSugerido)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SelectSimple
              id="modalidad"
              etiqueta="Modalidad"
              valor={modalidad}
              onChange={setModalidad}
              opciones={MODALIDADES}
            />
            <SelectSimple
              id="medio"
              etiqueta="Medio"
              valor={medio}
              onChange={setMedio}
              opciones={MEDIOS}
            />
          </div>

          {/* El período se deduce, pero se muestra: deducir un dato no es
              motivo para esconderlo, sobre todo cuando de él depende hasta
              cuándo el comercio queda habilitado. */}
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Cubre del{" "}
              <span className="font-medium text-foreground">
                {formatearFecha(periodo.desde)}
              </span>{" "}
              al{" "}
              <span className="font-medium text-foreground">
                {formatearFecha(periodo.hasta)}
              </span>
            </p>
            {vencimientoActual && periodo.desde !== hoy && (
              <p className="mt-0.5 text-muted-foreground">
                Arranca en el vencimiento actual, así pagar antes no le cuesta
                días.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nota">Nota (opcional)</Label>
            <Input id="nota" name="nota" maxLength={200} className="h-10" />
          </div>

          {estado.error && (
            <p className="text-sm text-destructive" role="alert">
              {estado.error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={enviando}>
              {enviando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Registrar"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
