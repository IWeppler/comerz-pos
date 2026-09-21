"use client";

import { useState, useEffect } from "react";
import { nombreRenglon } from "@/features/sales/lib/nombre-renglon";
import {
  TurnoCajaHistorial,
  EgresoCaja,
  TransferenciaCaja,
  VentaCaja,
} from "@/entities/caja/types";
import { VentaPago, getSupabaseRelation } from "@/entities/ventas/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Loader2,
  Printer,
  FileText,
  Wallet,
  Clock,
  CreditCard,
  ShoppingBag,
  BookUser,
  TrendingDown,
  TrendingUp,
  Repeat2,
} from "lucide-react";
import { getDetallesTurnoAction } from "../actions/caja-action";
import { etiquetaTipoEgreso } from "../lib/tipo-egreso";
import {
  cssImpresionTicket,
  normalizarAnchoTicket,
} from "@/shared/lib/ancho-ticket";
import { CierreZPrintable, type PapelCierreZ } from "./cierre-z-printable";

interface CajaDetailSheetProps {
  turno: TurnoCajaHistorial | null;
  onClose: () => void;
  papel: PapelCierreZ;
}

type MovimientoDetalle = {
  id: string;
  tipo: "INGRESO" | "EGRESO";
  origen: "VENTA" | "COBRO_DEUDA" | "EGRESO" | "TRANSFERENCIA" | "INGRESO";
  concepto: string;
  metodo: string;
  metodo_tipo: string;
  /** Bruto: lo que entró, recargo por método incluido. */
  monto: number;
  /** Parte del bruto que fue recargo por método (0 si el método no cobra). */
  recargo: number;
  comision: number;
  neto: number;
  fecha: string;
};

const formatearMoneda = (monto: number) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(monto);
};

