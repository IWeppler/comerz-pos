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

interface DescuentoDetalle {
  monto: number;
  nombre: string;
}

interface CartSidebarFooterProps {
  isPOSMode: boolean;
  isPending: boolean;
  totalCarrito: number;
  /** Recargo CC efectivamente aplicado: 0 si la vendedora lo anuló. */
  recargoCuentaCorriente: number;
  /** Lo que el recargo CC sería si se aplicara. Se usa para poder mostrar la
   * línea (y el botón de restaurar) cuando está anulado. */
  recargoCuentaCorrientePotencial?: number;
  ccSinRecargo?: boolean;
  onCcSinRecargoChange?: (value: boolean) => void;
  /** Recargo por método de pago. Ya NO está incluido en `totalFinal`. */
  recargoMetodoMonto?: number;
  recargoMetodoEtiqueta?: string;
  /** Total del ticket SIN recargo por método: es contra este número que se
   * valida que los pagos cubran la mercadería. */
  totalFinal: number;
  /** Lo que el cliente entrega: totalFinal + recargo por método. */
  totalACobrar?: number;
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
}

const formatCurrency = (amount: number) =>
  amount.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export function CartSidebarFooter({
  isPOSMode,
  isPending,
  totalCarrito,
  totalFinal,
  totalACobrar,
  sumaPagos,
  recargoCuentaCorriente,
  recargoCuentaCorrientePotencial = 0,
  ccSinRecargo = false,
  onCcSinRecargoChange,
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
}: Readonly<CartSidebarFooterProps>) {
  const [modalAbierto, setModalAbierto] = useState(false);

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

  // La línea de recargo CC sigue visible cuando está anulado (tachada), para
  // que la vendedora vea qué se le está perdonando al cliente y pueda
  // deshacerlo. `recargoCuentaCorriente` ya viene en 0 en ese caso.
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
          {mostrarLineaCC ? (
            <div
              className={`flex items-center justify-between font-mono text-sm ${
                ccSinRecargo
                  ? "text-muted-foreground"
                  : "text-warning"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>RECARGO CC</span>
                {onCcSinRecargoChange ? (
                  <button
                    type="button"
                    onClick={() => onCcSinRecargoChange(!ccSinRecargo)}
                    disabled={isPending}
                    className="text-[11px] uppercase tracking-wide underline underline-offset-2 hover:text-foreground disabled:opacity-50 cursor-pointer"
                  >
                    {ccSinRecargo ? "Aplicar" : "Anular"}
                  </button>
                ) : null}
              </span>
              <span className={ccSinRecargo ? "line-through" : ""}>
                +{formatCurrency(recargoCCMostrado)}
              </span>
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
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-mono text-xl font-semibold uppercase text-foreground">
              Total
            </span>
            <span className="font-mono text-2xl font-medium text-foreground">
              {formatCurrency(totalACobrar ?? totalFinal)}
            </span>
          </div>
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
          onConfirm={handleConfirmar}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </>
  );
}
