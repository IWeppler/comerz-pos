"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
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
import { usePedidosRealtime } from "../hooks/use-pedidos-realtime";

/**
 * La cola de la caja: los pedidos que los puestos mandaron y todavía nadie
 * cobró. Vive dentro del Ticket como contenido de la pestaña "Por cobrar";
 * toca uno y la venta actual se carga para cobrar por el camino de siempre.
 */

const CLAVE = ["pedidos", "por-cobrar"] as const;

/**
 * Fallback de polling. La señal de que hubo un cambio llega por Realtime
 * (`usePedidosRealtime`); esto es la red por si el websocket está caído, la
 * PWA de iOS volvió del fondo con el socket muerto, o la policy rechazó el
 * canal.
 */
const FALLBACK_MS = 90_000;

/**
 * La consulta vive por encima de las pestañas. Así sigue escuchando pedidos
 * mientras la cajera está en "Venta actual" y el badge se actualiza sin
 * robarle el foco ni cambiarla de pantalla.
 */
export function usePedidosPorCobrar(negocioId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = [...CLAVE, negocioId ?? "sin-negocio"];

  const consulta = useQuery({
    queryKey,
    queryFn: async () => {
      const resultado = await listarPedidosPorCobrarAction();
      if (resultado.error) throw new Error(resultado.error);
      return resultado.data;
    },
    refetchInterval: FALLBACK_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: Boolean(negocioId),
  });

  const negocioClave = negocioId ?? "sin-negocio";
  const alCambiar = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [...CLAVE, negocioClave],
    });
  }, [queryClient, negocioClave]);
  usePedidosRealtime(negocioId, alCambiar);

  return {
    pedidos: consulta.data ?? [],
    isLoading: consulta.isLoading,
    isError: consulta.isError,
  };
}

export function PedidosPorCobrar({
  pedidos,
  isLoading,
  isError,
  pedidosAbiertosIds,
  onCargar,
  onVerAbierto,
}: Readonly<{
  pedidos: PedidoPorCobrar[];
  isLoading: boolean;
  isError: boolean;
  /** Los pedidos abiertos en alguna pestaña no se pueden cancelar. */
  pedidosAbiertosIds: string[];
  /** Carga el pedido con TODO su contexto (cliente, pago, promo, factura). */
  onCargar: (pedido: PedidoPorCobrar) => void;
  /** Lleva a la pestaña existente si el pedido ya estaba cargado. */
  onVerAbierto: (pedidoId: string) => void;
}>) {
  const [busqueda, setBusqueda] = useState("");
  const [cancelando, setCancelando] = useState<string | null>(null);
  // Estado y no `window.confirm`: el diálogo nativo bloquea la pestaña y no
  // usa el lenguaje visual de la app.
  const [aCancelar, setACancelar] = useState<PedidoPorCobrar | null>(null);
  const queryClient = useQueryClient();

  const pedidosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    if (!termino) return pedidos;
    return pedidos.filter((pedido) =>
      [
        String(pedido.numero),
        pedido.vendedor_nombre,
        pedido.cliente_nombre,
        pedido.nota,
      ].some((valor) => valor?.toLocaleLowerCase("es").includes(termino)),
    );
  }, [busqueda, pedidos]);

  const cargarAlCarrito = (pedido: PedidoPorCobrar) => {
    onCargar(pedido);
    toast.info(`Pedido #${pedido.numero} cargado. Revisá y cobrá.`);
  };

  const cancelar = async (pedido: PedidoPorCobrar) => {
    setACancelar(null);
    setCancelando(pedido.id);
    const resultado = await cancelarPedidoAction(pedido.id);
    setCancelando(null);
    if (resultado.success) {
      toast.success(`Pedido #${pedido.numero} cancelado.`);
      void queryClient.invalidateQueries({ queryKey: CLAVE });
    } else {
      toast.error(resultado.error ?? "No se pudo cancelar.");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading && (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {!isLoading && isError && (
          <p className="p-6 text-center text-sm text-destructive">
            No se pudo cargar la cola. Volvé a intentar en unos segundos.
          </p>
        )}
        {!isLoading && !isError && pedidos.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
            <ClipboardList className="h-8 w-8 opacity-50" />
            <p className="text-sm font-medium text-foreground">
              No hay pedidos esperando
            </p>
            <p className="text-xs">
              Cuando un puesto mande uno, va a aparecer acá solo.
            </p>
          </div>
        )}
        {!isLoading &&
          !isError &&
          pedidos.length > 0 &&
          pedidosFiltrados.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No encontramos pedidos con “{busqueda.trim()}”.
            </p>
          )}
        {pedidosFiltrados.map((pedido) => (
          <div
            key={pedido.id}
            className="space-y-2 rounded-xl border border-border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight">
                  #{pedido.numero}
                  <span className="ml-2 text-xs font-medium text-muted-foreground">
                    {pedido.vendedor_nombre ?? "Sin nombre"} ·{" "}
                    {haceCuanto(pedido.creado_en)}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {pedido.cliente_nombre ?? "Consumidor final"}
                  {pedido.nota ? ` · ${pedido.nota}` : ""}
                </p>
              </div>
              <p className="shrink-0 font-mono text-base font-semibold">
                {formatearMoneda(pedido.total_estimado)}
              </p>
            </div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {pedido.items.slice(0, 4).map((item, index) => (
                <li key={index} className="truncate">
                  {item.cantidad}× {item.nombre}
                  {item.variante ? ` (${item.variante})` : ""}
                </li>
              ))}
              {pedido.items.length > 4 && (
                <li>… y {pedido.items.length - 4} más</li>
              )}
            </ul>
            <div className="flex gap-2 pt-1">
              {/* h-11: es el botón que la caja toca en cada pedido, con la
                  clienta esperando; 44px de blanco táctil, no 32. */}
              <Button
                className="h-10 flex-1"
                variant={
                  pedidosAbiertosIds.includes(pedido.id) ? "outline" : "default"
                }
                onClick={() =>
                  pedidosAbiertosIds.includes(pedido.id)
                    ? onVerAbierto(pedido.id)
                    : cargarAlCarrito(pedido)
                }
              >
                {pedidosAbiertosIds.includes(pedido.id)
                  ? "Ver venta abierta"
                  : "Cargar y cobrar"}
              </Button>
              <Button
                variant="ghost"
                disabled={
                  pedidosAbiertosIds.includes(pedido.id) ||
                  cancelando === pedido.id
                }
                onClick={() => setACancelar(pedido)}
                aria-label={`Cancelar pedido #${pedido.numero}`}
              >
                {cancelando === pedido.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog
        open={aCancelar !== null}
        onOpenChange={(open) => !open && setACancelar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Cancelar el pedido #{aCancelar?.numero}?
            </AlertDialogTitle>
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
    </div>
  );
}

function haceCuanto(iso: string): string {
  const min = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return `hace ${horas} h`;
}
