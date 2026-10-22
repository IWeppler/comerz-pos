"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { toast } from "@/shared/ui/toast";
import { formatearMoneda } from "@/shared/utils/formatters";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { esTurnoDeOtroDia } from "@/entities/caja/lib/turno-de-otro-dia";
import { registrarEgresoAction } from "@/features/caja/actions/caja-action";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "@/features/caja/actions/cuentas-financieras";
import { opcionesOrigenEgreso, superaCajaChica } from "@/features/caja/lib/origen-egreso";
import { definirPagoRemitoAction, getPagoRemitoAction } from "../actions/pago-remito";
import {
  conceptoPagoRemito,
  type OpcionPagoRemito,
  type RemitoResumenPago,
} from "../lib/pago-remito";
import { SelectorProveedor } from "./selector-proveedor";

interface PagoRemitoDialogProps {
  /** El remito recién aprobado. */
  ordenId: string | null;
  /** Carga inicial: el stock que se sube puede ser el que el comercio ya
   * tenía, y eso no es una compra. Se ofrece decirlo (sin marcarlo). */
  esCargaInicial?: boolean;
  /** Se cierra sin importar qué se eligió: un remito sin respuesta queda "sin
   * responder" y se puede pagar después desde Caja. */
  onClose: () => void;
}

/**
 * Después de ingresar mercadería, el gasto ya armado (docs/asistente-ia.md,
 * C1, decidido con Ignacio el 22/10/2026): el monto es el costo de lo que
 * entró, se elige de qué caja salió y se registra. Una sola pantalla, sin
 * preguntar "¿lo pagaste?".
 *
 * La mercadería ya entró: nada de esto voltea la aprobación. El gasto va en
 * otra transacción (`registrarEgresoAction`, con las reglas de caja de
 * siempre); si falla (caja cerrada, no alcanza), el remito queda a pagar, que
 * es lo que pasó. Las salidas: "Lo pago después" (pide proveedor) y, discreta,
 * "No registrar gasto" (pagado con plata que no pasa por Comerz).
 */
