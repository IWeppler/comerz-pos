"use client";

import { useEffect, useState, useTransition } from "react";
import { anularVentaAction } from "../actions/cancel-sale";
import {
  getRestaurabilidadVentaAction,
  type RestaurabilidadVenta,
} from "../actions/restaurabilidad-venta";
import { toast } from "sonner";

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
  MOTIVOS_ANULACION,
  type MotivoAnulacion,
} from "@/features/sales/lib/motivo-anulacion";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { AlertTriangle, PackagePlus, Loader2 } from "lucide-react";

interface AnularVentaModalProps {
  id: string;
  productoNombre: string;
  cantidad: number;
  /** Unidades que tienen stock que devolver. Difiere de `cantidad` cuando el
   * ticket lleva renglones de venta libre, que no mueven inventario. Sin
   * pasar, se asume que todas lo tienen. */
  unidadesConStock?: number;
  variante: string;
  isProductoEliminado: boolean;
  /** Controlado desde el menú de la fila. Ver `sale-table.tsx`: un
   * DialogTrigger adentro de un DropdownMenu se desmonta junto con el menú,
   * antes de que el modal llegue a abrirse. */
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
}

export function AnularVentaModal({
  id,
  productoNombre,
  cantidad,
  unidadesConStock = cantidad,
  variante,
  isProductoEliminado,
  open,
  onOpenChange,
}: Readonly<AnularVentaModalProps>) {
  // Un ticket hecho solo de venta libre no tiene producto físico del que
  // decidir nada: se anula la plata y listo.
  const sinStockQueDevolver = unidadesConStock === 0;
  // Controlado, y hacía falta por dos motivos. El primero es que la vista
  // previa de restaurabilidad se pide al ABRIR: es una consulta que solo tiene
  // sentido cuando alguien va a anular de verdad, no en cada una de las diez
  // filas de la página. El segundo es que `setIsOpen(false)` ya estaba escrito
  // al terminar la anulación y no cerraba nada — el Dialog era no controlado,
  // así que el modal quedaba abierto sobre una venta ya anulada.
  const isOpen = open;
  const setIsOpen = onOpenChange;
  const [restaurabilidad, setRestaurabilidad] =
    useState<RestaurabilidadVenta | null>(null);
  const [isPending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState<"RESTAURAR_STOCK" | "BAJA">(
    "RESTAURAR_STOCK",
  );
  // El POR QUÉ arranca sin elegir a propósito: un default sería el valor que
  // se guarda cuando nadie mira, y esa es justo la medición que se busca.
  const [motivoCodigo, setMotivoCodigo] = useState<MotivoAnulacion | null>(null);
  const [motivoDetalle, setMotivoDetalle] = useState("");

  useEffect(() => {
    if (!isOpen || restaurabilidad !== null) return;

    let vigente = true;
    getRestaurabilidadVentaAction(id).then((resultado) => {
      if (vigente) setRestaurabilidad(resultado);
    });

    return () => {
      vigente = false;
    };
  }, [isOpen, restaurabilidad, id]);

  const handleAnular = () => {
    startTransition(async () => {
      const result = await anularVentaAction(
        id,
        motivo,
        motivoCodigo,
        motivoDetalle,
      );

      if (result.success) {
        setIsOpen(false);

        // El título ya no promete que salió plata de la caja: ahora solo sale
        // la porción que se había cobrado en EFECTIVO, y puede ser cero (una
        // venta con débito no toca el cajón). Decirlo mal era peor que no
        // decirlo: la vendedora contaba un egreso que no existía.
        const efectivo = result.efectivoDevuelto ?? 0;
        const detalleCaja =
          efectivo > 0
            ? `Salieron $${Math.round(efectivo).toLocaleString("es-AR")} de la caja.`
            : "No salió efectivo de la caja.";

        const detalleStock = sinStockQueDevolver
          ? "Sin stock que devolver: la venta no llevaba productos del catálogo."
          : isProductoEliminado
            ? "Stock no restaurado porque el producto fue eliminado del catálogo."
            : motivo === "RESTAURAR_STOCK"
              ? `Se devolvieron ${unidadesConStock}u al inventario.`
              : "Se registró como Baja (pérdida).";

        toast.success("Venta anulada.", {
          description: `${detalleCaja} ${detalleStock}`,
        });

        // Lo que la anulación no resuelve sola va en avisos APARTE y sin
        // autocierre: son cosas que alguien tiene que hacer a mano (devolver
        // por el posnet, reintegrar lo ya pagado del fiado, cargar stock).
        // Metidos en el toast de éxito se leen como decoración y se pierden.
        for (const aviso of result.avisos ?? []) {
          toast.warning(aviso, { duration: Infinity, closeButton: true });
        }
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            Registrar Devolución
          </DialogTitle>
          <DialogDescription>
            Vas a anular la venta de{" "}
            <strong className="text-foreground">
              {cantidad}x {productoNombre} ({variante})
            </strong>
            . El dinero se restará automáticamente de la caja de hoy como un
            Egreso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {!isProductoEliminado && !sinStockQueDevolver && (
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                ¿Qué hacemos con el producto físico?
              </Label>
              <RadioGroup
                value={motivo}
                onValueChange={(valor) =>
                  setMotivo(valor === "BAJA" ? "BAJA" : "RESTAURAR_STOCK")
                }
              >
                <div
                  className={`flex items-start space-x-3 p-3 rounded-lg border-2 transition-colors cursor-pointer ${motivo === "RESTAURAR_STOCK" ? "border-success bg-success/10" : "border-border"}`}
                  onClick={() => setMotivo("RESTAURAR_STOCK")}
                >
                  <RadioGroupItem
                    value="RESTAURAR_STOCK"
                    id="r1"
                    className="mt-1"
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="r1"
                      className="font-bold text-success cursor-pointer flex items-center gap-1.5"
                    >
                      <PackagePlus className="w-4 h-4" /> Devolver al inventario
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      El cliente se arrepintió. El producto está sano y se
                      sumará al inventario (+{unidadesConStock}).
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-start space-x-3 p-3 rounded-lg border-2 transition-colors cursor-pointer ${motivo === "BAJA" ? "border-amber-500 bg-amber-50 dark:bg-amber-200/10" : "border-border"}`}
                  onClick={() => setMotivo("BAJA")}
                >
                  <RadioGroupItem value="BAJA" id="r2" className="mt-1" />
                  <div className="space-y-1">
                    <Label
                      htmlFor="r2"
                      className="font-bold text-warning cursor-pointer flex items-center gap-1.5"
                    >
                      <AlertTriangle className="w-4 h-4" /> Descartar
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      El producto se rompió. Se registrará como Baja y no
                      volverá al stock.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* POR QUÉ se cae la venta, que es otra pregunta que a dónde va la
              mercadería — hasta 20260903140000 compartían una columna y la
              segunda no tenía respuesta. Es obligatorio y a propósito: si se
              puede saltear queda vacío en el 90% de los casos y la única
              medición que justifica el campo no se puede hacer. Es un tap más
              en una operación que en Evens pasa una vez cada 39 ventas. */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              ¿Por qué se anula? <span className="text-danger">*</span>
            </Label>
            <div className="grid gap-1.5">
              {MOTIVOS_ANULACION.map((opcion) => {
                const activo = motivoCodigo === opcion.codigo;
                return (
                  <button
                    key={opcion.codigo}
                    type="button"
                    onClick={() => setMotivoCodigo(opcion.codigo)}
                    aria-pressed={activo}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                      activo
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {opcion.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {opcion.ayuda}
                    </span>
                  </button>
                );
              })}
            </div>

            {motivoCodigo === "OTRO" && (
              <Input
                value={motivoDetalle}
                onChange={(evento) => setMotivoDetalle(evento.target.value)}
                placeholder="Contá en una línea qué pasó"
                className="h-10 rounded-md"
                autoFocus
              />
            )}
          </div>

          {/* Lo que NO va a volver al inventario, dicho ANTES y no en un aviso
              después de que la plata salió de la caja. Ver
              `restaurabilidad-venta.ts`: quedan 116 renglones históricos cuya
              variante ya no se puede resolver, y hasta ahora la vendedora se
              enteraba cuando ya no había nada que decidir. */}
          {motivo === "RESTAURAR_STOCK" &&
            restaurabilidad &&
            restaurabilidad.sinRestaurar.length > 0 && (
              <div className="rounded-lg border border-warning/20 bg-warning/10 p-3">
                <p className="text-sm font-medium text-warning">
                  {restaurabilidad.restaurables === 0
                    ? "Nada de esta venta va a volver al inventario."
                    : `${restaurabilidad.sinRestaurar.length} de estos renglones no van a volver al inventario.`}
                </p>
                <p className="mt-1 text-xs text-warning/90">
                  {restaurabilidad.sinRestaurar.join(", ")}. Su variante ya no
                  existe en el catálogo, así que hay que cargar esas unidades a
                  mano.
                </p>
              </div>
            )}

          {isProductoEliminado && (
            <div className="bg-danger/10 border border-danger/20 p-4 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
              <p className="text-sm text-danger">
                El producto original fue eliminado del catálogo maestro. La
                devolución restará el dinero de la caja, pero no es posible
                restaurar el stock.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleAnular}
              disabled={isPending || !motivoCodigo}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Confirmar Devolución
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
