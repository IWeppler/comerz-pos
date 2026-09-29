"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import type { CartItemStore } from "@/entities/cart/types";
import type { ClienteBasico } from "@/shared/components/cart-sidebar/client-selector";
import { crearPresupuestoAction, type Modalidad } from "../actions/presupuestos";
import { formatearNumeroPresupuesto } from "../lib/estado";

const formatCurrency = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const MODALIDADES: { valor: Modalidad; titulo: string; detalle: string }[] = [
  {
    valor: "AL_FINALIZAR",
    titulo: "Retira al terminar de pagar",
    detalle: "La mercadería se entrega con la última cuota.",
  },
  {
    valor: "AL_INICIO",
    titulo: "Se lo lleva ahora",
    detalle: "Retira hoy y queda debiendo las cuotas.",
  },
];

/**
 * "Cotizar" en el POS: el carrito como cotización, sin cobrar ni tocar stock.
 *
 * Solo se monta con el módulo prendido (lo decide `cart-panel-admin`). El
 * carrito NO se vacía al cotizar: lo normal es que el cliente diga "dale" y
 * se cobre en el momento, o que se haga la cotización y siga la venta.
 *
 * El id se genera al ABRIR la ventana y es la clave de idempotencia: un doble
 * click o un reintento después de un corte devuelve la misma cotización en
 * vez de crear dos con números distintos.
 *
 * El total que se muestra acá es el del carrito, con listas y promos. La
 * cotización sale a precio base (lo resuelve la base), así que el número del
 * papel puede ser distinto: se avisa, y el resultado muestra el de verdad.
 */
export function CotizarDialog({
  items,
  cliente,
  totalCarrito,
  disabled = false,
}: Readonly<{
  items: CartItemStore[];
  cliente: ClienteBasico | null;
  totalCarrito: number;
  disabled?: boolean;
}>) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [id, setId] = useState<string>("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [modalidad, setModalidad] = useState<Modalidad>("AL_FINALIZAR");
  const [vigencia, setVigencia] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hayPresentaciones = items.some((i) => i.presentacionId);

  const abrir = () => {
    setId(crypto.randomUUID());
    setError(null);
    setAbierto(true);
  };

  const confirmar = () => {
    setError(null);
    const vigenciaDias = vigencia.trim() === "" ? null : Number(vigencia);
    if (vigenciaDias !== null && (!Number.isInteger(vigenciaDias) || vigenciaDias < 1 || vigenciaDias > 365)) {
      setError("La vigencia tiene que ser de 1 a 365 días.");
      return;
    }
    startTransition(async () => {
      const r = await crearPresupuestoAction({
        id,
        items: items.map((i) => ({
          productoId: i.productoId,
          varianteId: i.varianteId ?? null,
          variante: i.variante,
          nombre: i.nombre,
          cantidad: i.cantidad,
          precio: i.precio,
          presentacionId: i.presentacionId ?? null,
          presentacionNombre: i.presentacionNombre ?? null,
          ventaLibre: i.ventaLibre === true,
        })),
        modalidad,
        clienteId: cliente?.id ?? null,
        clienteNombre: cliente ? null : clienteNombre,
        vigenciaDias,
        nota,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAbierto(false);
      toast.success(
        `Cotización ${formatearNumeroPresupuesto(r.numero)} por ${formatCurrency(r.total)}`,
        {
          description: r.yaRegistrado ? "Ya estaba guardada." : "El carrito sigue armado por si la cobrás ahora.",
          action: {
            label: "Ver",
            onClick: () => router.push(`/presupuestos/${r.id}`),
          },
        },
      );
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={abrir}
        disabled={disabled || items.length === 0}
        className="mt-2 h-11 w-full gap-2 shadow-none cursor-pointer"
      >
        <FileText className="h-4 w-4" />
        Cotizar
      </Button>

      <Dialog open={abierto} onOpenChange={(v) => !isPending && setAbierto(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cotizar este carrito</DialogTitle>
            <DialogDescription>
              No cobra ni descuenta stock. El precio lo pone el sistema al
              guardar: precio de lista, sin listas especiales ni promociones.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {hayPresentaciones && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                Hay renglones en presentación (balde, pack): todavía no se
                pueden cotizar. Cambialos a la unidad base.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cotizar-cliente">Cliente</Label>
              {cliente ? (
                <p className="text-sm font-medium">{cliente.nombre}</p>
              ) : (
                <Input
                  id="cotizar-cliente"
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                  placeholder="Nombre (opcional)"
                  maxLength={120}
                  className="h-11"
                />
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">Entrega</legend>
              {MODALIDADES.map((m) => (
                <label
                  key={m.valor}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    modalidad === m.valor ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="cotizar-modalidad"
                    value={m.valor}
                    checked={modalidad === m.valor}
                    onChange={() => setModalidad(m.valor)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{m.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{m.detalle}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cotizar-vigencia">Válida por (días)</Label>
                <Input
                  id="cotizar-vigencia"
                  inputMode="numeric"
                  value={vigencia}
                  onChange={(e) => setVigencia(e.target.value.replace(/\D/g, ""))}
                  placeholder="La del comercio"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Carrito</span>
                <p className="flex h-11 items-center font-mono text-sm">
                  {formatCurrency(totalCarrito)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cotizar-nota">Nota</Label>
              <Textarea
                id="cotizar-nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Opcional: aparece en el papel"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAbierto(false)}
              disabled={isPending}
              className="h-11"
            >
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={isPending || hayPresentaciones} className="h-11 gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Guardar cotización
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
