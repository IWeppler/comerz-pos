"use client";

import { ReactNode, useEffect } from "react";
import {
  Banknote,
  CreditCard,
  Plus,
  Smartphone,
  Split,
  Tag,
  User,
  Wallet,
  X,
} from "lucide-react";
import { CreateSalePaymentInput } from "@/entities/ventas/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ClientSelector, ClienteBasico } from "./client-selector";
import { MetodoPagoPOS, PromocionDB } from "./types";
import { calcularPagosConRecargo } from "@/shared/lib/recargo-metodo";

interface CartStepCheckoutProps {
  isPOSMode: boolean;
  metodosPagoDB: MetodoPagoPOS[];
  pagos: CreateSalePaymentInput[];
  onPagosChange: (pagos: CreateSalePaymentInput[]) => void;
  totalFinal: number;
  isCuentaCorriente: boolean;
  onCuentaCorrienteChange: (value: boolean) => void;
  isReserva?: boolean;
  onReservaChange?: (value: boolean) => void;
  modoMixto: boolean;
  onModoMixtoChange: (value: boolean) => void;
  anticipoMinimo: number;
  clienteSeleccionado: ClienteBasico | null;
  onClienteChange: (cliente: ClienteBasico | null) => void;
  /** Apertura controlada del selector de cliente. La usa el atajo F7. */
  selectorClienteAbierto?: boolean;
  onSelectorClienteAbiertoChange?: (abierto: boolean) => void;
  promocionesElegibles: PromocionDB[];
  promocionActivaId: string;
  onPromocionChange: (promocionId: string) => void;
  children?: ReactNode;
}

const getPaymentIcon = (tipo: string) => {
  if (tipo === "TRANSFERENCIA") return Smartphone;
  if (tipo === "BILLETERA_VIRTUAL") return Wallet;
  if (tipo === "TARJETA") return CreditCard;
  return Banknote;
};

