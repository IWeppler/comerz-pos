import { Flame, Trophy, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { formatearMoneda, formatearHora } from "@/shared/utils/formatters";
import { getSupabaseRelation, type Venta } from "@/entities/ventas/types";

type ProductoRanking = {
  nombre: string;
  unidades: number;
  ganancia: number;
  /** La cantidad en su unidad ("12 u.", "0,129 kg"). */
  cantidadEtiqueta?: string;
};

interface RendimientoCardProps {
  topProductos: ProductoRanking[];
  topProductosRentables: ProductoRanking[];
  etiquetaRanking: string;
  ultimasVentas: Venta[];
}

/**
 * Tabs [Top Ventas | Últimas Ventas] — fusiona lo que antes eran 3 cards
 * separadas (Mayor rotación, Mayor rentabilidad, Últimas ventas) en una
 * sola columna de la fila 2, sin crecer verticalmente.
 */
export function RendimientoCard({
  topProductos,
  topProductosRentables,
  etiquetaRanking,
  ultimasVentas,
}: Readonly<RendimientoCardProps>) {
  return (
    <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-full">
      <Tabs defaultValue="top" className="flex flex-col h-full gap-0">
        <div className="px-3 pt-3 shrink-0">
          <TabsList className="w-full">
            <TabsTrigger value="top" className="gap-1.5">
              <Trophy className="w-3.5 h-3.5" /> Top Ventas
            </TabsTrigger>
            <TabsTrigger value="ultimas" className="gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5" /> Últimas Ventas
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="top"
          className="flex-1 overflow-y-auto p-3 pt-2 mt-0"
        >
          <div className="grid grid-cols-2 gap-3 h-full">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                <Flame className="w-3 h-3" /> Rotación · {etiquetaRanking}
              </div>
              {topProductos.length > 0 ? (
                <div className="space-y-1">
                  {topProductos.slice(0, 3).map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-1.5 text-xs"
                    >
                      <span
                        className="truncate text-foreground"
                        title={p.nombre}
                      >
                        {idx + 1}. {p.nombre}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {p.cantidadEtiqueta ?? `${p.unidades} u.`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Sin datos.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                <Trophy className="w-3 h-3" /> Rentabilidad · {etiquetaRanking}
              </div>
              {topProductosRentables.length > 0 ? (
                <div className="space-y-1">
                  {topProductosRentables.slice(0, 3).map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-1.5 text-xs"
                    >
                      <span
                        className="truncate text-foreground"
                        title={p.nombre}
                      >
                        {idx + 1}. {p.nombre}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        +{formatearMoneda(p.ganancia)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Sin datos.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ultimas" className="flex-1 overflow-y-auto mt-0">
          {ultimasVentas.length > 0 ? (
            <div className="divide-y divide-border">
              {ultimasVentas.map((venta) => (
                <div
                  key={venta.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight truncate">
                      {getSupabaseRelation(venta.ventas_items?.[0]?.producto)
                        ?.nombre || "Producto eliminado"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatearHora(venta.fecha_venta)} · {venta.cantidad} u.
                    </p>
                  </div>
                  <p className="text-xs font-medium text-foreground ml-3 shrink-0">
                    {formatearMoneda(venta.total)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-muted-foreground italic">
                Sin ventas recientes.
              </p>
            </div>
          )}
          <div className="p-3 pt-1">
            <Link
              href="/ventas"
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver todas →
            </Link>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
