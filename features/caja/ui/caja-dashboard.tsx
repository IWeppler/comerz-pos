"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { nombreRenglon } from "@/features/sales/lib/nombre-renglon";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Lock, Loader2 } from "lucide-react";
import { etiquetaTipoEgreso } from "../lib/tipo-egreso";
import { calcularTotalesTurno } from "../lib/totales-turno";
import { anularEgresoAction } from "../actions/caja-action";
import {
  MovimientosTurno,
  type MovimientoExtendido,
} from "./movimientos-turno";
import { OtrasCajasAbiertas } from "./otras-cajas-abiertas";
import { TarjetaDigital, TarjetaTurno } from "./turno-tarjeta";
import {
  TurnoCajaHistorial,
  EgresoCaja,
  TransferenciaCaja,
  MovimientoDigitalTurno,
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
  /** Lo que se movió en cuentas que NO son el cajón mientras el turno propio
   * estuvo abierto. Va a la tarjeta digital y no entra en ningún total del
   * arqueo: esa plata no se cuenta con billetes en la mano. */
  movimientosDigitales?: MovimientoDigitalTurno[];
  historial: TurnoCajaHistorial[];
  modoCaja?: string;
  userRole?: string;
  userId?: string;
  /** `caja.anular_movimiento`: habilita "Anular" en cada gasto del turno que
   * todavía no es un reintegro de venta. El turno está ABIERTO acá siempre
   * que se ve esta tabla (es "Mi turno"), así que la RPC nunca rebota por
   * `TURNO_CERRADO` desde esta pantalla. */
  puedeAnular?: boolean;
}

