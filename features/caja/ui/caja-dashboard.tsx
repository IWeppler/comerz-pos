"use client";

import { useMemo } from "react";
import { nombreRenglon } from "@/features/sales/lib/nombre-renglon";
import { Badge } from "@/shared/ui/badge";
import {
  Banknote,
  CreditCard,
  Lock,
  ShoppingBag,
  BookUser,
  TrendingDown,
  Repeat2,
} from "lucide-react";
import { etiquetaTipoEgreso } from "../lib/tipo-egreso";
import { calcularTotalesTurno } from "../lib/totales-turno";
import {
  TurnoCajaHistorial,
  EgresoCaja,
  TransferenciaCaja,
  VentaCaja,
} from "@/entities/caja/types";
import { VentaPago, getSupabaseRelation } from "@/entities/ventas/types";
import { formatearMoneda } from "@/shared/utils/formatters";

export interface CajaDashboardProps {
  turnosAbiertos: TurnoCajaHistorial[];
  ventas: VentaCaja[];
  pagosSueltos: VentaPago[];
  egresos: EgresoCaja[];
  transferenciasCaja?: TransferenciaCaja[];
  historial: TurnoCajaHistorial[];
  modoCaja?: string;
  userRole?: string;
  userId?: string;
}

type MovimientoExtendido = {
  id: string;
  tipo: "INGRESO" | "EGRESO";
  origen: "VENTA" | "COBRO_DEUDA" | "EGRESO" | "TRANSFERENCIA";
  concepto: string;
  metodo: string;
  metodo_tipo: string;
  monto: number;
  comision: number;
  neto: number;
  fecha: string;
  usuario: string;
  /** La venta se anuló. Sigue siendo un movimiento real del turno —la plata
   * entró— pero no es facturación. Ver `totales` más abajo. */
  anulada?: boolean;
  afecta_facturacion?: boolean;
};

