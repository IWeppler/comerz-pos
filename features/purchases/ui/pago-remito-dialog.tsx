"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { toast } from "@/shared/ui/toast";
import { formatearMoneda } from "@/shared/utils/formatters";
import { EgresoModal } from "@/features/caja/ui/egreso-modal";
import { definirPagoRemitoAction, getPagoRemitoAction } from "../actions/pago-remito";
import type { OpcionPagoRemito, RemitoResumenPago } from "../lib/pago-remito";
import { SelectorProveedor } from "./selector-proveedor";

interface PagoRemitoDialogProps {
  /** El remito recién aprobado (o uno sin responder, desde Compras). */
  ordenId: string | null;
  /** Se cierra sin importar si se respondió: un remito sin respuesta queda
   * "sin responder" en Compras, no se pierde. */
  onClose: () => void;
}

const OPCIONES: { valor: OpcionPagoRemito; titulo: string; detalle: string }[] = [
  {
    valor: "PAGAR_AHORA",
    titulo: "Sí, ahora",
    detalle: "Elegís de qué caja sale y cuánto. Puede ser una parte.",
  },
  {
    valor: "PAGAR_DESPUES",
    titulo: "Lo pago después",
    detalle: "Queda en Compras › A pagar, con el saldo del proveedor.",
  },
  {
    valor: "PAGADO_FUERA",
    titulo: "Ya está pagado",
    detalle: "Se pagó con plata que no pasa por ninguna caja de Comerz.",
  },
];

/**
 * "¿Lo pagaste?", la única pregunta después de ingresar un remito
 * (docs/asistente-ia.md, C1). La mercadería ya entró: nada de esto puede
 * voltear la aprobación. "Sí, ahora" declara el pago y abre el gasto ya armado;
 * si ese gasto no se guarda (caja cerrada, no alcanza), el remito queda a
 * pagar, que es lo que pasó.
 */
export function PagoRemitoDialog({ ordenId, onClose }: Readonly<PagoRemitoDialogProps>) {
  const [remito, setRemito] = useState<RemitoResumenPago | null>(null);
  const [opcion, setOpcion] = useState<OpcionPagoRemito | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [pagando, setPagando] = useState(false);

  useEffect(() => {
    if (!ordenId) return;
    let cancelado = false;
    getPagoRemitoAction(ordenId).then((r) => {
      if (cancelado) return;
      setRemito(r);
      setProveedorId(r?.proveedor_id ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [ordenId]);

  const cerrar = () => {
    setRemito(null);
    setOpcion(null);
    setProveedorId(null);
    setPagando(false);
    onClose();
  };

  const faltaProveedor = opcion === "PAGAR_DESPUES" && !proveedorId;

  const confirmar = async () => {
    if (!ordenId || !opcion) return;
    setGuardando(true);
    const { error } = await definirPagoRemitoAction(ordenId, opcion, proveedorId);
    setGuardando(false);
    if (error) {
      toast.error(error);
      return;
    }
    if (opcion === "PAGAR_AHORA") {
      setPagando(true);
      return;
    }
    toast.success(
      opcion === "PAGAR_DESPUES" ? "Quedó en Compras › A pagar." : "Remito marcado como pagado.",
    );
    cerrar();
  };

  if (pagando && remito) {
    return (
      <EgresoModal
        open
        mostrarTrigger={false}
        remito={remito}
        onOpenChange={(abierto) => {
          if (!abierto) {
            // Sin gasto guardado el remito ya quedó "se paga desde Comerz":
            // aparece en A pagar con el saldo entero.
            cerrar();
          }
        }}
        onRegistrado={() => toast.success("Pago registrado y asociado al remito.")}
      />
    );
  }

  return (
    <Dialog open={ordenId !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Lo pagaste?</DialogTitle>
          <DialogDescription>
            {remito
              ? `${remito.nombre} · ${formatearMoneda(remito.valor)} a costo`
              : "La mercadería ya ingresó al stock."}
          </DialogDescription>
        </DialogHeader>

        {!remito ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando el remito...
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div role="radiogroup" aria-label="¿Lo pagaste?" className="grid gap-2">
              {OPCIONES.map((o) => {
                const elegida = o.valor === opcion;
                return (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={elegida}
                    onClick={() => setOpcion(o.valor)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      elegida ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                    }`}
                  >
                    <span className="block text-sm font-medium text-foreground">{o.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{o.detalle}</span>
                  </button>
                );
              })}
            </div>

            {opcion && (
              <div className="space-y-2">
                <Label htmlFor="pago-remito-proveedor">
                  Proveedor{opcion === "PAGAR_DESPUES" ? "" : " (opcional)"}
                </Label>
                <SelectorProveedor
                  id="pago-remito-proveedor"
                  valor={proveedorId}
                  onChange={(p) => setProveedorId(p?.id ?? null)}
                />
                {faltaProveedor && (
                  <p className="text-[11px] text-muted-foreground">
                    Para dejarlo a pagar hace falta saber a quién se le debe.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={cerrar} disabled={guardando}>
                Responder después
              </Button>
              <Button
                type="button"
                onClick={() => void confirmar()}
                disabled={!opcion || faltaProveedor || guardando}
              >
                {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {opcion === "PAGAR_AHORA" ? "Siguiente" : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
