"use client";

import { useState } from "react";
import { FileCheck2, FileX2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  PeriodoSelector,
  OPCIONES_CALENDARIO,
} from "@/shared/components/periodo-selector";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";
import { tituloComprobante } from "@/shared/lib/comprobante-fiscal-ticket";
import { getVentasFacturadasAction } from "../actions/get-ventas-facturadas";
import type { VentasFacturadas as VentasFacturadasData } from "@/entities/caja/types";

/**
 * "¿Qué parte de lo que vendí está facturado?"
 *
 * Dos números y un porcentaje, sobre `ventas.total` de las ventas
 * confirmadas del período. Se muestra SOLO a comercios con modo ARCA: para
 * los que emiten ticket interno, "0% facturado" es ruido y no una señal.
 *
 * El tercer cajón —PRUEBA— aparece solo cuando hay comprobantes de
 * homologación en el período, para que no se lean como facturados ni como
 * sin facturar. Cuando el comercio pasa a producción, desaparece solo.
 */

const LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-bold";

export function VentasFacturadas({
  inicial,
  periodoInicial,
}: Readonly<{
  inicial: VentasFacturadasData;
  periodoInicial: PeriodoCalendario;
}>) {
  const [periodo, setPeriodo] = useState<PeriodoCalendario>(periodoInicial);
  const [datos, setDatos] = useState(inicial);
  const [cargando, setCargando] = useState(false);

  const cambiarPeriodo = async (nuevo: PeriodoCalendario) => {
    if (nuevo === periodo) return;
    setPeriodo(nuevo);
    setCargando(true);
    const res = await getVentasFacturadasAction(nuevo);
    if (res.data) setDatos(res.data);
    else if (res.error) toast.error(res.error);
    setCargando(false);
  };

  const total = Number(datos.total.total);
  const facturado = Number(datos.facturado.total);
  const sinFacturar = Number(datos.sin_facturar.total);
  const prueba = Number(datos.prueba.total);
  // Sobre lo que cuenta: las pruebas no son ni una cosa ni la otra.
  const base = total - prueba;
  const porcentaje = base > 0 ? Math.round((facturado / base) * 100) : 0;

  const atenuado = cargando ? "opacity-40" : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Facturado y sin facturar
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Ventas confirmadas del período, por lo que salió en el
            comprobante. Las anuladas no cuentan.
          </p>
        </div>
        <PeriodoSelector
          opciones={OPCIONES_CALENDARIO}
          periodo={periodo}
          onChange={cambiarPeriodo}
          ariaLabel="Período de lo facturado"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={LABEL}>Facturado</span>
            <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className={`text-xl font-bold tabular-nums transition-opacity ${atenuado}`}>
            {formatearMoneda(facturado)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {datos.facturado.cantidad} venta(s) · {porcentaje}% del total
            {datos.facturado.por_tipo.length > 1 && (
              <>
                {" · "}
                {datos.facturado.por_tipo
                  .map((t) => `${tituloComprobante(t.tipo)} ${t.cantidad}`)
                  .join(", ")}
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={LABEL}>Sin facturar</span>
            <FileX2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className={`text-xl font-bold tabular-nums transition-opacity ${atenuado}`}>
            {formatearMoneda(sinFacturar)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {datos.sin_facturar.cantidad} venta(s) con ticket interno
            {base > 0 ? ` · ${100 - porcentaje}%` : ""}
          </div>
        </div>

        {datos.prueba.cantidad > 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/10 px-3 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className={LABEL}>Prueba (homologación)</span>
              <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div className={`text-xl font-bold tabular-nums transition-opacity ${atenuado}`}>
              {formatearMoneda(prueba)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {datos.prueba.cantidad} venta(s) con CAE sin valor fiscal. No
              cuentan en el porcentaje.
            </div>
          </div>
        )}
      </div>

      {/* Barra: proporción a simple vista. */}
      {base > 0 && (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${porcentaje}% facturado`}
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      )}
    </section>
  );
}
