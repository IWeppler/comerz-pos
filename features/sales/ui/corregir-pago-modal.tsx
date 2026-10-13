"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "@/shared/ui/toast";
import { Loader2 } from "lucide-react";
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
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import {
  corregirMetodoPagoAction,
  getMetodosParaCorreccionAction,
} from "../actions/corregir-metodo-pago";

type MetodoElegible = {
  id: string;
  nombre: string;
  tipo: string;
  recargo_porcentaje: number;
};

const pesos = (monto: number) => `$${Math.round(monto).toLocaleString("es-AR")}`;

/**
 * Corregir con qué se cobró una venta, sin anularla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MUESTRA LA DIFERENCIA ANTES DE CONFIRMAR, y ese es el punto del modal.
 *
 * Cambiar el método puede cambiar el TOTAL: si la venta se cargó como tarjeta
 * con 15% de recargo y en realidad fue transferencia, el ticket estuvo mal
 * desde el minuto cero y la clienta pagó otra cosa. La corrección no puede
 * resolver esa plata sola —se devuelve o se cobra en el mostrador— así que lo
 * mínimo es decir cuánto es, antes y no después.
 *
 * El número de la pantalla sale de `calcularRecargoMonto`, la MISMA función
 * que usa la RPC del server con los porcentajes de la base. Si cada lado
 * hiciera su cuenta, la vendedora aceptaría una diferencia y se aplicaría
 * otra — que es exactamente el error que no se puede cometer en la pantalla
 * donde se mueve plata.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los métodos se piden al ABRIR y no al montar: esta fila se dibuja diez veces
 * por página del historial y el listado solo hace falta cuando alguien va a
 * corregir de verdad.
 */
export function CorregirPagoModal({
  ventaId,
  metodoActualId,
  metodoActualNombre,
  montoBase,
  totalActual,
  recargoActual,
  open,
  onOpenChange,
}: Readonly<{
  ventaId: string;
  metodoActualId?: string | null;
  metodoActualNombre: string;
  /** La base del cobro: lo que vale la mercadería, sin el recargo. */
  montoBase: number;
  totalActual: number;
  recargoActual: number;
  /** Controlado desde el menú de la fila. Ver `sale-table.tsx`: un
   * DialogTrigger adentro de un DropdownMenu se desmonta con el menú antes de
   * que el diálogo llegue a abrirse. */
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
}>) {
  const abierto = open;
  const setAbierto = onOpenChange;
  // `null` es "todavía no se pidieron", que no es lo mismo que "no hay
  // ninguno": con un array vacío como inicial, el modal diría "no hay otros
  // métodos" durante el viaje al server.
  const [metodos, setMetodos] = useState<MetodoElegible[] | null>(null);
  const [elegido, setElegido] = useState<MetodoElegible | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, iniciar] = useTransition();

  const cargando = abierto && metodos === null;

  useEffect(() => {
    // Se pide UNA vez por vida del componente: los métodos de pago de un
    // comercio no cambian mientras alguien corrige un cobro, y volver a
    // pedirlos en cada apertura es un viaje a Ohio por cada clic.
    if (!abierto || metodos !== null) return;

    let vigente = true;

    getMetodosParaCorreccionAction().then(({ data, error }) => {
      if (!vigente) return;
      if (error) toast.error(error);
      setMetodos(data.filter((metodo) => metodo.id !== metodoActualId));
    });

    return () => {
      vigente = false;
    };
  }, [abierto, metodos, metodoActualId]);

  const recargoNuevo = elegido
    ? calcularRecargoMonto(montoBase, elegido.recargo_porcentaje)
    : 0;
  const totalNuevo = totalActual - recargoActual + recargoNuevo;
  const diferencia = totalNuevo - totalActual;

  const confirmar = () => {
    if (!elegido) return;

    iniciar(async () => {
      const { data, error } = await corregirMetodoPagoAction(
        ventaId,
        elegido.id,
        motivo,
      );

      if (error || !data) {
        toast.error(error ?? "No se pudo corregir el cobro.");
        return;
      }

      setAbierto(false);
      setElegido(null);
      setMotivo("");

      toast.success(`Cobro corregido a ${data.metodoNuevo}.`, {
        description:
          data.diferenciaTotal === 0
            ? "El total de la venta no cambió."
            : `El total pasó de ${pesos(data.totalAnterior)} a ${pesos(data.totalNuevo)}.`,
      });

      // La diferencia de plata NO la mueve el sistema: se devuelve o se cobra
      // en el mostrador. Va como aviso aparte y sin autocierre, mismo criterio
      // que los avisos de la anulación — adentro del toast de éxito se lee
      // como decoración y se pierde.
      if (data.diferenciaTotal !== 0) {
        toast.warning(
          data.diferenciaTotal > 0
            ? `Con el método nuevo el ticket sale ${pesos(data.diferenciaTotal)} más: hay que cobrarle esa diferencia.`
            : `Con el método nuevo el ticket sale ${pesos(-data.diferenciaTotal)} menos: hay que devolverle esa diferencia.`,
          { duration: Infinity, closeButton: true },
        );
      }
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir el cobro</DialogTitle>
          <DialogDescription>
            Esta venta figura cobrada con{" "}
            <strong className="text-foreground">{metodoActualNombre}</strong>.
            Elegí con qué se cobró en realidad.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {cargando ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (metodos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay otros métodos de pago activos para elegir.
            </p>
          ) : (
            <div className="grid gap-1.5">
              {(metodos ?? []).map((metodo) => {
                const activo = elegido?.id === metodo.id;
                return (
                  <button
                    key={metodo.id}
                    type="button"
                    onClick={() => setElegido(metodo)}
                    aria-pressed={activo}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      activo
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {metodo.nombre}
                    </span>
                    {metodo.recargo_porcentaje > 0 && (
                      <span className="shrink-0 text-xs font-medium text-warning">
                        +{metodo.recargo_porcentaje}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {elegido && (
            <div className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Total actual</span>
                <span className="font-medium">{pesos(totalActual)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Total corregido</span>
                <span className="font-medium">{pesos(totalNuevo)}</span>
              </div>
              {diferencia !== 0 && (
                <div
                  className={`flex justify-between border-t border-border pt-1.5 font-semibold ${
                    diferencia > 0 ? "text-warning" : "text-success"
                  }`}
                >
                  <span>
                    {diferencia > 0 ? "Hay que cobrarle" : "Hay que devolverle"}
                  </span>
                  <span>{pesos(Math.abs(diferencia))}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="motivo_correccion" className="text-xs">
              Motivo <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="motivo_correccion"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Ej: pagó por transferencia, no en efectivo"
              className="h-10 rounded-md"
            />
          </div>

          <Button
            type="button"
            onClick={confirmar}
            disabled={!elegido || enviando}
            className="h-11 w-full"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Corregir cobro"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
