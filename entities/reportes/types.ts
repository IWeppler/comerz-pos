import { getDashboardMetrics } from "@/features/dashboard/lib/get-dashboard-metrics";

export type ReportesMetrics = ReturnType<typeof getDashboardMetrics>;

export type BajaAprobadaReporte = {
  id: string;
  producto_id: string | null;
  variante: string | null;
  cantidad: number | string;
  motivo: string | null;
  creado_en: string;
  estado: string | null;
  perfiles?: { nombre?: string | null } | null;
};

// ============================================================
// Reporte de Vendedores (features/reports/actions/get-reporte-vendedores.ts)
// ============================================================

export interface VendedorResumen {
  vendedorId: string;
  nombre: string;
  totalVendido: number;
  cantidadVentas: number;
  ticketPromedio: number;
  cantidadAnuladas: number;
}

export interface VentaPorDiaVendedor {
  vendedorId: string;
  fecha: string; // yyyy-mm-dd
  total: number;
}

export interface DesgloseMetodoVendedor {
  vendedorId: string;
  metodo: string;
  monto: number;
}

export interface ProductoTopVendedor {
  /** Unidad real del producto (kg, u., m): la cantidad se lee con ella. */
  unidadMedida: string | null;
  productoId: string;
  nombre: string;
  cantidad: number;
  totalFacturado: number;
}

export interface VentaAnuladaVendedor {
  id: string;
  fecha: string;
  producto: string;
  monto: number;
}

export interface ReporteVendedoresData {
  resumen: VendedorResumen[];
  ventasPorDia: VentaPorDiaVendedor[];
  desglosePorMetodo: DesgloseMetodoVendedor[];
  porVendedor: Record<
    string,
    {
      topProductos: ProductoTopVendedor[];
      anuladas: VentaAnuladaVendedor[];
    }
  >;
}

