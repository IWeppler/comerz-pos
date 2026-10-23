"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { PaymentModal } from "./payment-modal";
import { ClienteBasico } from "./client-selector";
import Link from "next/link";
import { MetodoPagoPOS } from "./types";
import { CreateSalePaymentInput } from "@/entities/ventas/types";
import type { TasaFinanciacion } from "@/shared/lib/cuotas";
import type { PlanCuotasCc } from "@/features/clients/lib/plan-cuotas-cc";
import {
  formatearPct,
  pctRecargoEfectivo,
} from "@/shared/lib/recargo-ticket";
import { EditorRecargo } from "./editor-recargo";

/** "2026-11-19" → "19/11". */
const diaMes = (iso: string) => {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)}/${Number(mes)}`;
};

interface DescuentoDetalle {
  monto: number;
  nombre: string;
}

interface CartSidebarFooterProps {
  isPOSMode: boolean;
  isPending: boolean;
  totalCarrito: number;
  /** Recargo CC efectivamente aplicado (con el porcentaje que rige para el
   * ticket): 0 si la vendedora lo dejó sin recargo. */
  recargoCuentaCorriente: number;
  /** Lo que el recargo CC sería con el porcentaje del COMERCIO. Se usa para
   * poder mostrar la línea (tachada) cuando está en 0. */
  recargoCuentaCorrientePotencial?: number;
  /** Porcentaje que la vendedora eligió para ESTE ticket. Null = rige el del
   * comercio; 0 = sin recargo. */
  ccRecargoPct?: number | null;
  /** `cc_recargo_default` del comercio. */
  ccRecargoPctDefault?: number;
  /** Cambia el porcentaje del ticket (null = volver al del comercio). Sin
   * esta función no se ofrece "Modificar": falta el permiso. */
  onCcRecargoPctChange?: (pct: number | null) => void;
  /** Recargo LIBRE de una venta de contado: el porcentaje que la vendedora
   * eligió (0 = sin recargo) y su monto. Excluyente con el de cuenta
   * corriente. Sin `onRecargoLibrePctChange` no se ofrece: falta el permiso. */
  recargoLibrePct?: number;
  recargoLibreMonto?: number;
  onRecargoLibrePctChange?: (pct: number) => void;
  /** Recargo por método de pago. Ya NO está incluido en `totalFinal`. */
  recargoMetodoMonto?: number;
  recargoMetodoEtiqueta?: string;
  /** Total del ticket SIN recargo por método: es contra este número que se
   * valida que los pagos cubran la mercadería. */
  totalFinal: number;
  /** Lo que el cliente entrega: totalFinal + recargo por método. */
  totalACobrar?: number;
  /** Parte del ticket pagada con saldo a favor. Ya está descontada de
   * `totalFinal` y `totalACobrar`; se muestra como renglón para que el total
   * no parezca salido de la nada. */
  saldoAFavorAplicado?: number;
  sumaPagos: number;
  isCuentaCorriente: boolean;
  isReserva?: boolean;
  onConfirmarReserva?: () => void;
  anticipoMinimo: number;
  clienteSeleccionado: ClienteBasico | null;
  descuentoDetalle: DescuentoDetalle;
  whatsappHref: string;
  metodosPagoDB: MetodoPagoPOS[];
  pagos: CreateSalePaymentInput[];
  modoMixto: boolean;
  onConfirmarVentaPOS: (montoAnticipo?: number) => void;
  onEnviarPedidoWhatsApp: () => void;
  onClearCart: () => void;
  /**
   * Varios puestos, una caja. Ausente = el comercio no lo usa y el footer es
   * el de siempre. Presente y `puedeCobrar` false: el ÚNICO botón es "Enviar
   * a caja" — esa vendedora no cobra. Quien SÍ cobra ve el footer de siempre:
   * su puesto es la caja, no manda pedidos.
   */
  onEnviarACaja?: () => void;
  puedeCobrar?: boolean;
  /** Botón secundario debajo del principal, solo en el POS ("Cotizar", con
   * el módulo de presupuestos prendido). El footer no sabe qué hace. */
  accionSecundaria?: React.ReactNode;
  /**
   * Venta en cuotas (Configuración > Clientes). Vacío o ausente = el
   * comercio no vende en cuotas y no se dibuja nada. `planCuotas` es el plan
   * con la entrega que muestra el panel; el modal lo recalcula con la que se
   * tipee (`planCuotasModal`).
   */
  opcionesCuotas?: TasaFinanciacion[];
  cuotasElegidas?: number | null;
  onCuotasChange?: (cuotas: number | null) => void;
  planCuotas?: PlanCuotasCc | null;
  planCuotasModal?: {
    tasa: TasaFinanciacion;
    baseFinanciable: number;
    fechaVenta: string;
  } | null;
}

const formatCurrency = (amount: number) =>
  amount.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export function CartSidebarFooter({
  isPOSMode,
  isPending,
  totalCarrito,
  totalFinal,
  totalACobrar,
  saldoAFavorAplicado = 0,
  sumaPagos,
  recargoCuentaCorriente,
  recargoCuentaCorrientePotencial = 0,
  ccRecargoPct = null,
  ccRecargoPctDefault = 0,
  onCcRecargoPctChange,
  recargoLibrePct = 0,
  recargoLibreMonto = 0,
  onRecargoLibrePctChange,
  recargoMetodoMonto = 0,
  recargoMetodoEtiqueta = "",
  clienteSeleccionado,
  descuentoDetalle,
  isCuentaCorriente,
  isReserva = false,
  onConfirmarReserva,
  anticipoMinimo,
  whatsappHref,
  metodosPagoDB = [],
  pagos = [],
  modoMixto,
  onConfirmarVentaPOS,
  onEnviarPedidoWhatsApp,
  onClearCart,
  onEnviarACaja,
  puedeCobrar = true,
  accionSecundaria,
  opcionesCuotas = [],
  cuotasElegidas = null,
  onCuotasChange,
  planCuotas = null,
  planCuotasModal = null,
}: Readonly<CartSidebarFooterProps>) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoRecargoCc, setEditandoRecargoCc] = useState(false);
  const [editandoRecargoLibre, setEditandoRecargoLibre] = useState(false);

  const isEfectivoOnly =
    !modoMixto &&
    pagos?.length === 1 &&
    metodosPagoDB?.find((m) => m.id === pagos[0]?.metodoPagoId)?.tipo ===
      "EFECTIVO";

  // Solo para la calculadora de anticipo de Cuenta Corriente, donde el monto
  // se tipea dentro del modal y el recargo tiene que seguirlo en vivo. En
  // pago mixto no aplica: ahí el anticipo no se edita en el modal.
  const recargoPorcentajeSeleccionado =
    !modoMixto && pagos?.length === 1
      ? Number(
          metodosPagoDB?.find((m) => m.id === pagos[0]?.metodoPagoId)
            ?.recargo_porcentaje ?? 0,
        )
      : 0;

  // La línea de recargo CC sigue visible cuando está en 0 (tachada), para que
  // la vendedora vea qué se le está perdonando al cliente y pueda deshacerlo.
  // `recargoCuentaCorriente` ya viene en 0 en ese caso.
  const ccSinRecargo = ccRecargoPct === 0;
  const pctCcAplicado = pctRecargoEfectivo(ccRecargoPct, ccRecargoPctDefault);
  const recargoCCMostrado = ccSinRecargo
    ? recargoCuentaCorrientePotencial
    : recargoCuentaCorriente;
  const mostrarLineaCC = recargoCCMostrado > 0;

  const handleCobrar = () => {
    if (isReserva) {
      onConfirmarReserva?.();
      return;
    }
    setModalAbierto(true);
  };

  const isMissingClient =
    (isCuentaCorriente || isReserva) && !clienteSeleccionado;
  const isMissingAnticipo =
    isCuentaCorriente && sumaPagos + 0.05 < anticipoMinimo;
  // Cuenta Corriente ya no autocompleta método de pago (ver
  // CartStepCheckout/cart-panel-admin) — sin esto, "Confirmar Fiado"
  // podía registrar la venta con pagos=[] y ningún método real asociado.
  const isMissingMetodo =
    isCuentaCorriente && metodosPagoDB.length > 0 && pagos.length === 0;
  const isPrimaryDisabled =
    isPending || isMissingClient || isMissingAnticipo || isMissingMetodo;

  const handleConfirmar = (montoAnticipo?: number) => {
    setModalAbierto(false);
    onConfirmarVentaPOS(montoAnticipo);
  };

  return (
    <>
      <div className="shrink-0 border-t border-border bg-card p-3 z-10">
        {isPOSMode && isCuentaCorriente && opcionesCuotas.length > 0 && onCuotasChange ? (
          <div
            role="radiogroup"
            aria-label="Forma de fiar"
            className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5"
          >
            {[null, ...opcionesCuotas.map((t) => t.cuotas)].map((n) => {
              const activa = cuotasElegidas === n;
              return (
                <button
                  key={n ?? "fiado"}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  onClick={() => onCuotasChange(n)}
                  disabled={isPending}
                  className={`h-11 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                    activa
                      ? "border-warning bg-warning/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n === null ? "Fiado" : `${n} cuotas`}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between font-mono text-sm text-muted-foreground">
            <span>SUBTOTAL</span>
            <span className="font-mono">
              {formatCurrency(totalCarrito)}
            </span>
          </div>
          {descuentoDetalle.monto > 0 ? (
            <div className="flex items-center justify-between font-mono text-sm text-success">
              <span>PROMOCIÓN: {descuentoDetalle.nombre}</span>
              <span className="font-mono">
                -{formatCurrency(descuentoDetalle.monto)}
              </span>
            </div>
          ) : null}
          {/* RECARGO LIBRE: opcional, plegado, debajo de los descuentos. Solo en
              una venta de contado (en cuenta corriente manda el recargo de
              fiar, más abajo) y solo con permiso. */}
          {!isCuentaCorriente && onRecargoLibrePctChange ? (
            recargoLibrePct > 0 || editandoRecargoLibre ? (
              <>
                {recargoLibrePct > 0 ? (
                  <div className="flex items-center justify-between font-mono text-sm text-warning">
                    <span className="flex items-center gap-2">
                      <span>
                        RECARGO{" "}
                        <span className="text-[11px]">
                          {formatearPct(recargoLibrePct)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditandoRecargoLibre((v) => !v)}
                        disabled={isPending}
                        aria-expanded={editandoRecargoLibre}
                        className="text-[11px] uppercase tracking-wide underline underline-offset-2 hover:text-foreground disabled:opacity-50 cursor-pointer"
                      >
                        Modificar
                      </button>
                    </span>
                    <span>+{formatCurrency(recargoLibreMonto)}</span>
                  </div>
                ) : null}
                {editandoRecargoLibre ? (
                  <EditorRecargo
                    pctActual={recargoLibrePct}
                    pctDefault={0}
                    hayEleccion={false}
                    onElegir={(pct) => onRecargoLibrePctChange(pct ?? 0)}
                    onCerrar={() => setEditandoRecargoLibre(false)}
                    deshabilitado={isPending}
                  />
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditandoRecargoLibre(true)}
                disabled={isPending}
                className="text-left text-[11px] uppercase tracking-wide text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50 cursor-pointer"
              >
                + Recargo
              </button>
            )
          ) : null}
          {mostrarLineaCC ? (
            <div
              className={`flex items-center justify-between font-mono text-sm ${
                ccSinRecargo
                  ? "text-muted-foreground"
                  : "text-warning"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>
                  RECARGO CC{" "}
                  <span className="text-[11px]">
                    {formatearPct(
                      ccSinRecargo ? ccRecargoPctDefault : pctCcAplicado,
                    )}
                  </span>
                </span>
                {onCcRecargoPctChange ? (
                  <button
                    type="button"
                    onClick={() => setEditandoRecargoCc((v) => !v)}
                    disabled={isPending}
                    aria-expanded={editandoRecargoCc}
                    className="text-[11px] uppercase tracking-wide underline underline-offset-2 hover:text-foreground disabled:opacity-50 cursor-pointer"
                  >
                    Modificar
                  </button>
                ) : null}
              </span>
              <span className={ccSinRecargo ? "line-through" : ""}>
                +{formatCurrency(recargoCCMostrado)}
              </span>
            </div>
          ) : null}
          {mostrarLineaCC && onCcRecargoPctChange && editandoRecargoCc ? (
            <EditorRecargo
              pctActual={pctCcAplicado}
              pctDefault={ccRecargoPctDefault}
              hayEleccion={ccRecargoPct !== null}
              onElegir={onCcRecargoPctChange}
              onCerrar={() => setEditandoRecargoCc(false)}
              deshabilitado={isPending}
            />
          ) : null}
          {planCuotas && planCuotas.interes > 0 ? (
            <div className="flex items-center justify-between font-mono text-sm text-warning">
              <span className="uppercase">
                Financiación {planCuotas.cuotas} cuotas ({planCuotas.pct}%)
              </span>
              <span>+{formatCurrency(planCuotas.interes)}</span>
            </div>
          ) : null}
          {recargoMetodoMonto > 0 ? (
            <div className="flex items-center justify-between font-mono text-sm text-warning">
              <span className="truncate uppercase">
                {recargoMetodoEtiqueta || "Recargo por método"}
              </span>
              <span className="font-mono">
                +{formatCurrency(recargoMetodoMonto)}
              </span>
            </div>
          ) : null}
          {saldoAFavorAplicado > 0 ? (
            <div className="flex items-center justify-between font-mono text-sm text-success">
              <span className="uppercase">Saldo a favor</span>
              <span className="font-mono">
                -{formatCurrency(saldoAFavorAplicado)}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-mono text-xl font-semibold uppercase text-foreground">
              {saldoAFavorAplicado > 0 ? "A cobrar" : "Total"}
            </span>
            <span className="font-mono text-2xl font-medium text-foreground">
              {formatCurrency(totalACobrar ?? totalFinal)}
            </span>
          </div>
          {planCuotas && planCuotas.financiado > 0 ? (
            <p className="text-right text-xs text-muted-foreground">
              Fiado: {planCuotas.cuotas} cuotas de{" "}
              {formatCurrency(planCuotas.detalle[0].monto)} · la 1ª vence el{" "}
              {diaMes(planCuotas.detalle[0].venceEl)}
            </p>
          ) : null}
        </div>

        {isPOSMode && onEnviarACaja && !puedeCobrar ? (
          <Button
            onClick={onEnviarACaja}
            disabled={isPending || totalCarrito <= 0}
            className="w-full h-12 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white transition-colors shadow-none cursor-pointer"
          >
            {isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-5 h-5" />
                Enviar a caja
              </>
            )}
          </Button>
        ) : isPOSMode && !puedeCobrar ? (
          // Sin permiso de cobrar y sin pedidos a caja: no hay a dónde
          // mandar la venta. Se dice, en vez de dejar un botón que rebota.
          <Button
            disabled
            className="w-full h-12 flex items-center justify-center gap-2 shadow-none"
            variant="outline"
          >
            Sin permiso para cobrar
          </Button>
        ) : isPOSMode ? (
          <Button
            data-wizard="cobrar"
            onClick={handleCobrar}
            disabled={isPrimaryDisabled}
            className="w-full h-12 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white transition-colors shadow-none cursor-pointer"
          >
            {isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                {isReserva
                  ? "Confirmar Reserva"
                  : isCuentaCorriente
                    ? "Confirmar Fiado"
                    : "Confirmar Venta"}
              </>
            )}
          </Button>
        ) : (
          <Link
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onEnviarPedidoWhatsApp}
            className="w-full flex items-center justify-center gap-3 h-12 rounded-lg bg-[#25D366] hover:bg-[#1EBE57] text-white font-bold text-sm uppercase tracking-widest shadow-none cursor-pointer"
          >
            <Image src="/whatsappp.png" alt="Whatsapp" width={20} height={20} />
            Enviar Pedido
          </Link>
        )}

        {isPOSMode && accionSecundaria}
      </div>

      {modalAbierto && (
        <PaymentModal
          totalFinal={totalFinal}
          totalACobrar={totalACobrar}
          recargoPorcentajeSeleccionado={recargoPorcentajeSeleccionado}
          sumaPagos={sumaPagos}
          isPending={isPending}
          clienteSeleccionado={clienteSeleccionado}
          isCuentaCorriente={isCuentaCorriente}
          anticipoMinimo={anticipoMinimo}
          isEfectivoOnly={isEfectivoOnly}
          planCuotas={planCuotasModal}
          onConfirm={handleConfirmar}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </>
  );
}