export function CajaDashboard({
  turnosAbiertos,
  ventas,
  pagosSueltos,
  egresos,
  transferenciasCaja = [],
  movimientosDigitales = [],
  historial: _historial,
  modoCaja: _modoCaja,
  userRole: _userRole,
  userId,
  puedeAnular = false,
}: Readonly<CajaDashboardProps>) {
  void _modoCaja;
  void _userRole;
  void _historial;

  const router = useRouter();
  const [aAnular, setAAnular] = useState<MovimientoExtendido | null>(null);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [anulando, setAnulando] = useState(false);

  const anular = async () => {
    if (!aAnular || !motivoAnular.trim()) return;
    setAnulando(true);
    const res = await anularEgresoAction(aAnular.id, motivoAnular);
    setAnulando(false);
    if (!res.success) {
      toast.error(res.error ?? "No se pudo anular el gasto.");
      return;
    }
    toast.success("Gasto anulado");
    setAAnular(null);
    setMotivoAnular("");
    router.refresh();
  };

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
          turnoId: v.turno_caja_id ?? null,
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
          turnoId: v.turno_caja_id ?? null,
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
          turnoId: p.turno_caja_id ?? null,
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
      turnoId: e.turno_caja_id ?? null,
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
      egresoTipo: e.tipo,
    }));

    const transferenciasMapeadas: MovimientoExtendido[] = transferenciasCaja.map(
      (movimiento) => ({
        id: `transferencia-${movimiento.movimiento_id}`,
        turnoId: movimiento.turno_caja_id ?? null,
        tipo: Number(movimiento.importe) >= 0 ? "INGRESO" : "EGRESO",
        origen: movimiento.origen_tipo === "INGRESO" ? "INGRESO" : "TRANSFERENCIA",
        concepto: movimiento.descripcion,
        metodo:
          movimiento.origen_tipo === "INGRESO" ? "INGRESO LIBRE" : "TRANSFERENCIA INTERNA",
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

    // ─────────────────────────────────────────────────────────────────────
    // LA TABLA ES ANCHA, EL ARQUEO ES ANGOSTO
    //
    // `todos` puede traer los movimientos de varias cajas abiertas: es lo que
    // la dueña necesita ver. Los TOTALES, en cambio, se calculan solo con los
    // del turno propio, porque son el número que alguien va a contra-contar
    // con billetes en la mano.
    //
    // Mezclarlos ya costó un incidente (30/7: los $22.650 de Brisa del 20/7
    // aparecían como sobrante en la caja de Evelyn). El filtro por `turnoId`
    // es lo único que lo evita, así que no se saca ni se "simplifica".
    //
    // La cuenta vive en `lib/totales-turno.ts`, con tests: es la que decide si
    // a una vendedora le falta plata en el cajón.
    // ─────────────────────────────────────────────────────────────────────
    const propios = turno ? todos.filter((m) => m.turnoId === turno.id) : [];

    return {
      movimientos: todos,
      totales: calcularTotalesTurno(propios, Number(turno?.monto_inicial ?? 0)),
    };
  }, [ventas, pagosSueltos, egresos, transferenciasCaja, turno]);
  const otrasCajas = turnosAbiertos.filter((t) => t.id !== turno?.id);

  return (
    <div className="space-y-6 animate-in fade-in-50">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {turno ? "Tu turno en curso" : "Turnos en curso"}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            La plata que está manejando cada persona ahora.
          </p>
        </div>
        <span className="text-xs font-medium capitalize text-muted-foreground">
          {fechaLarga()}
        </span>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          DOS LECTURAS DE LA MISMA PANTALLA

          Con turno propio (la vendedora): el arqueo grande a la izquierda,
          que es lo que va a contar con billetes en la mano.

          Sin turno propio (la dueña): NO se queda sin nada. Ve las cajas
          abiertas del local y todos sus movimientos, filtrables por empleada.
          Su pregunta no es "cuánto hay en mi cajón" sino "qué está pasando
          en el local ahora".

          En los dos casos la tabla es la misma y muestra lo que esa persona
          puede ver; lo único angosto es el arqueo.
          ───────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div
          className={
            turno
              ? "grid gap-4 lg:grid-cols-[1.15fr_1fr]"
              : "grid gap-4 md:grid-cols-2"
          }
        >
          {turno ? (
            <TarjetaTurno
              vendedor={turno.perfiles?.nombre || "Tu caja"}
              desde={turno.fecha_apertura}
              totales={totales}
            />
          ) : (
            /* El formulario de apertura vive SOLO en el botón de caja de la
               barra: un solo lugar para abrir turno desde cualquier pantalla.
               Esto solo dice por qué no hay arqueo propio que mostrar. */
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
          )}

          {/* Movimientos digitales: al lado del cajón y nunca sumado con él. Esa
              plata no está en ninguna caja que se pueda contar, y mezclarla
              con el efectivo esperado es cómo un arqueo termina con una
              diferencia que nadie puede explicar. Solo con turno propio: es
              del turno, no del local. */}
          <div className="space-y-4">
            <OtrasCajasAbiertas turnos={otrasCajas} />
            {turno && (
              <TarjetaDigital
                totales={totales}
                movimientos={movimientosDigitales}
              />
            )}
          </div>
        </div>

        {(turno || movimientos.length > 0) && (
          <MovimientosTurno
            movimientos={movimientos}
            puedeAnular={puedeAnular}
            onAnular={setAAnular}
            variasCajas={turnosAbiertos.length > 1 || !turno}
          />
        )}
      </div>

      {/* El historial se renderiza afuera (page.tsx): tiene que verse también
          cuando la dueña está en "Vista general" y este componente no se
          monta. */}

      <Dialog
        open={aAnular !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAAnular(null);
            setMotivoAnular("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Anular gasto</DialogTitle>
            <DialogDescription>
              {aAnular?.concepto} ·{" "}
              {aAnular ? formatearMoneda(aAnular.monto) : ""}. Se borra de las
              cuentas; el registro de que existió y se anuló queda en la
              bitácora, con el motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="motivo-anular-egreso">Motivo</Label>
              <Input
                id="motivo-anular-egreso"
                value={motivoAnular}
                onChange={(e) => setMotivoAnular(e.target.value)}
                placeholder="Ej: Se cargó dos veces"
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              variant="destructive"
              onClick={anular}
              disabled={anulando || !motivoAnular.trim()}
            >
              {anulando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anular gasto
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "lunes 22 de septiembre". Se arma en el cliente, así que puede parpadear
 * un instante contra el render del server si el turno cruza la medianoche; es
 * un rótulo de contexto, no un dato que alguien firme. */
function fechaLarga(): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}
