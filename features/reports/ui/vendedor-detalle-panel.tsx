import { Trophy, RotateCcw, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";
import { formatearCantidad } from "@/shared/lib/unidad-venta";
import type {
  VendedorResumen,
  ReporteVendedoresData,
} from "@/entities/reportes/types";

interface VendedorDetallePanelProps {
  vendedor: VendedorResumen;
  detalle: ReporteVendedoresData["porVendedor"][string];
  onClose: () => void;
}

export function VendedorDetallePanel({
  vendedor,
  detalle,
  onClose,
}: Readonly<VendedorDetallePanelProps>) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-6 animate-in fade-in-50 duration-200">
      <div className="flex items-center justify-between">
        <h4 className="text-base font-semibold text-foreground">
          Detalle de {vendedor.nombre}
        </h4>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4 text-muted-foreground" /> Lo que más facturó
          </h5>
          {detalle.topProductos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin productos vendidos en el rango.
            </p>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border overflow-hidden">
              {detalle.topProductos.map((p, i) => (
                <div
                  key={p.productoId}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 text-foreground truncate">
                    <span className="text-xs text-muted-foreground/60 w-4 shrink-0">
                      {i + 1}
                    </span>
                    {p.nombre}
                  </span>
                  <span className="text-muted-foreground shrink-0 pl-2 tabular-nums">
                    {formatearCantidad(p.cantidad, p.unidadMedida)} · {formatearMoneda(p.totalFacturado)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-danger" /> Ventas anuladas
          </h5>
          {detalle.anuladas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin anulaciones en el rango.
            </p>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border overflow-hidden">
              {detalle.anuladas.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{v.producto}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatearFechaHora(v.fecha)}
                    </p>
                  </div>
                  <span className="text-danger font-medium shrink-0 pl-2">
                    {formatearMoneda(v.monto)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