export function CajaDetailSheet({
  turno,
  onClose,
  papel,
}: Readonly<CajaDetailSheetProps>) {
  const [movimientos, setMovimientos] = useState<MovimientoDetalle[]>([]);
  const [totalesDigitales, setTotalesDigitales] = useState({
    bruto: 0,
    neto: 0,
    comision: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [detallesCargados, setDetallesCargados] = useState(false);

  useEffect(() => {
    if (!turno) return;

    const fetchDetalles = async () => {
      setIsLoading(true);
      setDetallesCargados(false);
      const res = await getDetallesTurnoAction(turno.id);

      if (res.data) {
        const ventas = res.data.ventas as unknown as VentaCaja[];
        const pagosSueltos = res.data.pagosSueltos as VentaPago[];
        const egresos = res.data.egresos as EgresoCaja[];
        const transferencias = res.data.transferenciasCaja as TransferenciaCaja[];

        const ventasMapeadas: MovimientoDetalle[] = ventas.flatMap((v) => {
          const primerItem = v.ventas_items?.[0];
          const primerProducto = getSupabaseRelation(primerItem?.producto);
          const itemsExtra = (v.ventas_items?.length || 1) - 1;
          const nombrePrimero = primerItem
            ? nombreRenglon(primerProducto?.nombre, primerItem)
            : null;
          const conceptoNombre =
            nombrePrimero && nombrePrimero !== "Producto eliminado"
              ? `${nombrePrimero} ${itemsExtra > 0 ? `+ ${itemsExtra} art.` : ""}`
              : "Varios/Eliminado";

          const pagos = v.venta_pagos || [];

          if (pagos.length > 0) {
            return pagos.map((pago) => ({
              id: `${v.id}-${pago.id || Math.random()}`,
              tipo: "INGRESO",
              origen: "VENTA",
              concepto: `Venta: ${conceptoNombre}`,
              metodo: pago.metodo_nombre,
              metodo_tipo: pago.metodo_tipo,
              monto: Number(pago.monto_bruto),
              recargo: Number(pago.recargo_monto ?? 0),
              comision: Number(pago.comision_monto),
              neto: Number(pago.monto_neto),
              fecha: v.fecha_venta,
            }));
          } else {
            const isEfectivo = v.metodo_pago === "EFECTIVO";
            return [
              {
                id: v.id,
                tipo: "INGRESO",
                origen: "VENTA",
                concepto: `Venta: ${conceptoNombre}`,
                metodo: v.metodo_pago || "EFECTIVO",
                metodo_tipo: isEfectivo ? "EFECTIVO" : "TARJETA",
                monto: Number(v.total),
                recargo: 0,
                comision: 0,
                neto: Number(v.total),
                fecha: v.fecha_venta,
              },
            ];
          }
        });

        const pagosSueltosMapeados: MovimientoDetalle[] = pagosSueltos.map(
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
              recargo: Number(p.recargo_monto ?? 0),
              comision: Number(p.comision_monto),
              neto: Number(p.monto_neto),
              fecha: p.creado_en || new Date().toISOString(),
            };
          },
        );

        const egresosMapeados: MovimientoDetalle[] = egresos.map((e) => ({
          id: e.id,
          tipo: "EGRESO",
          origen: "EGRESO",
          concepto: `${etiquetaTipoEgreso(e.tipo)}: ${e.concepto}`,
          metodo: "CAJA FÍSICA",
          metodo_tipo: "EFECTIVO",
          monto: Number(e.monto),
          recargo: 0,
          comision: 0,
          neto: Number(e.monto),
          fecha: e.fecha,
        }));

        const transferenciasMapeadas: MovimientoDetalle[] = transferencias.map(
          (movimiento) => ({
            id: `transferencia-${movimiento.movimiento_id}`,
            tipo: Number(movimiento.importe) >= 0 ? "INGRESO" : "EGRESO",
            origen: movimiento.origen_tipo === "INGRESO" ? "INGRESO" : "TRANSFERENCIA",
            concepto: movimiento.descripcion,
            metodo:
              movimiento.origen_tipo === "INGRESO" ? "INGRESO LIBRE" : "TRANSFERENCIA INTERNA",
            metodo_tipo: "EFECTIVO",
            monto: Math.abs(Number(movimiento.importe)),
            recargo: 0,
            comision: 0,
            neto: Math.abs(Number(movimiento.importe)),
            fecha: movimiento.fecha_movimiento,
          }),
        );

        const todos = [
          ...ventasMapeadas,
          ...pagosSueltosMapeados,
          ...egresosMapeados,
          ...transferenciasMapeadas,
        ].sort(
          (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
        );

        setMovimientos(todos);

        const digitales = [...ventasMapeadas, ...pagosSueltosMapeados].filter(
          (m) => m.metodo_tipo !== "EFECTIVO",
        );
        setTotalesDigitales({
          bruto: digitales.reduce((acc, m) => acc + m.monto, 0),
          comision: digitales.reduce((acc, m) => acc + m.comision, 0),
          neto: digitales.reduce((acc, m) => acc + m.neto, 0),
        });
      }
      setIsLoading(false);
      setDetallesCargados(true);
    };

    fetchDetalles();
  }, [turno]);

  if (!turno) return null;

  const isAbierto = turno.estado === "ABIERTO";
  const idCorto = turno.id.split("-")[0].toUpperCase();

  const final = Number(turno.monto_final || 0);
  const esperadoAlCerrar = Number(turno.efectivo_esperado);
  const ingresosEfectivoActuales = movimientos
    .filter((mov) => mov.tipo === "INGRESO" && mov.metodo_tipo === "EFECTIVO")
    .reduce((total, mov) => total + mov.monto, 0);
  const egresosActuales = movimientos
    .filter((mov) => mov.tipo === "EGRESO")
    .reduce((total, mov) => total + mov.monto, 0);
  const esperadoSegunMovimientos =
    Number(turno.monto_inicial) + ingresosEfectivoActuales - egresosActuales;
  const hayAjustePosterior =
    detallesCargados &&
    !isAbierto &&
    Math.abs(esperadoSegunMovimientos - esperadoAlCerrar) >= 0.01;
  const esperado = hayAjustePosterior
    ? esperadoSegunMovimientos
    : esperadoAlCerrar;
  const diferencia = final - esperado;
  const diferenciaAlCerrar = final - esperadoAlCerrar;
  const esperadoNegativo = !isAbierto && esperado < 0;

  return (
    <Sheet
      open={turno !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Mismo CSS de impresión que el ticket de venta y el recibo de CC:
          esconde la app y deja solo el `#ticket-print-wrapper` al ancho del
          papel. Sin esto "Imprimir Cierre Z" imprimía la pantalla o nada. */}
      <style>
        {cssImpresionTicket(normalizarAnchoTicket(papel.anchoTicketMm))}
      </style>
      <SheetContent
        side="right"
        className="ticket-sheet-print-scope w-full sm:max-w-2xl p-0 flex flex-col h-dvh overflow-hidden bg-card"
      >
        <div className="ticket-screen-only flex min-h-0 flex-1 flex-col">
          <SheetHeader className="p-6 border-b border-border z-10 shrink-0">
            <SheetTitle className="flex items-center gap-3 text-xl font-semi text-foreground">
              <div className="p-2 bg-muted rounded-full">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              Auditoría de Turno
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            <div className="text-center mb-6">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Ticket Z #{idCorto}
              </p>
            </div>

            {/* ARQUEO FÍSICO */}
            <div className="bg-card p-5 rounded-2xl border border-border mb-4">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm text-foreground font-semibold flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-success" /> Arqueo Físico
                  (Cajón)
                </span>
                {isAbierto ? (
                  <Badge
                    variant="outline"
                    className="bg-success/10 text-success border-success/20"
                  >
                    En Curso
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20"
                  >
                    Finalizado
                  </Badge>
                )}
              </div>

              {!isAbierto && (
                <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1">
                      Diferencia de Efectivo
                      {hayAjustePosterior ? " corregida" : ""}
                    </p>
                    {diferencia === 0 ? (
                      <span className="text-xl font-semibold text-success">
                        Caja OK
                      </span>
                    ) : diferencia < 0 ? (
                      <span className="text-xl font-semibold text-danger">
                        Faltante: {formatearMoneda(diferencia)}
                      </span>
                    ) : (
                      <span className="text-xl font-semibold text-info">
                        Sobrante: +{formatearMoneda(diferencia)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3 text-sm">
                {hayAjustePosterior && (
                  <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-info">
                    <p className="font-semibold">Hubo una corrección posterior al cierre.</p>
                    <p className="mt-1">
                      El arqueo firmado se conserva: esperaba{" "}
                      {formatearMoneda(esperadoAlCerrar)} y registró una
                      diferencia de {formatearMoneda(diferenciaAlCerrar)}. Los
                      importes de abajo reflejan los cobros corregidos.
                    </p>
                  </div>
                )}
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Fondo Inicial declarado:</span>
                  <span className="font-medium text-foreground">
                    {formatearMoneda(Number(turno.monto_inicial))}
                  </span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>
                    Efectivo Esperado
                    {hayAjustePosterior ? " (Corregido)" : " (Sistema)"}:
                  </span>
                  <span
                    className={`font-medium ${esperadoNegativo ? "text-danger" : "text-foreground"}`}
                  >
                    {isAbierto ? "-" : formatearMoneda(esperado)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Efectivo Contado (Físico):</span>
                  <span className="font-bold text-foreground">
                    {isAbierto ? "-" : formatearMoneda(final)}
                  </span>
                </div>
                {esperadoNegativo && (
                  <p className="text-xs text-danger font-semibold flex items-center gap-1.5 pt-1">
                    ⚠ Revisar: el esperado dio negativo. Puede haber egresos mal
                    atribuidos a este turno.
                  </p>
                )}
              </div>
            </div>

            {/* ARQUEO DIGITAL */}
            <div className="bg-card p-5 rounded-2xl border border-border mb-6">
              <div className="flex justify-between items-start mb-4 border-b border-border/50 pb-3">
                <span className="text-sm text-foreground font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-info" />
                  Cobros Digitales
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Monto Bruto:</span>
                  <span className="font-medium text-foreground">
                    {formatearMoneda(totalesDigitales.bruto)}
                  </span>
                </div>
                <div className="flex justify-between items-center font-medium">
                  <span className="text-muted-foreground">
                    Comisiones Retenidas:
                  </span>
                  <span className="">
                    -{formatearMoneda(totalesDigitales.comision)}
                  </span>
                </div>
                <div className="flex justify-between items-center font-medium pt-1">
                  <span className="text-muted-foreground">
                    Acreditación Neta:
                  </span>
                  <span>{formatearMoneda(totalesDigitales.neto)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 pb-8">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" /> Movimientos
              </h3>

              {isLoading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : movimientos.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
                  No hubo movimientos de dinero en este turno.
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-2 divide-y divide-border/60">
                  {movimientos.map((mov) => (
                    <div
                      key={`${mov.tipo}-${mov.id}`}
                      className="py-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        {mov.origen === "VENTA" && (
                          <div className="text-success shrink-0">
                            <ShoppingBag className="w-4 h-4" />
                          </div>
                        )}
                        {mov.origen === "COBRO_DEUDA" && (
                          <div className="text-info shrink-0">
                            <BookUser className="w-4 h-4" />
                          </div>
                        )}
                        {mov.origen === "EGRESO" && (
                          <div className="text-danger shrink-0">
                            <TrendingDown className="w-4 h-4" />
                          </div>
                        )}
                        {mov.origen === "TRANSFERENCIA" && (
                          <div className="text-info shrink-0">
                            <Repeat2 className="w-4 h-4" />
                          </div>
                        )}
                        {mov.origen === "INGRESO" && (
                          <div className="text-success shrink-0">
                            <TrendingUp className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-xs sm:text-sm text-foreground max-w-[200px] truncate">
                            {mov.concepto}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase mt-0.5">
                            {new Date(mov.fecha).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            • {mov.metodo}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-medium text-sm text-muted-foreground`}
                        >
                          {mov.tipo === "INGRESO" ? "+" : "-"}
                          {formatearMoneda(mov.monto)}
                        </div>
                        {mov.recargo > 0 && (
                          <div className="text-xs text-warning font-medium leading-none mt-1">
                            incl. {formatearMoneda(mov.recargo)} de recargo
                          </div>
                        )}
                        {mov.comision > 0 && (
                          <div className="text-xs text-danger font-medium leading-none mt-1">
                            -{formatearMoneda(mov.comision)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!isAbierto && (
            <div className="p-4 bg-card border-t border-border flex justify-center shadow-md z-10 shrink-0">
              <Button
                variant="ghost"
                className="w-full flex h-12 gap-2 text-foreground font-bold hover:bg-muted border border-border shadow-none"
                onClick={() => window.print()}
              >
                <Printer className="w-5 h-5 mr-1" /> Imprimir Cierre Z
              </Button>
            </div>
          )}
        </div>

        {!isAbierto && (
          <CierreZPrintable
            turno={turno}
            movimientos={movimientos}
            papel={papel}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