export function PagoRemitoDialog({ ordenId, esCargaInicial = false, onClose }: Readonly<PagoRemitoDialogProps>) {
  const [remito, setRemito] = useState<RemitoResumenPago | null>(null);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  const [monto, setMonto] = useState("");
  const [cuentaId, setCuentaId] = useState("");
  const [proveedor, setProveedor] = useState<{ id: string; nombre: string } | null>(null);
  const [guardando, setGuardando] = useState<OpcionPagoRemito | null>(null);
  const [faltaProveedor, setFaltaProveedor] = useState(false);

  const isCajaAbierta = useCajaStatusStore((s) => s.isCajaAbierta);
  const turno = useCajaStatusStore((s) => s.turno);

  useEffect(() => {
    if (!ordenId) return;
    let cancelado = false;
    Promise.all([getPagoRemitoAction(ordenId), getCuentasFinancierasAction()]).then(([r, c]) => {
      if (cancelado) return;
      setRemito(r);
      setCuentas(c);
      setMonto(r && r.saldo_pendiente > 0 ? String(r.saldo_pendiente) : "");
      setProveedor(r?.proveedor_id ? { id: r.proveedor_id, nombre: r.proveedor_nombre ?? "" } : null);
    });
    return () => {
      cancelado = true;
    };
  }, [ordenId]);

  const opciones = useMemo(
    () =>
      opcionesOrigenEgreso(cuentas ?? [], {
        abierta: Boolean(isCajaAbierta && turno),
        deOtroDia: esTurnoDeOtroDia(turno?.fecha_apertura),
        disponible: turno?.montoActual ?? null,
      }),
    [cuentas, isCajaAbierta, turno],
  );
  const origen = opciones.find((o) => o.id === cuentaId);
  const montoNumero = Number(monto);
  const excedeCajon = superaCajaChica(origen, montoNumero);

  const cerrar = () => {
    setRemito(null);
    setCuentas(null);
    setMonto("");
    setCuentaId("");
    setProveedor(null);
    setFaltaProveedor(false);
    onClose();
  };

  const declarar = async (opcion: OpcionPagoRemito) => {
    const { error } = await definirPagoRemitoAction(ordenId!, opcion, proveedor?.id ?? null);
    if (error) toast.error(error);
    return !error;
  };

  const registrarGasto = async () => {
    if (!ordenId || !remito || !origen || !(montoNumero > 0)) return;
    setGuardando("PAGAR_AHORA");
    try {
      if (!(await declarar("PAGAR_AHORA"))) return;
      const datos = new FormData();
      datos.set("concepto", conceptoPagoRemito({ nombre: remito.nombre, proveedor_nombre: proveedor?.nombre || null }));
      datos.set("monto", String(montoNumero));
      datos.set("tipo", "COMPRA_MERCADERIA");
      datos.set("orden_compra_id", ordenId);
      datos.set("cuenta_origen_id", origen.id);
      const r = await registrarEgresoAction({ error: null, success: false }, datos);
      if (!r.success) {
        // La mercadería ya entró y el remito quedó "se paga desde Comerz": sin
        // el gasto, queda a pagar. Se dice, y se puede reintentar.
        toast.error(`${r.error ?? "No se pudo registrar el gasto."} El remito quedó a pagar.`);
        return;
      }
      useCajaStatusStore.getState().notifyCajaChanged();
      toast.success("Gasto de la compra registrado.");
      cerrar();
    } finally {
      setGuardando(null);
    }
  };

  const sinGasto = async (opcion: "PAGAR_DESPUES" | "PAGADO_FUERA") => {
    if (!ordenId) return;
    if (opcion === "PAGAR_DESPUES" && !proveedor) {
      setFaltaProveedor(true);
      return;
    }
    setGuardando(opcion);
    try {
      if (!(await declarar(opcion))) return;
      toast.success(
        opcion === "PAGAR_DESPUES"
          ? "Quedó a pagar. Pagalo desde Caja › Anotar gasto › Compra de mercadería."
          : "Listo, sin gasto.",
      );
      cerrar();
    } finally {
      setGuardando(null);
    }
  };

  const ocupado = guardando !== null;

  return (
    <Dialog open={ordenId !== null} onOpenChange={(abierto) => !abierto && !ocupado && cerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mercadería ingresada</DialogTitle>
          <DialogDescription>
            {remito ? `${remito.nombre}. Registrá el gasto de esta compra.` : "Registrá el gasto de esta compra."}
          </DialogDescription>
        </DialogHeader>

        {!remito || cuentas === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label htmlFor="gasto-remito-monto">Gasto de la compra</Label>
              <Input
                id="gasto-remito-monto"
                type="number"
                min="1"
                step="any"
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="h-11 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                El costo de lo que entró ({formatearMoneda(remito.valor)}). Cambialo si hubo descuento o flete.
              </p>
            </div>

            <div className="space-y-2">
              <Label id="gasto-remito-caja">¿De dónde salió la plata?</Label>
              <div role="radiogroup" aria-labelledby="gasto-remito-caja" className="grid gap-2">
                {opciones.map((o) => {
                  const elegida = o.id === cuentaId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={elegida}
                      disabled={o.deshabilitada || ocupado}
                      onClick={() => setCuentaId(o.id)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                        elegida ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{o.nombre}</span>
                        <span className="block text-xs text-muted-foreground">{o.detalle}</span>
                      </span>
                      {o.disponible !== null && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {formatearMoneda(o.disponible)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {excedeCajon && origen?.disponible != null && (
                <p role="alert" className="text-[11px] text-destructive">
                  En el cajón hay {formatearMoneda(origen.disponible)}. Si se pagó con otra plata, elegí esa caja.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gasto-remito-proveedor">Proveedor (opcional)</Label>
              <SelectorProveedor
                id="gasto-remito-proveedor"
                valor={proveedor?.id ?? null}
                onChange={(p) => {
                  setProveedor(p ? { id: p.id, nombre: p.nombre } : null);
                  if (p) setFaltaProveedor(false);
                }}
                disabled={ocupado}
              />
              {faltaProveedor && (
                <p role="alert" className="text-[11px] text-destructive">
                  Para dejarlo a pagar, elegí a qué proveedor se le debe.
                </p>
              )}
            </div>

            <Button
              type="button"
              className="h-11 w-full"
              disabled={!origen || !(montoNumero > 0) || excedeCajon || ocupado}
              onClick={() => void registrarGasto()}
            >
              {guardando === "PAGAR_AHORA" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar gasto
            </Button>

            {esCargaInicial && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full whitespace-normal"
                disabled={ocupado}
                onClick={() => void sinGasto("PAGADO_FUERA")}
              >
                Es stock que ya tenía, no fue una compra
              </Button>
            )}

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-sm">
              <button
                type="button"
                className="min-h-11 text-primary underline-offset-2 hover:underline disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void sinGasto("PAGAR_DESPUES")}
              >
                {guardando === "PAGAR_DESPUES" ? "Guardando…" : "Lo pago después"}
              </button>
              <button
                type="button"
                className="min-h-11 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void sinGasto("PAGADO_FUERA")}
              >
                No registrar gasto
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
