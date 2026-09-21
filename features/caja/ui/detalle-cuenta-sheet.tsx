"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { formatearMoneda } from "@/shared/utils/formatters";
import { getMovimientosCuentaAction } from "../actions/cuentas-financieras";
import {
  etiquetaMovimiento,
  mueveElResultado,
  type MovimientoCuenta,
} from "../lib/movimiento-financiero";
import type { SaldoCuenta } from "@/entities/caja/types";

/**
 * "¿De dónde salió este saldo?"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES LA RESPUESTA A UN SALDO, NO UN LIBRO MAYOR
 *
 * Trae los últimos 50 movimientos y lo dice. La cuenta puente de Evens tiene
 * 1.148 y "TRANSFERENCIA MERCADO PAGO" 544: paginar esto sería construir un
 * reporte contable adentro de un panel que se abre para entender un número.
 *
 * Lo que sí importa que se vea, y hasta ahora no se veía en ninguna parte de
 * la pestaña: los EGRESOS de una cuenta que no es la caja diaria. Con la
 * "Caja Grande" de El Nono Cacho en −$750.000, acá aparecen los siete sueldos
 * del 19/9 con su concepto y quién los cargó.
 *
 * Cada fila dice además si el movimiento cambió el RESULTADO del negocio o
 * solo dónde está la plata. Es la distinción que sostiene todo el módulo y la
 * que más cuesta explicar: un pase entre cuentas no es un gasto.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function DetalleCuentaSheet({
  cuenta,
  onOpenChange,
}: Readonly<{
  /** null = cerrado. Se monta siempre; el Sheet lo abre la presencia de la
   * cuenta, y al cerrarse Radix desmonta el contenido y limpia el estado. */
  cuenta: SaldoCuenta | null;
  onOpenChange: (abierto: boolean) => void;
}>) {
  return (
    <Sheet open={cuenta !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {cuenta && <Contenido key={cuenta.cuenta_id} cuenta={cuenta} />}
      </SheetContent>
    </Sheet>
  );
}

/**
 * El contenido va en su propio componente y con `key` por cuenta: así se
 * desmonta al cambiar de cuenta y el `useState` arranca limpio. La
 * alternativa —resetear a null adentro del efecto— es un setState síncrono en
 * un efecto, que dispara un render en cascada.
 */
function Contenido({ cuenta }: Readonly<{ cuenta: SaldoCuenta }>) {
  const [movimientos, setMovimientos] = useState<MovimientoCuenta[] | null>(
    null,
  );

  useEffect(() => {
    let vigente = true;
    getMovimientosCuentaAction(cuenta.cuenta_id).then(({ data, error }) => {
      if (!vigente) return;
      if (error) toast.error(error);
      setMovimientos(data);
    });
    return () => {
      vigente = false;
    };
  }, [cuenta.cuenta_id]);

  const saldo = Number(cuenta.saldo);

  return (
    <>
      <SheetHeader className="border-b border-border px-4 py-4 sm:px-5">
        <SheetTitle className="text-base">{cuenta.nombre}</SheetTitle>
        <SheetDescription asChild>
          <div>
            <span
              className={`block font-mono text-2xl font-medium tabular-nums ${
                saldo < 0 ? "text-danger" : "text-foreground"
              }`}
            >
              {formatearMoneda(saldo)}
            </span>
            <span className="text-[11px]">
              Últimos movimientos registrados en esta cuenta.
            </span>
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {movimientos === null ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : movimientos.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            Esta cuenta todavía no tiene movimientos registrados.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {movimientos.map((m) => {
              const importe = Number(m.importe);
              const resultado = mueveElResultado(m.origen_tipo, m.evento);
              return (
                <li key={m.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {etiquetaMovimiento(
                          m.origen_tipo,
                          m.evento,
                          importe,
                        )}
                      </p>
                      {m.descripcion && (
                        <p className="truncate text-xs text-muted-foreground">
                          {m.descripcion}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {fechaHora(m.fecha)}
                        {m.autor && ` · ${m.autor}`}
                        {/* El nombre técnico se muestra igual: la bitácora es
                            append-only y auditable, y esconderlo la haría
                            menos auditable. */}
                        {" · "}
                        <span className="opacity-70">{m.evento}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`font-mono text-sm font-semibold tabular-nums ${
                          importe < 0 ? "text-danger" : "text-success"
                        }`}
                      >
                        {importe > 0 && "+"}
                        {formatearMoneda(importe)}
                      </span>
                      <p className="text-[10px] text-muted-foreground">
                        {resultado ? "Afecta la ganancia" : "Solo mueve plata"}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {movimientos !== null && movimientos.length >= 50 && (
        <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
          Se muestran los 50 más recientes. Para el detalle completo de un día
          está el Historial de caja.
        </p>
      )}
    </>
  );
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
