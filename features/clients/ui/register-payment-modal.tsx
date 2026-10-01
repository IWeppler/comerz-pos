"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Loader2, DollarSign, Wallet } from "lucide-react";
import { toast } from "sonner";
import { registrarPagoDeudaAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";
import { Cliente } from "@/entities/clientes/type";
import { MetodoPago } from "@/entities/payments/types";
import { cn } from "@/lib/utils";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import { useReciboCcStore } from "@/shared/store/recibo-cc-store";
import { deudaDe } from "../lib/saldo-a-favor";
import { excedenteSobreDeuda } from "../lib/tope-cobro-cc";
import { type GrupoDeuda } from "../lib/deuda-por-mes";
import { QueCobrar } from "./que-cobrar";

export function RegisterPaymentModal({
  cliente,
  metodosPago,
  recargoMoraEstimado = 0,
  gruposDeuda = [],
  className,
}: {
  cliente: Cliente;
  metodosPago: MetodoPago[];
  recargoMoraEstimado?: number;
  /** La deuda por mes de vencimiento, para elegir qué cobrar con un toque. */
  gruposDeuda?: GrupoDeuda[];
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Id del cobro, generado al ABRIR y repetido en cada reintento: es la clave
  // de idempotencia de `registrar_cobro_cc`. Tocar Confirmar dos veces o
  // reintentar después de un error de red no registra dos cobros.
  const [pagoId, setPagoId] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  // Deuda, no saldo crudo: con saldo a favor (negativo) no hay nada que
  // sugerir cobrar, y este modal pasa a ser el de la seña.
  const saldoBase = deudaDe(cliente.saldo_pendiente);
  const montoSugerido = saldoBase + recargoMoraEstimado;
  const esSena = montoSugerido <= 0;
  // Dejar plata a favor pide confirmación explícita: sin ella el server la
  // rechaza, que es el freno contra el cobro duplicado.
  const [confirmaAFavor, setConfirmaAFavor] = useState(false);

  // Monto y método son controlados solo para poder mostrar el recargo por
  // método en vivo: lo que se imputa a la deuda es el monto tipeado, y el
  // recargo se cobra encima. El server recalcula igual el mismo número.
  const [monto, setMonto] = useState<string>(
    esSena ? "" : montoSugerido.toString(),
  );
  const excedente = excedenteSobreDeuda(Number(monto) || 0, montoSugerido);
  const [metodoPagoId, setMetodoPagoId] = useState<string>(
    metodosPago[0]?.id ?? "",
  );
  const metodoElegido = metodosPago.find((m) => m.id === metodoPagoId);
  const recargoMetodo = calcularRecargoMonto(
    Number(monto) || 0,
    Number(metodoElegido?.recargo_porcentaje ?? 0),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);

    startTransition(async () => {
      const result = await registrarPagoDeudaAction(null, formData);
      if (result.success) {
        if (result.yaRegistrado) {
          toast.info(
            `Este cobro ya estaba registrado ($${(result.montoYaRegistrado ?? 0).toLocaleString("es-AR")}). No se cobró de nuevo.`,
          );
        } else {
          toast.success(
            "Pago registrado exitosamente. La deuda se ha actualizado.",
          );
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(cliente.id),
        });
        setIsOpen(false);
        // El recibo se abre con lo que el server ESCRIBIÓ, para imprimirlo.
        if (result.recibo) useReciboCcStore.getState().mostrar(result.recibo);
      } else {
        toast.error(result.error || "Ocurrió un error.");
      }
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(abrir) => {
        // Cada apertura es un cobro nuevo, con su propio id.
        if (abrir) {
          setPagoId(crypto.randomUUID());
          setConfirmaAFavor(false);
        }
        setIsOpen(abrir);
      }}
    >
      <DialogTrigger asChild>
        <Button
          className={cn("bg-primary hover:bg-primary/80 text-white", className)}
        >
          <DollarSign className="w-4 h-4 mr-1.5" />{" "}
          {esSena ? "Registrar seña" : "Registrar Cobro"}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-100 bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Asentar pago a cuenta
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <input type="hidden" name="cliente_id" value={cliente.id} />
          <input type="hidden" name="pago_id" value={pagoId} />
          <input
            type="hidden"
            name="permitir_saldo_a_favor"
            value={excedente > 0 && confirmaAFavor ? "true" : "false"}
          />

          {!esSena && gruposDeuda.length > 0 && (
            <QueCobrar
              grupos={gruposDeuda}
              mora={recargoMoraEstimado}
              montoActual={Number(monto) || 0}
              onElegir={(valor) => setMonto(String(valor))}
            />
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Monto que descuenta de la deuda
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                $
              </span>
              <Input
                name="monto"
                type="number"
                min="1"
                step="any"
                placeholder={montoSugerido.toString()}
                value={monto}
                onChange={(event) => setMonto(event.target.value)}
                required
                className="pl-8 h-12 text-lg font-bold shadow-none border-border"
              />
            </div>
            {recargoMoraEstimado > 0 ? (
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <p>Saldo base: ${saldoBase.toLocaleString("es-AR")}</p>
                <p className="text-danger font-semibold">
                  Recargo por mora: $
                  {recargoMoraEstimado.toLocaleString("es-AR")}
                </p>
                <p className="font-semibold text-foreground">
                  Total sugerido: ${montoSugerido.toLocaleString("es-AR")}
                </p>
                <p className="italic">
                  Estimado sobre tickets vencidos — el monto sigue siendo
                  editable.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {esSena
                  ? "No debe nada: lo que cobres queda como saldo a favor."
                  : `Deuda total: $${saldoBase.toLocaleString("es-AR")}`}
              </p>
            )}
            {excedente > 0 ? (
              <label className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2 text-xs">
                <input
                  type="checkbox"
                  checked={confirmaAFavor}
                  onChange={(e) => setConfirmaAFavor(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Dejar{" "}
                  <strong>
                    ${excedente.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                  </strong>{" "}
                  a favor de {cliente.nombre}. Se descuentan de su próxima
                  compra.
                </span>
              </label>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              ¿Cómo te paga?
            </Label>
            <Select
              name="metodo_pago_id"
              required
              value={metodoPagoId}
              onValueChange={setMetodoPagoId}
            >
              <SelectTrigger className="h-12 border-border bg-card shadow-none font-semibold">
                <SelectValue placeholder="Seleccionar método..." />
              </SelectTrigger>
              <SelectContent>
                {metodosPago.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="font-medium">
                    {m.nombre}
                    {Number(m.recargo_porcentaje) > 0
                      ? ` (+${m.recargo_porcentaje}%)`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recargoMetodo > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex justify-between text-warning">
                  <span>
                    Recargo {metodoElegido?.nombre} (
                    {metodoElegido?.recargo_porcentaje}%)
                  </span>
                  <span className="font-mono font-bold">
                    +${recargoMetodo.toLocaleString("es-AR")}
                  </span>
                </div>
                <div className="mt-1.5 flex justify-between border-t border-amber-200 pt-1.5 font-bold text-foreground dark:border-amber-900/50">
                  <span>Cobrás</span>
                  <span className="font-mono">
                    $
                    {((Number(monto) || 0) + recargoMetodo).toLocaleString(
                      "es-AR",
                    )}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              Este dinero ingresará directamente en el arqueo de tu Caja de hoy.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || (excedente > 0 && !confirmaAFavor)}
              className="bg-primary hover:bg-primary/80 text-white"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Confirmar Ingreso
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
