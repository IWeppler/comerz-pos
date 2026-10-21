import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { VendedorResumen } from "@/entities/reportes/types";

interface VendedoresTablaResumenProps {
  resumen: VendedorResumen[];
  seleccionadoId: string | null;
  onSeleccionar: (vendedorId: string) => void;
}

export function VendedoresTablaResumen({
  resumen,
  seleccionadoId,
  onSeleccionar,
}: Readonly<VendedoresTablaResumenProps>) {
  if (resumen.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
        Nadie registró ventas en el rango seleccionado.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendedor</TableHead>
            <TableHead className="text-right">Total vendido</TableHead>
            <TableHead className="text-right">Ventas</TableHead>
            <TableHead className="text-right">Ticket promedio</TableHead>
            <TableHead className="text-right">Anuladas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resumen.map((r) => (
            <TableRow
              key={r.vendedorId}
              onClick={() => onSeleccionar(r.vendedorId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSeleccionar(r.vendedorId);
                }
              }}
              tabIndex={0}
              aria-selected={seleccionadoId === r.vendedorId}
              className={`cursor-pointer ${seleccionadoId === r.vendedorId ? "bg-muted/50" : ""}`}
            >
              <TableCell className="font-medium text-foreground">{r.nombre}</TableCell>
              <TableCell className="text-right font-semibold">
                {formatearMoneda(r.totalVendido)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {r.cantidadVentas}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatearMoneda(r.ticketPromedio)}
              </TableCell>
              <TableCell className="text-right">
                {r.cantidadAnuladas > 0 ? (
                  <span className="text-danger font-medium">
                    {r.cantidadAnuladas}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
