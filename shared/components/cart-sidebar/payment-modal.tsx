"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Loader2,
  Calculator,
  AlertTriangle,
  UserX,
  CheckCircle2,
  CreditCard,
  BookUser,
} from "lucide-react";
import { ClienteBasico } from "./client-selector";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import { montosRapidosEfectivo } from "@/features/pos/lib/montos-efectivo";

interface PaymentModalProps {
  /** Total de la mercadería, SIN recargo por método. */
  totalFinal: number;
  /** Lo que el cliente entrega (incluye el recargo por método). */
  totalACobrar?: number;
  /** % de recargo del método elegido, para calcular el recargo del anticipo
   * mientras se tipea en Cuenta Corriente. */
  recargoPorcentajeSeleccionado?: number;
  sumaPagos: number;
  isPending: boolean;
  clienteSeleccionado: ClienteBasico | null;
  isCuentaCorriente: boolean;
  anticipoMinimo: number;
  isEfectivoOnly: boolean;
  onConfirm: (montoAnticipo?: number) => void;
  onClose: () => void;
}

export function PaymentModal({
  totalFinal,
  totalACobrar,
  recargoPorcentajeSeleccionado = 0,
  sumaPagos,
  isPending,
  clienteSeleccionado,
  isCuentaCorriente,
  anticipoMinimo,
  isEfectivoOnly,
  onConfirm,
  onClose,
}: Readonly<PaymentModalProps>) {
  const [montoRecibido, setMontoRecibido] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [anticipoLocal, setAnticipoLocal] = useState<string>(
    anticipoMinimo.toString(),
  );
  const anticipoLocalNum = Number(anticipoLocal) || 0;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // 1. LÓGICA DE VENTA NORMAL (Al Contado)
  if (!isCuentaCorriente) {
    // El sobrepago se mide contra la mercadería (bases), que es lo que los
    // pagos tienen que cubrir; el vuelto, contra lo que el cliente entrega de
    // verdad (con recargo). Mezclarlos daría vuelto de menos justo en los
    // tickets con tarjeta.
    const isSobrePagoError = sumaPagos > totalFinal + 0.05;
    const montoACobrar = totalACobrar ?? totalFinal;
    const recibidoNum = Number(montoRecibido) || 0;
    const vuelto = recibidoNum > montoACobrar ? recibidoNum - montoACobrar : 0;
    const falta = montoRecibido !== "" && recibidoNum < montoACobrar;

    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[400px] bg-card p-6 rounded-2xl border-border shadow-xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              {isEfectivoOnly ? (
                <Calculator className="w-5 h-5 text-primary" />
              ) : (
                <CreditCard className="w-5 h-5 text-primary" />
              )}
              {isEfectivoOnly ? "Calculadora de Vuelto" : "Confirmar Cobro"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirmación de cobro normal.
            </DialogDescription>
          </DialogHeader>

          {isSobrePagoError ? (
            <div className="bg-danger/10 border border-danger/20 p-4 rounded-xl text-danger text-sm leading-relaxed">
              Has asignado <strong>${sumaPagos.toLocaleString("es-AR")}</strong>
              , superando el total del ticket de{" "}
              <strong>${totalFinal.toLocaleString("es-AR")}</strong>. Revisa los
              pagos para no descuadrar la caja.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Monto a cobrar</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    value={montoACobrar.toLocaleString("es-AR")}
                    readOnly
                    disabled
                    className="pl-8 font-mono font-medium h-11 text-lg text-foreground"
                  />
                </div>
                {montoACobrar > totalFinal ? (
                  <p className="text-[11px] font-medium text-warning">
                    Incluye $
                    {(montoACobrar - totalFinal).toLocaleString("es-AR")} de
                    recargo por el método de pago.
                  </p>
                ) : null}
              </div>

              {isEfectivoOnly ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="efectivo-recibido" className="text-sm font-semibold">
                      ¿Con cuánto billete físico paga?
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        $
                      </span>
                      <Input
                        ref={inputRef}
                        id="efectivo-recibido"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={montoRecibido}
                        onChange={(e) => setMontoRecibido(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && !isPending && onConfirm()
                        }
                        placeholder="Ej: 5000"
                        className="pl-8 font-mono font-medium h-11"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label="Montos rápidos de efectivo">
                      {[montoACobrar, ...montosRapidosEfectivo(montoACobrar)].map((monto, index) => (
                        <Button
                          key={index === 0 ? "justo" : monto}
                          type="button"
                          variant="outline"
                          className="h-11 flex-1 px-3 font-mono text-sm aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
                          disabled={isPending}
                          aria-pressed={montoRecibido !== "" && recibidoNum === monto}
                          onClick={() => setMontoRecibido(String(monto))}
                        >
                          {index === 0 ? "Justo" : `$${monto.toLocaleString("es-AR")}`}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div aria-live="polite" className={`flex justify-between pt-2 pb-2 font-semibold text-xl border-t border-border mt-4 ${falta ? "text-warning" : "text-foreground"}`}>
                    <span className="text-sm self-center">
                      {falta ? "Falta" : "Valor a devolver"}
                    </span>
                    <span className="font-mono font-medium">
                      $ {(falta ? montoACobrar - recibidoNum : vuelto).toLocaleString("es-AR")}
                    </span>
                  </div>
                </>
              ) : (
                <div className="bg-info/10 border border-info/20 p-4 rounded-xl text-info text-sm">
                  Procesa el cobro en tu terminal o cuenta digital y presiona
                  confirmar para asentar la venta.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-4 mt-2">
            <Button
              onClick={() => onConfirm()}
              disabled={isPending || isSobrePagoError}
              className="h-12 w-full"
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Confirmando…</>
              ) : (
                "Confirmar Venta"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // 2. 🚀 LÓGICA DE CUENTA CORRIENTE INTERACTIVA (Calculadora Fiado)
  const isAnticipoInsuficiente = anticipoLocalNum < anticipoMinimo - 0.05;
  // La deuda se calcula sobre el anticipo SIN recargo: el recargo es plata
  // que entra por el método de pago, no capital que el cliente amortiza.
  const deudaGenerada = totalFinal - anticipoLocalNum;
  const recargoAnticipo = calcularRecargoMonto(
    anticipoLocalNum,
    recargoPorcentajeSeleccionado,
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px] bg-card p-6 rounded-2xl border-border shadow-xl">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookUser className="w-5 h-5 text-warning" />
            Resumen de Fiado
          </DialogTitle>
          <DialogDescription className="sr-only">
            Aprobación de venta a cuenta corriente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex justify-between items-center text-sm font-semibold mb-2">
            <span className="text-foreground">TOTAL</span>
            <span className="text-lg font-mono font-medium">
              ${totalFinal.toLocaleString("es-AR")}
            </span>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              ¿Cuánto deja de anticipo hoy?
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground font-mono font-medium">
                $
              </span>
              <Input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={anticipoLocal}
                onChange={(e) => setAnticipoLocal(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  !isPending &&
                  !isAnticipoInsuficiente &&
                  clienteSeleccionado &&
                  onConfirm(anticipoLocalNum)
                }
                className="pl-8 h-12 text-lg font-mono font-medium border-border text-foreground"
                placeholder="0"
              />
            </div>
          </div>

          {recargoAnticipo > 0 ? (
            <div className="flex justify-between items-center text-xs font-medium text-warning">
              <span>
                Recargo del método ({recargoPorcentajeSeleccionado}%) sobre el
                anticipo
              </span>
              <span className="font-mono">
                +${recargoAnticipo.toLocaleString("es-AR")}
              </span>
            </div>
          ) : null}

          <div className="p-4 mt-4">
            {recargoAnticipo > 0 ? (
              <div className="flex justify-between items-center pb-3 mb-3 border-b border-border">
                <p className="text-sm text-muted-foreground font-medium">
                  Cobrás hoy
                </p>
                <p className="text-lg font-mono font-medium">
                  $
                  {(anticipoLocalNum + recargoAnticipo).toLocaleString("es-AR")}
                </p>
              </div>
            ) : null}
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground font-medium">
                Saldo a deber
              </p>
              <p className="text-2xl font-mono font-medium">
                ${Math.max(0, deudaGenerada).toLocaleString("es-AR")}
              </p>
            </div>

            {/* Advertencia suave si entrega poco dinero */}
            {isAnticipoInsuficiente && anticipoLocalNum >= 0 && (
              <div className="mt-3 pt-3 border-t border-border flex items-start gap-2 text-warning text-xs font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p>
                  El cliente está dejando un anticipo menor al mínimo sugerido
                  de ${anticipoMinimo.toLocaleString("es-AR")}.
                </p>
              </div>
            )}
          </div>

          {!clienteSeleccionado ? (
            <div className="flex items-center gap-3 text-danger bg-danger/10 p-3 rounded-lg border border-danger/20">
              <UserX className="w-6 h-6 shrink-0" />
              <p className="text-xs font-semibold leading-tight">
                Debes seleccionar un cliente en el paso anterior para poder
                registrarle la deuda.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-success bg-success/10 p-3 rounded-lg border border-success/20">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <p className="text-xs font-medium leading-tight">
                La deuda se registrará en la cuenta de{" "}
                <strong>{clienteSeleccionado.nombre}</strong>.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 mt-2">
          <Button
            onClick={() => onConfirm(anticipoLocalNum)}
            disabled={isPending || !clienteSeleccionado || deudaGenerada < 0}
            className="bg-warning hover:bg-warning/80 text-white h-12 w-full"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Confirmando…</>
            ) : (
              "Confirmar y Fiar"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
