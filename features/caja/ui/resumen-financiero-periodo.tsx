"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Info,
  Landmark,
  ReceiptText,
  RotateCcw,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  PeriodoSelector,
  OPCIONES_CALENDARIO,
} from "@/shared/components/periodo-selector";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { formatearMoneda } from "@/shared/utils/formatters";
import { etiquetaTipoIngreso } from "../lib/tipo-ingreso";
import {
  getResumenFinancieroAction,
  type ResumenFinancieroPeriodo as ResumenFinancieroData,
} from "../actions/get-resumen-financiero";

const LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-bold";

const MEDIOS: Record<string, { label: string; Icono: typeof Banknote }> = {
  EFECTIVO: { label: "Efectivo", Icono: Banknote },
  TRANSFERENCIA: { label: "Transferencias", Icono: Landmark },
  TARJETA: { label: "Tarjetas", Icono: CreditCard },
  BILLETERA_VIRTUAL: { label: "Billetera virtual", Icono: Wallet },
};

const ACLARACION_NETO =
  "No es la ganancia: no descuenta el costo de la mercadería vendida. La ganancia real está en el Panel.";

type FilaMonto = {
  id: string;
  nombre: string;
  monto: number;
  cantidad: number;
  Icono?: typeof Banknote;
};

export function ResumenFinancieroPeriodo({
  resumenInicial,
  periodoInicial,
}: Readonly<{
  resumenInicial: ResumenFinancieroData;
  periodoInicial: PeriodoCalendario;
}>) {
  const [periodo, setPeriodo] = useState<PeriodoCalendario>(periodoInicial);
  const [resumen, setResumen] = useState(resumenInicial);
  const [cargando, setCargando] = useState(false);

  const cambiarPeriodo = async (nuevo: PeriodoCalendario) => {
    if (nuevo === periodo) return;

    setPeriodo(nuevo);
    setCargando(true);
    const res = await getResumenFinancieroAction(nuevo);
    if (res.data) setResumen(res.data);
    else if (res.error) toast.error(res.error);
    setCargando(false);
  };

  const ingresosPorMedio: FilaMonto[] = resumen.ingresos.por_medio.map(
    (fila) => ({
      id: fila.metodo_tipo,
      nombre: MEDIOS[fila.metodo_tipo]?.label ?? fila.metodo_tipo,
      monto: Number(fila.monto),
      cantidad: fila.cantidad,
      Icono: MEDIOS[fila.metodo_tipo]?.Icono ?? Wallet,
    }),
  );
  // Ingresos libres por tipo. Los que no son ganancia (aporte, préstamo) lo
  // dicen en el nombre: es la misma advertencia que lleva el neto.
  const otrosIngresosPorTipo: FilaMonto[] = resumen.otros_ingresos.por_tipo.map(
    (fila) => ({
      id: fila.tipo,
      nombre: etiquetaTipoIngreso(fila.tipo),
      monto: Number(fila.monto),
      cantidad: fila.cantidad,
      Icono: TrendingUp,
    }),
  );
  const gastosPorCategoria: FilaMonto[] =
    resumen.egresos.gastos_por_categoria.map((fila) => ({
      id: fila.categoria_id ?? "sin-categoria",
      nombre: fila.categoria_nombre,
      monto: Number(fila.monto),
      cantidad: fila.cantidad,
      Icono: ReceiptText,
    }));

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Qué pasó con la plata
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Entradas y salidas registradas durante el período elegido.
          </p>
        </div>
        <PeriodoSelector
          opciones={OPCIONES_CALENDARIO}
          periodo={periodo}
          onChange={cambiarPeriodo}
          ariaLabel="Período del resumen financiero"
        />
      </div>

      <TooltipProvider>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tarjeta
            titulo="Cobrado"
            monto={Number(resumen.ingresos.cobrado)}
            detalle={`Ventas ${formatearMoneda(Number(resumen.ingresos.cobrado_ventas))} · Cobros de deuda ${formatearMoneda(Number(resumen.ingresos.cobros_de_deuda))}${
              resumen.otros_ingresos.cantidad > 0
                ? ` · Otros ingresos ${formatearMoneda(Number(resumen.otros_ingresos.total))}`
                : ""
            }`}
            Icono={Banknote}
            cargando={cargando}
            ayuda="Todo lo cobrado en el período, separado entre cobros de ventas y cobros de deuda de cuenta corriente. Los otros ingresos (aportes, préstamos, extraordinarios) NO están en este número: van aparte, más abajo, y sí entran al neto de caja."
          />
          <Tarjeta
            titulo="Reintegros"
            monto={Number(resumen.reintegros.total)}
            detalle={`${resumen.reintegros.cantidad} reintegro(s)`}
            Icono={RotateCcw}
            negativo
            cargando={cargando}
            ayuda="Plata devuelta a clientes por cualquier medio. Se resta una sola vez del neto de caja."
          />
          <Tarjeta
            titulo="Gastos"
            monto={Number(resumen.egresos.sin_devolucion)}
            detalle="Sin devoluciones a clientes"
            Icono={ReceiptText}
            negativo
            cargando={cargando}
            ayuda="Todas las salidas registradas, excepto las devoluciones que ya están incluidas en Reintegros."
          />
        </div>

        <ListaMontos
          titulo="Cobrado por medio"
          filas={ingresosPorMedio}
          vacio="No hubo cobros en este período."
          sustantivo="cobro"
          cargando={cargando}
        />

        {resumen.otros_ingresos.cantidad > 0 && (
          <ListaMontos
            titulo="Otros ingresos (no son ventas)"
            filas={otrosIngresosPorTipo}
            vacio="No hubo otros ingresos en este período."
            sustantivo="ingreso"
            cargando={cargando}
          />
        )}

        <ListaMontos
          titulo="Gastos operativos por categoría"
          filas={gastosPorCategoria}
          vacio="No hubo gastos operativos en este período."
          sustantivo="gasto"
          negativo
          cargando={cargando}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <DatoInformativo
            titulo="Transferencias entre cuentas"
            Icono={ArrowLeftRight}
            monto={Number(resumen.transferencias.monto)}
            detalle={`${resumen.transferencias.cantidad} transferencia(s) · No modifica ningún total`}
            cargando={cargando}
          />
          <div className="rounded-xl border border-border bg-card px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={LABEL}>Diferencias de arqueo</span>
              <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div
              className={`grid grid-cols-2 gap-3 text-xs transition-opacity ${cargando ? "opacity-40" : ""}`}
            >
              <div>
                <div className="text-muted-foreground">Faltantes</div>
                <div className="font-semibold tabular-nums text-danger">
                  −{formatearMoneda(Number(resumen.arqueo.faltantes))}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Sobrantes</div>
                <div className="font-semibold tabular-nums">
                  {formatearMoneda(Number(resumen.arqueo.sobrantes))}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {resumen.arqueo.turnos_con_diferencia} turno(s) con diferencia ·
              No modifica ningún total
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={`${LABEL} flex items-center gap-1`}>
              Neto de caja
              <Ayuda titulo="Neto de caja" texto={ACLARACION_NETO} />
            </span>
            <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div
            className={`text-2xl font-bold tabular-nums transition-opacity ${
              Number(resumen.neto_caja) < 0 ? "text-danger" : ""
            } ${cargando ? "opacity-40" : ""}`}
          >
            {formatearMoneda(Number(resumen.neto_caja))}
          </div>
          <p className="mt-1 max-w-2xl text-[11px] font-medium text-muted-foreground">
            {ACLARACION_NETO}
          </p>
        </div>
      </TooltipProvider>
    </section>
  );
}