export function CartStepCheckout({
  isPOSMode,
  metodosPagoDB,
  pagos,
  onPagosChange,
  totalFinal,
  isCuentaCorriente,
  onCuentaCorrienteChange,
  isReserva = false,
  onReservaChange,
  modoMixto,
  onModoMixtoChange,
  anticipoMinimo,
  clienteSeleccionado,
  onClienteChange,
  selectorClienteAbierto,
  onSelectorClienteAbiertoChange,
  promocionesElegibles,
  promocionActivaId,
  onPromocionChange,
  children,
}: Readonly<CartStepCheckoutProps>) {
  // El anticipo de cuenta corriente NO se edita en este paso: se tipea en
  // `payment-modal.tsx` y vuelve por su `onConfirm`. Acá solo se propone el
  // mínimo configurado como monto de arranque.
  //
  // Había un `anticipoManual` con su handler, resto de cuando sí se editaba
  // inline. Nadie llamaba al handler, así que el estado era siempre "" y el
  // anticipo siempre el mínimo: un useState que parecía editable y no lo era,
  // que es justo la clase de cosa que alguien "arregla" mal más adelante.
  const montoObjetivo = isCuentaCorriente ? anticipoMinimo : totalFinal;
  // `montoAsignado` es la base: lo que ese cobro cubre del ticket. Por eso
  // la diferencia ("falta asignar") se calcula sin recargo — si el recargo
  // contara, un método recargado parecería cubrir más ticket del que cubre.
  const sumaPagos = pagos.reduce(
    (acc, pago) => acc + Number(pago.montoAsignado || 0),
    0,
  );
  const diferencia = montoObjetivo - sumaPagos;
  const recargoPorPago = calcularPagosConRecargo(
    pagos,
    metodosPagoDB,
  ).pagos.map((pago) => pago.recargoMonto);

  const syncSinglePayment = (monto: number, metodoId?: string) => {
    // Para Cuenta Corriente no autocompletamos ningún método salvo que
    // venga explícito (metodoId, ej. un click real sobre un botón de
    // método): un default silencioso al primer método de la lista ya
    // generó pagos mal asignados sin que nadie lo note.
    const currentMethodId =
      metodoId ||
      pagos[0]?.metodoPagoId ||
      (isCuentaCorriente ? undefined : metodosPagoDB[0]?.id);
    if (!currentMethodId) return;
    onPagosChange([{ metodoPagoId: currentMethodId, montoAsignado: monto }]);
  };

  useEffect(() => {
    // Mismo criterio que syncSinglePayment: en Cuenta Corriente el
    // selector arranca vacío y el usuario lo elige a mano. En Venta
    // Regular se mantiene el default de siempre (primer método).
    if (isCuentaCorriente) return;
    if (!modoMixto && metodosPagoDB.length > 0) {
      const currentMethodId = pagos[0]?.metodoPagoId || metodosPagoDB[0]?.id;

      if (pagos.length !== 1 || pagos[0].metodoPagoId !== currentMethodId) {
        onPagosChange([
          { metodoPagoId: currentMethodId, montoAsignado: montoObjetivo },
        ]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalFinal, isCuentaCorriente, modoMixto, metodosPagoDB]);

  // handlers
  const handleCuentaCorrienteChange = (value: boolean) => {
    onCuentaCorrienteChange(value);
    onModoMixtoChange(false);
    if (value) {
      // Entrando a Cuenta Corriente: NO heredamos el método que pudiera
      // haber quedado seleccionado de Venta Regular — arranca vacío.
      onPagosChange([]);
    } else {
      syncSinglePayment(totalFinal);
    }
  };

  const handleReservaChange = (value: boolean) => {
    onReservaChange?.(value);
    onModoMixtoChange(false);
  };

  const handleSelectPagoRapido = (metodoId: string) => {
    onModoMixtoChange(false);
    syncSinglePayment(montoObjetivo, metodoId);
  };

  const handleToggleMixto = () => {
    const nextValue = !modoMixto;
    onModoMixtoChange(nextValue);
    if (!nextValue) {
      syncSinglePayment(montoObjetivo);
    } else if (pagos.length === 0) {
      syncSinglePayment(montoObjetivo);
    }
  };

  const handleAddPago = () => {
    const firstMethodId = metodosPagoDB[0]?.id;
    if (!firstMethodId) return;
    onPagosChange([
      ...pagos,
      {
        metodoPagoId: firstMethodId,
        montoAsignado: diferencia > 0 ? diferencia : 0,
      },
    ]);
  };

  const handleUpdatePago = (
    index: number,
    field: keyof CreateSalePaymentInput,
    value: string | number,
  ) => {
    const nextPagos = [...pagos];
    nextPagos[index] = { ...nextPagos[index], [field]: value };
    onPagosChange(nextPagos);
  };

  const handleRemovePago = (index: number) => {
    const nextPagos = pagos.filter((_, currentIndex) => currentIndex !== index);
    if (nextPagos.length === 1) {
      nextPagos[0] = { ...nextPagos[0], montoAsignado: montoObjetivo };
    }
    onPagosChange(nextPagos);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex-1 overflow-y-auto p-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="space-y-4">
          {/* TIPO DE VENTA */}
          <section className="space-y-3 rounded-lg border border-border bg-muted p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Tipo de Venta
            </h3>
            <div
              className={`grid gap-2 ${onReservaChange ? "grid-cols-3" : "grid-cols-2"}`}
            >
              <Button
                type="button"
                variant={
                  !isCuentaCorriente && !isReserva ? "default" : "outline"
                }
                onClick={() => {
                  handleCuentaCorrienteChange(false);
                  handleReservaChange(false);
                }}
                className="h-11"
              >
                Venta
              </Button>
              <Button
                type="button"
                variant={isCuentaCorriente ? "default" : "outline"}
                onClick={() => handleCuentaCorrienteChange(true)}
                className="h-11"
              >
                C. Corriente
              </Button>
              {onReservaChange ? (
                <Button
                  type="button"
                  variant={isReserva ? "default" : "outline"}
                  onClick={() => handleReservaChange(true)}
                  className="h-11"
                >
                  Reservado
                </Button>
              ) : null}
            </div>
          </section>

          {/* El comprobante (factura / sin factura) ya no va acá: vive en el
              header del ticket, ver SelectorComprobante. */}

          {/* SELECTOR DE CLIENTES */}
          <section className="space-y-3 rounded-lg border border-border bg-muted p-4">
            <div className="flex items-center gap-1">
              <User className="w-4 h-4" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Cliente{" "}
                {isCuentaCorriente ? (
                  <span className="text-danger">*</span>
                ) : null}
              </h3>
            </div>
            <ClientSelector
              clienteSeleccionado={clienteSeleccionado}
              onClienteChange={onClienteChange}
              abierto={selectorClienteAbierto}
              onAbiertoChange={onSelectorClienteAbiertoChange}
            />
          </section>

          {!isReserva && isPOSMode ? (
            <section className="space-y-3 rounded-lg border border-border bg-muted p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Metodos de Pago
                </h3>
                {metodosPagoDB.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleToggleMixto}
                    className="h-8 px-2 text-xs text-primary"
                  >
                    <Split className="mr-1.5 h-3.5 w-3.5" />
                    {modoMixto ? "Pago rapido" : "Pago Mixto"}
                  </Button>
                ) : null}
              </div>

              {metodosPagoDB.length === 0 ? (
                <div className="border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
                  Sin metodos de pago activos.
                </div>
              ) : !modoMixto ? (
                <div className="grid grid-cols-3 gap-2">
                  {metodosPagoDB.map((metodo) => {
                    const Icon = getPaymentIcon(metodo.tipo);
                    const isSelected = pagos[0]?.metodoPagoId === metodo.id;

                    return (
                      <button
                        key={metodo.id}
                        type="button"
                        onClick={() => handleSelectPagoRapido(metodo.id)}
                        className={`flex min-h-18 flex-col items-center justify-center gap-2 border px-2 py-3 text-xs font-bold transition-colors rounded-lg cursor-pointer ${
                          isSelected
                            ? "border-primary bg-card text-primary"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="w-full truncate text-center">
                          {metodo.nombre}
                        </span>
                        {Number(metodo.recargo_porcentaje) > 0 ? (
                          <span className="text-[10px] font-bold text-warning">
                            +{metodo.recargo_porcentaje}%
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {pagos.map((pago, index) => (
                    <div
                      key={`${pago.metodoPagoId}-${index}`}
                      className="space-y-1 bg-card p-2 rounded-lg border border-border"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={pago.metodoPagoId}
                          onValueChange={(value) =>
                            handleUpdatePago(index, "metodoPagoId", value)
                          }
                        >
                          <SelectTrigger className="h-10 w-34 border-0 bg-transparent font-semibold text-xs">
                            <SelectValue placeholder="Metodo" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {metodosPagoDB.map((metodo) => (
                              <SelectItem
                                key={metodo.id}
                                value={metodo.id}
                                className="text-xs font-semibold"
                              >
                                {metodo.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                            $
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={pago.montoAsignado || ""}
                            onChange={(event) =>
                              handleUpdatePago(
                                index,
                                "montoAsignado",
                                Number(event.target.value || 0),
                              )
                            }
                            className="h-10 border-0 bg-transparent pl-7 font-bold text-sm"
                          />
                        </div>

                        {pagos.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemovePago(index)}
                            className="h-10 w-10 text-muted-foreground rounded-md"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>

                      {/* El monto tipeado es la BASE (lo que cubre del
                          ticket); el recargo se muestra aparte para que
                          quede claro que no descuenta mercadería. */}
                      {recargoPorPago[index] > 0 ? (
                        <p className="px-2 text-[11px] font-semibold text-warning">
                          + ${recargoPorPago[index].toLocaleString("es-AR")} de
                          recargo — se cobran $
                          {(
                            Number(pago.montoAsignado || 0) +
                            recargoPorPago[index]
                          ).toLocaleString("es-AR")}
                        </p>
                      ) : null}
                    </div>
                  ))}

                  {Math.abs(diferencia) > 0.05 ? (
                    <div
                      className={`border p-2 text-[11px] font-bold uppercase tracking-widest rounded-lg text-center ${diferencia > 0 ? "border-border bg-muted text-foreground" : "border-danger/20 bg-danger/10 text-danger"}`}
                    >
                      {diferencia > 0
                        ? `Falta asignar: $${diferencia.toLocaleString("es-AR")}`
                        : `El cliente excede: $${Math.abs(diferencia).toLocaleString("es-AR")}`}
                    </div>
                  ) : null}

                  {diferencia > 0.05 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddPago}
                      className="h-10 w-full border-dashed rounded-lg text-xs font-bold text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Agregar otro metodo
                    </Button>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {/* DESCUENTOS Y PROMOCIONES */}
          {!isCuentaCorriente && !isReserva ? (
            <section className="space-y-3 rounded-lg border border-border bg-muted p-4">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Descuentos
                </h3>
              </div>
              {promocionesElegibles.length > 0 ? (
                <Select
                  value={promocionActivaId || "ninguna"}
                  onValueChange={onPromocionChange}
                >
                  <SelectTrigger className="h-11 border-border bg-card rounded-lg font-medium text-sm">
                    <SelectValue placeholder="Aplicar descuento" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="ninguna">Sin descuento</SelectItem>
                    {promocionesElegibles.map((promo) => (
                      <SelectItem
                        key={promo.id}
                        value={promo.id}
                        className="font-semibold text-success"
                      >
                        {promo.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground rounded-lg">
                  No hay descuentos aplicables.
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
