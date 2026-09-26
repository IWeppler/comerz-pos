"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Minus, Plus } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  MOTIVOS_ANULACION,
  type MotivoAnulacion,
} from "@/features/sales/lib/motivo-anulacion";
import {
  getRenglonesDevolviblesAction,
  type RenglonDevolvible,
} from "../actions/renglones-devolvibles";
import {
  registrarDevolucionAction,
  type LineaDevolucion,
} from "../actions/registrar-devolucion";
import {
  getOpcionesReintegroAction,
  type OpcionesReintegro,
} from "../actions/opciones-reintegro";
import {
  SelectorMedioReintegro,
  faltaElegirMedio,
} from "./selector-medio-reintegro";

const pesos = (monto: number) => `$${Math.round(monto).toLocaleString("es-AR")}`;

type Eleccion = { cantidad: number; destino: "STOCK" | "BAJA" };

/**
 * Devolver parte de una venta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL DESTINO SE ELIGE POR RENGLÓN, no por ticket. Es la diferencia concreta
 * con anular: una clienta que devuelve dos prendas y una vino con una falla es
 * un caso normal del mostrador, y hasta ahora había que elegir un solo destino
 * para todo o partir la operación en dos.
 *
 * EL TOTAL SE MUESTRA MIENTRAS SE ELIGE, no al confirmar, y es EXACTO: lo que
 * se devuelve es `precio_final × cantidad` —el precio unitario ya tiene restado
 * el descuento del renglón— y nada más. El recargo por medio de pago no entra,
 * así que el número de esta pantalla es el mismo que va a calcular el server.
 *
 * Que el recargo no se devuelva no es un detalle contable: cuando un ticket
 * lleva recargo por débito o tarjeta es porque el banco le retuvo esa comisión
 * al comercio, y en una devolución el banco no la reintegra. Devolvérsela a la
 * clienta la pone el comercio de su bolsillo. Ver 20260903190000.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function DevolucionModal({
  ventaId,
  numeroTicket,
  open,
  onOpenChange,
}: Readonly<{
  ventaId: string;
  numeroTicket: string;
  /** Controlado desde el menú de la fila. Ver `sale-table.tsx`: un
   * DialogTrigger adentro de un DropdownMenu se desmonta con el menú. */
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
}>) {
  const abierto = open;
  const setAbierto = onOpenChange;
  const [renglones, setRenglones] = useState<RenglonDevolvible[] | null>(null);
  const [elegidos, setElegidos] = useState<Record<string, Eleccion>>({});
  const [motivoCodigo, setMotivoCodigo] = useState<MotivoAnulacion | null>(null);
  const [motivoDetalle, setMotivoDetalle] = useState("");
  const [opciones, setOpciones] = useState<OpcionesReintegro | null>(null);
  const [medioReintegro, setMedioReintegro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  useEffect(() => {
    if (!abierto) return;

    let vigente = true;
    getRenglonesDevolviblesAction(ventaId).then(({ data, error }) => {
      if (!vigente) return;
      if (error) toast.error(error);
      setRenglones(data);
    });
    // Las opciones de reintegro se piden al ABRIR, junto con los renglones:
    // son dos consultas de la misma pantalla y ninguna tiene sentido en las
    // diez filas de la tabla. Mismo criterio que la restaurabilidad al anular.
    getOpcionesReintegroAction(ventaId).then((resultado) => {
      if (vigente) setOpciones(resultado);
    });

    return () => {
      vigente = false;
    };
  }, [abierto, ventaId]);

  const cambiarCantidad = (renglon: RenglonDevolvible, delta: number) => {
    setElegidos((previos) => {
      const actual = previos[renglon.ventaItemId]?.cantidad ?? 0;
      const cantidad = Math.max(
        0,
        Math.min(renglon.disponible, actual + delta),
      );

      if (cantidad === 0) {
        const resto = { ...previos };
        delete resto[renglon.ventaItemId];
        return resto;
      }

      return {
        ...previos,
        [renglon.ventaItemId]: {
          cantidad,
          // Por defecto vuelve al inventario, salvo que su variante ya no
          // exista: ahí no hay inventario al que volver y ofrecerlo sería
          // prometer algo que no pasa.
          destino: previos[renglon.ventaItemId]?.destino
            ?? (renglon.puedeVolverAlStock ? "STOCK" : "BAJA"),
        },
      };
    });
  };

  const cambiarDestino = (ventaItemId: string, destino: "STOCK" | "BAJA") => {
    setElegidos((previos) =>
      previos[ventaItemId]
        ? { ...previos, [ventaItemId]: { ...previos[ventaItemId], destino } }
        : previos,
    );
  };

  const base = (renglones ?? []).reduce((acc, renglon) => {
    const cantidad = elegidos[renglon.ventaItemId]?.cantidad ?? 0;
    return acc + renglon.precioFinal * cantidad;
  }, 0);

  const hayAlgo = Object.keys(elegidos).length > 0;
  const cargandoOpciones = renglones === null || opciones === null;
  const medioPendiente = faltaElegirMedio(opciones, medioReintegro);
  const pasoPendiente = cargandoOpciones
    ? "Cargando datos de la devolución…"
    : !hayAlgo
      ? "Elegí al menos un producto."
      : !motivoCodigo
        ? "Elegí un motivo."
        : medioPendiente
          ? "Elegí por dónde devolver la plata."
          : null;

  const confirmar = () => {
    const lineas: LineaDevolucion[] = Object.entries(elegidos).map(
      ([ventaItemId, eleccion]) => ({
        ventaItemId,
        cantidad: eleccion.cantidad,
        destino: eleccion.destino,
      }),
    );

    iniciar(async () => {
      const { data, error } = await registrarDevolucionAction(
        ventaId,
        lineas,
        motivoCodigo,
        motivoDetalle,
        medioReintegro,
      );

      if (error || !data) {
        toast.error(error ?? "No se pudo registrar la devolución.");
        return;
      }

      setAbierto(false);
      setElegidos({});
      setRenglones(null);
      setMotivoCodigo(null);
      setMotivoDetalle("");
      setOpciones(null);
      setMedioReintegro(null);

      toast.success(`Devolución registrada por ${pesos(data.montoDevuelto)}.`, {
        description: data.esCuentaCorriente
          ? `La deuda del cliente bajó ${pesos(data.creditoCc)}${
              data.recargoCcPerdonado > 0
                ? `, incluido el recargo de cuenta corriente (${pesos(data.recargoCcPerdonado)})`
                : ""
            }.`
          : data.saleDeCaja
            ? "Salió de la caja como egreso."
            : "No salió efectivo de la caja.",
      });

      // Lo que hay que resolver a mano va aparte y sin autocierre: adentro del
      // toast de éxito se lee como decoración y se pierde.
      for (const aviso of data.avisos) {
        toast.warning(aviso, { duration: Infinity, closeButton: true });
      }
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12">
          <DialogTitle>Devolver del ticket #{numeroTicket}</DialogTitle>
          <DialogDescription>
            Elegí qué vuelve y cuánto. Lo que no elijas queda vendido.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          {renglones === null ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : renglones.every((renglon) => renglon.disponible === 0) ? (
            <p className="text-sm text-muted-foreground">
              Esta venta ya se devolvió entera.
            </p>
          ) : (
            <div className="space-y-2">
              {renglones.map((renglon) => {
                const eleccion = elegidos[renglon.ventaItemId];
                const cantidad = eleccion?.cantidad ?? 0;
                const agotado = renglon.disponible === 0;

                return (
                  <div
                    key={renglon.ventaItemId}
                    className={`rounded-lg border p-3 ${
                      cantidad > 0 ? "border-primary bg-primary/5" : "border-border"
                    } ${agotado ? "opacity-50" : ""}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-foreground">
                          {renglon.producto}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {renglon.variante} · {pesos(renglon.precioFinal)} c/u
                        </p>
                        {renglon.cantidadDevuelta > 0 && (
                          <p className="mt-0.5 text-xs text-warning">
                            Ya se devolvieron {renglon.cantidadDevuelta} de{" "}
                            {renglon.cantidad}.
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center justify-between gap-1 sm:justify-start">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11"
                          disabled={cantidad === 0}
                          onClick={() => cambiarCantidad(renglon, -1)}
                          aria-label="Devolver una unidad menos"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-10 text-center font-mono text-sm">
                          {cantidad}/{renglon.disponible}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11"
                          disabled={cantidad >= renglon.disponible}
                          onClick={() => cambiarCantidad(renglon, 1)}
                          aria-label="Devolver una unidad más"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {cantidad > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
                        <button
                          type="button"
                          disabled={!renglon.puedeVolverAlStock}
                          onClick={() =>
                            cambiarDestino(renglon.ventaItemId, "STOCK")
                          }
                          className={`min-h-11 cursor-pointer rounded-md px-1 py-2 text-xs font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            eleccion?.destino === "STOCK"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {renglon.puedeVolverAlStock
                            ? "Vuelve al inventario"
                            : "Sin variante en el catálogo"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            cambiarDestino(renglon.ventaItemId, "BAJA")
                          }
                          className={`min-h-11 cursor-pointer rounded-md px-1 py-2 text-xs font-semibold leading-tight transition-colors ${
                            eleccion?.destino === "BAJA"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Está fallada
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="motivo-devolucion" className="text-sm font-semibold">
              ¿Por qué la devuelve? <span className="text-danger">*</span>
            </Label>
            <Select
              value={motivoCodigo ?? undefined}
              onValueChange={(valor) => setMotivoCodigo(valor as MotivoAnulacion)}
            >
              <SelectTrigger id="motivo-devolucion" className="w-full">
                <SelectValue placeholder="Elegí un motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_ANULACION.map((opcion) => (
                  <SelectItem key={opcion.codigo} value={opcion.codigo}>
                    {opcion.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {motivoCodigo === "OTRO" && (
              <Input
                value={motivoDetalle}
                onChange={(evento) => setMotivoDetalle(evento.target.value)}
                placeholder="Contá en una línea qué pasó"
                className="h-10 rounded-md"
              />
            )}
          </div>
          <div>
            <SelectorMedioReintegro
              opciones={opciones}
              valor={medioReintegro}
              onChange={setMedioReintegro}
              monto={base}
            />
          </div>
          {/* El recargo por método de pago no se reintegra. El aviso queda al
              lado de la elección del medio para que se lea antes de confirmar. */}
          <p className="text-xs text-muted-foreground">
            Se devuelve el precio del producto. El recargo por medio de pago no
            se reintegra.
          </p>
        </div>

        <div className="shrink-0 border-t border-border bg-popover px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-muted-foreground">
              A devolver
            </span>
            <span className="text-xl font-bold text-foreground">
              {pesos(base)}
            </span>
          </div>
          {pasoPendiente && (
            <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
              {pasoPendiente}
            </p>
          )}
          <Button
            type="button"
            onClick={confirmar}
            disabled={
              cargandoOpciones ||
              !hayAlgo ||
              !motivoCodigo ||
              medioPendiente ||
              enviando
            }
            className="h-11 w-full"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Registrar devolución"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