function ListaMontos({
  titulo,
  filas,
  vacio,
  sustantivo,
  negativo = false,
  cargando = false,
}: Readonly<{
  titulo: string;
  filas: FilaMonto[];
  vacio: string;
  sustantivo: string;
  negativo?: boolean;
  cargando?: boolean;
}>) {
  return (
    <div className="space-y-2">
      <h3 className={LABEL}>{titulo}</h3>
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{vacio}</p>
      ) : (
        <ul
          className={`rounded-xl border border-border bg-card transition-opacity ${cargando ? "opacity-40" : ""}`}
        >
          {filas.map((fila) => {
            const Icono = fila.Icono ?? Wallet;
            return (
              <li
                key={fila.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-xs last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{fila.nombre}</div>
                    <div className="text-muted-foreground">
                      {fila.cantidad} {sustantivo}(s)
                    </div>
                  </div>
                </div>
                <div
                  className={`shrink-0 font-semibold tabular-nums ${negativo ? "text-danger" : ""}`}
                >
                  {negativo && "−"}
                  {formatearMoneda(fila.monto)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Tarjeta({
  titulo,
  monto,
  detalle,
  Icono,
  negativo = false,
  ayuda,
  cargando = false,
}: Readonly<{
  titulo: string;
  monto: number;
  detalle: string;
  Icono: typeof Banknote;
  negativo?: boolean;
  ayuda?: string;
  cargando?: boolean;
}>) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`${LABEL} flex items-center gap-1`}>
          {titulo}
          {ayuda && <Ayuda titulo={titulo} texto={ayuda} />}
        </span>
        <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div
        className={`text-xl font-bold tabular-nums transition-opacity ${
          negativo || monto < 0 ? "text-danger" : ""
        } ${cargando ? "opacity-40" : ""}`}
      >
        {negativo && monto >= 0 && "−"}
        {formatearMoneda(monto)}
      </div>
      <div className="text-[11px] text-muted-foreground">{detalle}</div>
    </div>
  );
}

function DatoInformativo({
  titulo,
  Icono,
  monto,
  detalle,
  cargando,
}: Readonly<{
  titulo: string;
  Icono: typeof Banknote;
  monto: number;
  detalle: string;
  cargando: boolean;
}>) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={LABEL}>{titulo}</span>
        <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div
        className={`text-base font-semibold tabular-nums transition-opacity ${cargando ? "opacity-40" : ""}`}
      >
        {formatearMoneda(monto)}
      </div>
      <div className="text-[11px] text-muted-foreground">{detalle}</div>
    </div>
  );
}

function Ayuda({ titulo, texto }: Readonly<{ titulo: string; texto: string }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Qué es ${titulo}`}
          className="-m-1 cursor-pointer p-1 text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] border-border bg-foreground text-xs text-background">
        <p className="normal-case tracking-normal">{texto}</p>
      </TooltipContent>
    </Tooltip>
  );
}
