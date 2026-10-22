"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PackageX, Truck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { toast } from "@/shared/ui/toast";
import { formatearMoneda } from "@/shared/utils/formatters";
import { EgresoModal } from "@/features/caja/ui/egreso-modal";
import { descartarRemitoAction } from "../actions/pago-remito";
import {
  agruparDeudaPorProveedor,
  diasSinIngresar,
  type RemitoResumenPago,
  type SituacionRemito,
} from "../lib/pago-remito";
import { PagoRemitoDialog } from "./pago-remito-dialog";

const ETIQUETA_SITUACION: Record<SituacionRemito, string> = {
  A_PAGAR: "A pagar",
  SIN_RESPONDER: "Sin responder",
  PAGADO: "Pagado",
  ANTERIOR: "Anterior al registro",
  SIN_INGRESAR: "Sin ingresar",
  DESCARTADO: "Descartado",
};

export function ComprasPanel({ remitos }: Readonly<{ remitos: RemitoResumenPago[] }>) {
  const router = useRouter();
  const [pagando, setPagando] = useState<RemitoResumenPago | null>(null);
  const [preguntando, setPreguntando] = useState<string | null>(null);
  const [descartando, setDescartando] = useState<RemitoResumenPago | null>(null);
  const [descartandoLoading, setDescartandoLoading] = useState(false);

  const deudas = useMemo(() => agruparDeudaPorProveedor(remitos), [remitos]);
  const totalDeuda = deudas.reduce((s, d) => s + d.total, 0);
  const sinResponder = remitos.filter((r) => r.situacion === "SIN_RESPONDER");
  const sinIngresar = remitos.filter((r) => r.situacion === "SIN_INGRESAR");
  const historial = remitos
    .filter((r) => r.situacion !== "SIN_INGRESAR" && r.situacion !== "SIN_RESPONDER")
    .slice(0, 30);

  const descartar = async () => {
    if (!descartando) return;
    setDescartandoLoading(true);
    const { error } = await descartarRemitoAction(descartando.id);
    setDescartandoLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Remito descartado. No se movió stock ni plata.");
    setDescartando(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Truck className="h-5 w-5 text-primary" /> Compras
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que le debés a cada proveedor y la mercadería que subiste y todavía no ingresó.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">A pagar</h2>
          {totalDeuda > 0 && (
            <span className="font-mono text-base font-semibold">{formatearMoneda(totalDeuda)}</span>
          )}
        </div>
        {deudas.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No le debés nada a ningún proveedor. Cuando ingreses un remito y elijas
            &quot;Lo pago después&quot;, aparece acá.
          </p>
        ) : (
          deudas.map((d) => (
            <div key={d.proveedorId ?? "sin"} className="rounded-lg border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
                <span className="font-medium">{d.proveedorNombre}</span>
                <span className="font-mono text-sm font-semibold">{formatearMoneda(d.total)}</span>
              </div>
              <ul className="divide-y divide-border">
                {d.remitos.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{r.nombre}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatearFecha(r.fecha_remito ?? r.creado_en)}
                        {r.total_pagado > 0 &&
                          ` · pagado ${formatearMoneda(r.total_pagado)} de ${formatearMoneda(r.valor)}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm">{formatearMoneda(r.saldo_pendiente)}</span>
                      <Button size="sm" className="h-11 md:h-9" onClick={() => setPagando(r)}>
                        Pagar
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {sinResponder.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Sin responder si se pagaron</h2>
          <p className="text-sm text-muted-foreground">
            Ingresaron al stock, pero nadie contestó &quot;¿Lo pagaste?&quot;.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sinResponder.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatearFecha(r.fecha_remito ?? r.creado_en)} · {formatearMoneda(r.valor)} a costo
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 shrink-0 md:h-9"
                  onClick={() => setPreguntando(r.id)}
                >
                  ¿Lo pagaste?
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sinIngresar.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Mercadería sin ingresar</h2>
          <p className="text-sm text-muted-foreground">
            Remitos que se subieron pero no se conciliaron: el stock no entró. Si
            la mercadería no vino o el archivo se subió de más, descartalo.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sinIngresar.map((r) => {
              const dias = diasSinIngresar(r.creado_en);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      Subido hace {dias} día{dias === 1 ? "" : "s"} · {formatearMoneda(r.valor)} a costo
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" className="h-11 md:h-9" onClick={() => setDescartando(r)}>
                      <PackageX className="mr-1 h-4 w-4" /> Descartar
                    </Button>
                    <Button size="sm" variant="outline" className="h-11 md:h-9" asChild>
                      <Link href={`/compras/merge/${r.id}`}>Ingresar</Link>
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {historial.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Últimos remitos</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {historial.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatearFecha(r.fecha_remito ?? r.creado_en)}
                    {r.proveedor_nombre ? ` · ${r.proveedor_nombre}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="font-mono text-sm">{formatearMoneda(r.valor)}</span>
                  <span className="text-xs text-muted-foreground">{ETIQUETA_SITUACION[r.situacion]}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EgresoModal
        open={pagando !== null}
        mostrarTrigger={false}
        remito={pagando}
        onOpenChange={(abierto) => !abierto && setPagando(null)}
        onRegistrado={() => router.refresh()}
      />

      <PagoRemitoDialog
        ordenId={preguntando}
        onClose={() => {
          setPreguntando(null);
          router.refresh();
        }}
      />

      <AlertDialog open={descartando !== null} onOpenChange={(abierto) => !abierto && setDescartando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar «{descartando?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              No se suma stock ni se registra ningún pago. El remito queda en el
              historial como descartado y no se puede retomar: si la mercadería
              llega, subí el archivo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={descartandoLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void descartar();
              }}
              disabled={descartandoLoading}
            >
              {descartandoLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
}
