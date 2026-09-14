"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  cancelarPedidoAction,
  listarPedidosPorCobrarAction,
  type PedidoPorCobrar,
} from "../actions/pedidos";

/**
 * La cola de la caja: los pedidos que los puestos mandaron y todavía nadie
 * cobró. Botón con el conteo en el header del ticket; toca uno y el carrito
 * se carga con él para cobrar por el camino de siempre.
 *
 * Se refresca sola cada 15 segundos: la vendedora manda el pedido desde otro
 * dispositivo y la cajera no tiene que recargar nada. Es UNA consulta chica
 * por caja, no por puesto — solo se monta con \`pedidos_a_caja\` prendido.
 */

const CLAVE = ["pedidos", "por-cobrar"] as const;

export function PedidosPorCobrar({
  negocioId,
  puedeCobrar,
  onCargar,
  variante = "header",
}: Readonly<{
  negocioId: string | null;
  puedeCobrar: boolean;
  /** El panel carga el pedido al ticket con TODO su contexto (cliente,
   * pago, promo, factura) y abre el paso de pago. */
  onCargar: (pedido: PedidoPorCobrar) => void;
  /**
   * "flotante": botón fijo abajo a la derecha, para tablet y celular, donde
   * el header del ticket vive adentro de un panel que solo se abre con
   * productos en el carrito — la cajera con el carrito vacío no lo veía.
   */
  variante?: "header" | "flotante";
}>) {
  const [abierto, setAbierto] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  // El pedido que espera confirmación de cancelar. Estado y no
  // `window.confirm`: el diálogo nativo bloquea la pestaña y no es el de la
  // app.
  const [aCancelar, setACancelar] = useState<PedidoPorCobrar | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [...CLAVE, negocioId ?? "sin-negocio"],
    queryFn: async () => {
      const r = await listarPedidosPorCobrarAction();
      if (r.error) throw new Error(r.error);
      return r.data;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    enabled: Boolean(negocioId),
  });

  const pedidos = data ?? [];

  const cargarAlCarrito = (p: PedidoPorCobrar) => {
    onCargar(p);
    setAbierto(false);
    toast.info(`Pedido #${p.numero} cargado. Revisá y cobrá.`);
  };

  const cancelar = async (p: PedidoPorCobrar) => {
    setACancelar(null);
    setCancelando(p.id);
    const r = await cancelarPedidoAction(p.id);
    setCancelando(null);
    if (r.success) {
      toast.success(`Pedido #${p.numero} cancelado.`);
      queryClient.invalidateQueries({ queryKey: CLAVE });
    } else {
      toast.error(r.error ?? "No se pudo cancelar.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          variante === "flotante"
            ? `fixed right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold shadow-lg cursor-pointer transition-colors ${
                pedidos.length > 0
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-sidebar text-muted-foreground hover:text-foreground"
              } bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6`
            : "relative -my-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
        }
        aria-label="Pedidos por cobrar"
      >
        <ClipboardList className={variante === "flotante" ? "h-5 w-5" : "h-4 w-4"} />
        Por cobrar
        {pedidos.length > 0 && (
          <span
            className={`ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
              variante === "flotante" ? "bg-white text-primary" : "bg-primary text-white"
            }`}
          >
            {pedidos.length}
          </span>
        )}
      </button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <SheetTitle>Pedidos por cobrar</SheetTitle>
            <SheetDescription>
              Lo que mandaron los puestos y todavía no se cobró. Tocá uno para
              cargarlo al ticket.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoading && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
              </div>
            )}
            {!isLoading && pedidos.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No hay pedidos esperando. Cuando un puesto mande uno, aparece acá
                solo.
              </p>
            )}
            {pedidos.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">
                      #{p.numero}
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        {p.vendedor_nombre ?? "Sin nombre"} · {haceCuanto(p.creado_en)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.cliente_nombre ?? "Consumidor final"}
                      {p.nota ? ` · ${p.nota}` : ""}
                    </p>
                  </div>
                  <p className="text-base font-mono font-semibold shrink-0">
                    {formatearMoneda(p.total_estimado)}
                  </p>
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {p.items.slice(0, 4).map((i, idx) => (
                    <li key={idx} className="truncate">
                      {i.cantidad}× {i.nombre}
                      {i.variante ? ` (${i.variante})` : ""}
                    </li>
                  ))}
                  {p.items.length > 4 && (
                    <li>… y {p.items.length - 4} más</li>
                  )}
                </ul>
                <div className="flex gap-2 pt-1">
                  {puedeCobrar && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => cargarAlCarrito(p)}
                    >
                      Cargar y cobrar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancelando === p.id}
                    onClick={() => setACancelar(p)}
                    aria-label="Cancelar pedido"
                  >
                    {cancelando === p.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={aCancelar !== null}
        onOpenChange={(open) => !open && setACancelar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar el pedido #{aCancelar?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              {aCancelar?.vendedor_nombre ?? "La vendedora"} lo armó{" "}
              {aCancelar ? haceCuanto(aCancelar.creado_en) : ""} por{" "}
              {formatearMoneda(aCancelar?.total_estimado ?? 0)}. Se saca de la
              cola y no se cobra. Si el cliente vuelve, hay que armarlo de
              nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => aCancelar && cancelar(aCancelar)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Cancelar pedido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function haceCuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h`;
}
