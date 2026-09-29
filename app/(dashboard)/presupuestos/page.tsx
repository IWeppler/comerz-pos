import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { createClient } from "@/shared/config/supabase/server";
import { moduloPresupuestosHabilitado } from "@/features/presupuestos/lib/modulo-habilitado";
import { listarPresupuestosAction } from "@/features/presupuestos/actions/presupuestos";
import {
  estadoVisiblePresupuesto,
  formatearNumeroPresupuesto,
} from "@/features/presupuestos/lib/estado";
import { fechaCorta } from "@/features/presupuestos/lib/mensaje-whatsapp";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import { EstadoPresupuestoBadge } from "@/features/presupuestos/ui/estado-badge";

export const dynamic = "force-dynamic";

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

/**
 * Cotizaciones del negocio. Con el módulo apagado la ruta NO existe (404), no
 * muestra un candado: es crédito propio del comercio y en un negocio que no
 * lo usa no tiene que aparecer (docs/presupuestos.md). La RLS decide qué
 * filas se ven; esto solo decide si la pantalla existe.
 */
export default async function PresupuestosPage() {
  const supabase = createClient(await cookies());
  if (!(await moduloPresupuestosHabilitado(supabase))) notFound();

  const { data, error } = await listarPresupuestosAction();
  const ahora = new Date();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Presupuestos</h1>
        <p className="text-sm text-muted-foreground">
          Se arman desde el POS con «Cotizar». No cobran ni descuentan stock.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <FileText className="h-10 w-10 opacity-30" />
          <p>Todavía no hay cotizaciones.</p>
          <Link href="/pos" className="text-sm text-primary underline underline-offset-4">
            Ir a vender y cotizar un carrito
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/presupuestos/${p.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="w-16 shrink-0 font-mono text-sm text-muted-foreground">
                  {formatearNumeroPresupuesto(p.numero)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.cliente_nombre ?? "Sin nombre"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {fechaCorta(diaComercial(p.creado_en))} · válida hasta{" "}
                    {fechaCorta(p.vigencia_hasta)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-sm">{pesos(p.total)}</span>
                  <EstadoPresupuestoBadge
                    estado={estadoVisiblePresupuesto(p.estado, p.vigencia_hasta, ahora)}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
