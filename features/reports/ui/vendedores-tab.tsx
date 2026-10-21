"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { getReporteVendedoresAction } from "../actions/get-reporte-vendedores";
import { VendedoresTablaResumen } from "./vendedores-tabla-resumen";
import { VendedoresRanking, VendedoresCobros, VendedoresDiario } from "./vendedores-graficos";
import { VendedorDetallePanel } from "./vendedor-detalle-panel";
import type { ReporteVendedoresData } from "@/entities/reportes/types";

interface VendedoresTabProps {
  puedeVer: boolean;
  desde: string;
  hasta: string;
}

/** Vendedores como sección de Ventas (antes era una pestaña propia). */
export function VendedoresSeccion({ puedeVer, desde, hasta }: Readonly<VendedoresTabProps>) {
  const [data, setData] = useState<ReporteVendedoresData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);

  useEffect(() => {
    if (!puedeVer) return;

    let cancelado = false;

    const cargarReporte = async () => {
      setIsLoading(true);
      setError(null);

      const res = await getReporteVendedoresAction(desde, hasta);
      if (cancelado) return;
      setIsLoading(false);
      if (res.error) {
        setError(res.error);
        setData(null);
      } else {
        setData(res.data);
        setSeleccionadoId(null);
      }
    };

    cargarReporte();

    return () => {
      cancelado = true;
    };
  }, [puedeVer, desde, hasta]);

  if (!puedeVer) return null;

  const vendedorSeleccionado = data?.resumen.find(
    (r) => r.vendedorId === seleccionadoId,
  );

  return (
    <section aria-labelledby="vendedores-titulo" className="space-y-6">
      <h2 id="vendedores-titulo" className="text-lg font-semibold text-foreground">
        Vendedores
      </h2>
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Cargando reporte...
        </div>
      )}

      {!isLoading && error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl p-4 flex items-center gap-2 text-sm">
          <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          <VendedoresTablaResumen
            resumen={data.resumen}
            seleccionadoId={seleccionadoId}
            onSeleccionar={(id) =>
              setSeleccionadoId((current) => (current === id ? null : id))
            }
          />

          {vendedorSeleccionado && (
            <VendedorDetallePanel
              vendedor={vendedorSeleccionado}
              detalle={
                data.porVendedor[vendedorSeleccionado.vendedorId] ?? {
                  topProductos: [],
                  anuladas: [],
                }
              }
              onClose={() => setSeleccionadoId(null)}
            />
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="border-border shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">Cuánto vendió cada uno</CardTitle>
              </CardHeader>
              <CardContent>
                <VendedoresRanking resumen={data.resumen} />
              </CardContent>
            </Card>

            <Card className="border-border shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">Cómo cobra cada uno</CardTitle>
              </CardHeader>
              <CardContent>
                <VendedoresCobros resumen={data.resumen} desglose={data.desglosePorMetodo} />
              </CardContent>
            </Card>
          </div>

          <Card className="border-border shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">Ventas por día</CardTitle>
            </CardHeader>
            <CardContent>
              <VendedoresDiario resumen={data.resumen} ventasPorDia={data.ventasPorDia} />
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
