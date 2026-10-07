"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { AnalisisComplementos, ParComplementario } from "../lib/complementos-catalogo";
import { configurarComplementoAction } from "../actions/complementos-catalogo";

export function ComplementosCatalogo({ analisis }: { analisis: AnalisisComplementos }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guardar = (par: ParComplementario) => {
    setError(null); setSeleccionado(par.producto_a_id + par.producto_b_id);
    iniciar(async () => {
      try {
        const resultado = await configurarComplementoAction(par.producto_a_id, par.producto_b_id, !par.activo);
        if (resultado.error) setError(resultado.error); else router.refresh();
      } catch { setError("No pudimos guardar la asociación. Intentá de nuevo."); }
      finally { setSeleccionado(null); }
    });
  };
  return <section id="complementos-catalogo" aria-labelledby="complementos-titulo" className="scroll-mt-20 space-y-4 rounded-xl border border-border bg-card p-5">
    <div className="flex items-start gap-3"><Link2 className="mt-1 size-5 shrink-0" aria-hidden="true" /><div>
      <p className="text-xs font-medium text-muted-foreground">Comerz Intelligence · últimos {analisis.dias} días</p>
      <h2 id="complementos-titulo" className="mt-1 text-lg font-semibold">Productos que se compran juntos</h2>
      <p className="mt-1 text-sm text-muted-foreground">Activá una asociación para priorizar esos productos en las sugerencias del carrito. Las compras conjuntas describen el historial; no garantizan ventas futuras.</p>
    </div></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!analisis.pares.length ? <p className="text-sm text-muted-foreground">Todavía no hay pares con compras conjuntas repetidas. El catálogo usará categoría y subcategoría; si no hay relacionados, buscará productos para acercar el carrito al envío gratis.</p> :
      <ul className="divide-y divide-border">{analisis.pares.map(par => <li key={par.producto_a_id + par.producto_b_id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="font-medium">{par.producto_a} + {par.producto_b}</p>
          <p className="mt-1 text-sm text-muted-foreground">{par.ventas_juntas > 0 ? `En ${par.ventas_juntas} ventas juntos. ${par.producto_a}: ${par.ventas_a} ventas; ${par.producto_b}: ${par.ventas_b} ventas.` : "Asociación activada; todavía sin compras conjuntas repetidas en este período."}</p>
          {!par.publicables && <p className="mt-1 text-xs text-muted-foreground">Publicá ambos productos para que puedan mostrarse en el catálogo.</p>}
        </div>
        {analisis.puede_editar && <Button variant={par.activo ? "outline" : "default"} className="min-h-11 shrink-0" disabled={pendiente || (!par.publicables && !par.activo)} onClick={() => guardar(par)}>{pendiente && seleccionado === par.producto_a_id + par.producto_b_id ? "Guardando…" : par.activo ? "Quitar asociación" : "Activar asociación"}</Button>}
      </li>)}</ul>}
    <p className="text-xs text-muted-foreground">Hasta 30 pares. Excluye ventas anuladas y renglones completamente devueltos. La configuración se aplica en ambos sentidos; se muestran solo productos publicados y con stock, salvo que tu catálogo permita productos sin stock.</p>
  </section>;
}