export function CajaDashboard({
  turnosAbiertos,
  ventas,
  pagosSueltos,
  egresos,
  transferenciasCaja = [],
  historial: _historial,
  modoCaja: _modoCaja,
  userRole: _userRole,
  userId,
}: Readonly<CajaDashboardProps>) {
  void _modoCaja;
  void _userRole;
  void _historial;

  // El turno propio se matchea siempre por vendedor_id en modo POR_USUARIO,
  // donde cada vendedor tiene su propia caja. En modo UNICA la caja es una
  // sola compartida por todo el local, así que cualquier usuario opera
  // contra el mismo turno sin importar quién lo abrió.
  const turno =
    turnosAbiertos.find((turnoAbierto) =>
      turnoAbierto.modo === "POR_USUARIO"
        ? turnoAbierto.vendedor_id === userId
        : true,
    ) ?? null;
  const hayCajaAjenaAbierta = !turno && turnosAbiertos.length > 0;

  const { movimientos, totales } = useMemo(() => {
    if (!turno) {
      return {
        movimientos: [] as MovimientoExtendido[],
        totales: {
          fondoInicial: 0,
          ingresosEfectivo: 0,
          ingresosDigitalesBruto: 0,
          comisionesRetenidas: 0,
          ingresosDigitalesNeto: 0,
          totalEgresos: 0,
          efectivoEsperado: 0,
          totalFacturado: 0,
        },
      };
    }

    const ventasMapeadas: MovimientoExtendido[] = ventas.flatMap((v) => {
      const pagos = v.venta_pagos || [];
      const primerItem = v.ventas_items?.[0];
      const primerProducto = getSupabaseRelation(primerItem?.producto);
      const vendedor = getSupabaseRelation(v.perfiles);
      const anulada = v.estado_operacion === "ANULADA";
      // Se marca en el texto porque abajo aparece su egreso de devolución: sin
      // esto se ve una salida de plata sin la entrada que la explica.
      const conceptoVenta = `${anulada ? "Venta anulada" : "Venta"}: ${
        primerItem
          ? nombreRenglon(primerProducto?.nombre, primerItem)
          : "Varios"
      }`;

      if (pagos.length > 0) {
        return pagos.map((pago) => ({
          id: `${v.id}-${pago.id || Math.random()}`,
          tipo: "INGRESO" as const,
          origen: "VENTA" as const,
          concepto: conceptoVenta,
          metodo: pago.metodo_nombre,
          metodo_tipo: pago.metodo_tipo,
          monto: Number(pago.monto_bruto),
          comision: Number(pago.comision_monto),
          neto: Number(pago.monto_neto),
          fecha: v.fecha_venta,
          usuario: vendedor?.nombre || "Vendedor",
          anulada,
        }));
      }

      const isEfectivo = v.metodo_pago === "EFECTIVO";
      return [
        {
          id: v.id,
          tipo: "INGRESO" as const,
          origen: "VENTA" as const,
          concepto: conceptoVenta,
          metodo: v.metodo_pago || "EFECTIVO",
          metodo_tipo: isEfectivo ? "EFECTIVO" : "TARJETA",
          monto: Number(v.total),
          comision: 0,
          neto: Number(v.total),
          fecha: v.fecha_venta,
          usuario: vendedor?.nombre || "Vendedor",
          anulada,
        },
      ];
    });

    const pagosSueltosMapeados: MovimientoExtendido[] = pagosSueltos.map(
      (p) => {
        const cliente = getSupabaseRelation(p.clientes);

        return {
          id: p.id ?? `${p.metodo_nombre}-${p.creado_en}`,
          tipo: "INGRESO",
          origen: "COBRO_DEUDA",
          concepto: `Cobro a Deudor: ${cliente?.nombre || "Cliente"}`,
          metodo: p.metodo_nombre,
          metodo_tipo: p.metodo_tipo,
          monto: Number(p.monto_bruto),
          comision: Number(p.comision_monto),
          neto: Number(p.monto_neto),
          fecha: p.creado_en || new Date().toISOString(),
          usuario: "Sistema",
        };
      },
    );

    const egresosMapeados: MovimientoExtendido[] = egresos.map((e) => ({
      id: e.id,
      tipo: "EGRESO",
      origen: "EGRESO",
      concepto: `${etiquetaTipoEgreso(e.tipo)}: ${e.concepto}`,
      metodo: "CAJA FISICA",
      metodo_tipo: "EFECTIVO",
      monto: Number(e.monto),
      comision: 0,
      neto: Number(e.monto),
      fecha: e.fecha,
      usuario: e.perfiles?.nombre || "Usuario",
    }));

    const transferenciasMapeadas: MovimientoExtendido[] = transferenciasCaja.map(
      (movimiento) => ({
        id: `transferencia-${movimiento.movimiento_id}`,
        tipo: Number(movimiento.importe) >= 0 ? "INGRESO" : "EGRESO",
        origen: "TRANSFERENCIA",
        concepto: movimiento.descripcion,
        metodo: "TRANSFERENCIA INTERNA",
        metodo_tipo: "EFECTIVO",
        monto: Math.abs(Number(movimiento.importe)),
        comision: 0,
        neto: Math.abs(Number(movimiento.importe)),
        fecha: movimiento.fecha_movimiento,
        usuario: "Sistema",
        afecta_facturacion: false,
      }),
    );

    const todos = [
      ...ventasMapeadas,
      ...pagosSueltosMapeados,
      ...egresosMapeados,
      ...transferenciasMapeadas,
    ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    // La cuenta vive en `lib/totales-turno.ts`, con tests: es la que decide si
    // a una vendedora le falta plata en el cajón.
    return {
      movimientos: todos,
      totales: calcularTotalesTurno(todos, Number(turno.monto_inicial)),
    };
  }, [ventas, pagosSueltos, egresos, transferenciasCaja, turno]);

  return (
    <div className="space-y-6 animate-in fade-in-50">
      {!turno ? (
        /* Acá vivía el formulario de apertura. Se abre SOLO desde el botón de
           caja de la barra (CajaQuickModal): un solo lugar para abrir turno,
           el mismo desde cualquier pantalla. Esto solo dice por qué no hay
           nada que mostrar. */
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {hayCajaAjenaAbierta
                ? "No tenés un turno propio abierto"
                : "La caja está cerrada"}
            </p>
            <p className="text-xs text-muted-foreground">
              Abrí el turno desde el botón de caja de la barra.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Cierre Z y gasto viven en el botón de caja de la barra, igual
              que la apertura: acá queda lo que se mira, no lo que se opera.
              En celular las dos tarjetas se deslizan de costado: apiladas
              empujaban los movimientos —que es a lo que se entra— abajo del
              pliegue. */}
          <div className="-mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0">
            <div className="flex w-[85%] shrink-0 snap-start flex-col justify-between rounded-2xl border border-border bg-muted p-4 md:w-auto md:shrink">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                  <Banknote className="w-4 h-4 text-success" />
                  Efectivo en Cajon
                </h3>
                <div
                  className={`text-3xl font-mono font-semibold mb-2 ${
                    totales.efectivoEsperado < 0
                      ? "text-danger"
                      : "text-foreground"
                  }`}
                >
                  {formatearMoneda(totales.efectivoEsperado)}
                </div>
                {totales.efectivoEsperado < 0 ? (
                  <p className="text-sm text-danger">
                    Revisar: efectivo esperado negativo
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground font-medium">
                    Efectivo total esperado al cierre
                  </p>
                )}
              </div>
              <div className="mt-8 space-y-3">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">Fondo inicial</span>
                  <span className="font-mono font-medium">
                    {formatearMoneda(totales.fondoInicial)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">
                    Cobros en efectivo
                  </span>
                  <span className="font-mono font-medium text-success">
                    +{formatearMoneda(totales.ingresosEfectivo)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">Salidas de efectivo</span>
                  <span className="font-mono font-medium text-danger">
                    -{formatearMoneda(totales.totalEgresos)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex w-[85%] shrink-0 snap-start flex-col justify-between rounded-2xl border border-border bg-muted p-4 md:w-auto md:shrink">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                  <CreditCard className="w-4 h-4 text-chart-1" />
                  Cobros Digitales
                </h3>
                <div className="text-3xl font-mono font-semibold text-foreground mb-2">
                  {formatearMoneda(totales.ingresosDigitalesNeto)}
                </div>
                <p className="text-sm text-muted-foreground font-medium">
                  Acreditacion neta estimada (Transf. y Tarjetas)
                </p>
              </div>
              <div className="mt-8 space-y-2">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">Cobros brutos</span>
                  <span className="font-mono font-medium">
                    {formatearMoneda(totales.ingresosDigitalesBruto)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">
                    Comisiones retenidas
                  </span>
                  <span className="font-mono font-medium text-danger">
                    -{formatearMoneda(totales.comisionesRetenidas)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="px-1 sm:px-4 mb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-foreground">
                Movimientos del Turno
              </h3>
              <div className="text-sm font-medium text-muted-foreground">
                Total Facturado Bruto:{" "}
                <span className="text-foreground font-mono font-medium">
                  {formatearMoneda(totales.totalFacturado)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl bg-card border border-border overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-card text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
                  <tr>
                    <th className="px-3 py-3 sm:px-6 sm:py-4">Hora</th>
                    <th className="px-3 py-3 sm:px-6 sm:py-4">Concepto</th>
                    <th className="px-3 py-3 sm:px-6 sm:py-4">Metodo</th>
                    <th className="px-3 py-3 sm:px-6 sm:py-4 text-right">Monto</th>
                    <th className="px-3 py-3 sm:px-6 sm:py-4 hidden sm:table-cell">Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {movimientos.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-12 text-center text-muted-foreground bg-transparent"
                      >
                        Aun no hay movimientos registrados en este turno.
                      </td>
                    </tr>
                  ) : (
                    movimientos.map((mov) => (
                      <tr
                        key={`${mov.tipo}-${mov.id}`}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-muted-foreground text-xs font-medium">
                          {new Date(mov.fecha).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </td>
                        <td className="px-3 py-3 sm:px-6 sm:py-4 font-medium text-foreground">
                          <div className="flex items-center gap-3">
                            {mov.origen === "VENTA" && (
                              <div className="p-1.5 bg-success/10 text-success rounded-md shrink-0 border">
                                <ShoppingBag className="w-3.5 h-3.5" />
                              </div>
                            )}
                            {mov.origen === "COBRO_DEUDA" && (
                              <div className="p-1.5 bg-info/10 text-info rounded-md shrink-0 border">
                                <BookUser className="w-3.5 h-3.5" />
                              </div>
                            )}
                            {mov.origen === "EGRESO" && (
                              <div className="p-1.5 bg-danger/10 text-danger rounded-md shrink-0 border">
                                <TrendingDown className="w-3.5 h-3.5" />
                              </div>
                            )}
                            {mov.origen === "TRANSFERENCIA" && (
                              <div className="p-1.5 bg-info/10 text-info rounded-md shrink-0 border">
                                <Repeat2 className="w-3.5 h-3.5" />
                              </div>
                            )}
                            <span className="truncate max-w-[110px] sm:max-w-xs text-xs sm:text-sm">
                              {mov.concepto}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 sm:px-6 sm:py-4">
                          <Badge
                            variant="secondary"
                            className="text-[10px] uppercase shadow-none bg-muted"
                          >
                            {mov.metodo}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-right font-mono font-medium">
                          <div
                            className={
                              mov.tipo === "INGRESO"
                                ? "text-success"
                                : "text-danger"
                            }
                          >
                            {mov.tipo === "INGRESO" ? "+" : "-"}
                            {formatearMoneda(mov.monto)}
                          </div>
                        </td>
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-muted-foreground hidden sm:table-cell text-sm">
                          {mov.usuario}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* El historial se renderiza afuera (page.tsx): tiene que verse también
          cuando la dueña está en "Vista general" y este componente no se
          monta. */}
    </div>
  );
}
