"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MapPin, MessageCircle, ShoppingBag, Store, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
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
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";
import { cancelarOrdenAction, confirmarTransferenciaAction } from "../actions/ordenes";

export interface OrdenPanel {
  id: string;
  numero: number;
  estado: string;
  medio: "TRANSFERENCIA" | "MP_CHECKOUT" | "MP_CREDITO";
  cliente_nombre: string;
  cliente_telefono: string;
  modalidad_entrega: "RETIRO" | "ENVIO";
  localidad: string | null;
  direccion: string | null;
  nota: string | null;
  total: number;
  vence_en: string;
  creado_en: string;
  pagada_en: string | null;
  venta_id: string | null;
  ordenes_tienda_items: { nombre: string; variante: string | null; cantidad: number; subtotal: number }[];
}

const pesos = (monto: number) =>
  Number(monto).toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

const numeroDeOrden = (numero: number) => `#${String(numero).padStart(5, "0")}`;

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  PENDIENTE_PAGO: { texto: "Esperando pago", clase: "bg-warning/15 text-warning" },
  EN_PROCESO: { texto: "Pago en proceso", clase: "bg-warning/15 text-warning" },
  PAGADA: { texto: "Pagada", clase: "bg-success/15 text-success" },
  ENTREGADA: { texto: "Entregada", clase: "bg-success/15 text-success" },
  VENCIDA: { texto: "Vencida", clase: "bg-muted text-muted-foreground" },
  CANCELADA: { texto: "Cancelada", clase: "bg-muted text-muted-foreground" },
  REVISAR: { texto: "Revisar pago", clase: "bg-destructive/15 text-destructive" },
  PAGADA_SIN_STOCK: { texto: "Pagada sin stock", clase: "bg-destructive/15 text-destructive" },
  REEMBOLSADA: { texto: "Pago devuelto", clase: "bg-muted text-muted-foreground" },
  CONTRACARGO: { texto: "Contracargo", clase: "bg-destructive/15 text-destructive" },
  EN_DISPUTA: { texto: "En reclamo", clase: "bg-destructive/15 text-destructive" },
};

const MEDIOS: Record<OrdenPanel["medio"], string> = {
  TRANSFERENCIA: "Transferencia",
  MP_CHECKOUT: "Mercado Pago",
  MP_CREDITO: "Cuotas sin tarjeta",
};

type Filtro = "PENDIENTES" | "PAGADAS" | "TODAS";

/**
 * Las órdenes del catálogo. Lo que el comercio hace acá es poco y a propósito:
 * la mayoría se confirma sola (Mercado Pago por webhook, la transferencia al
 * alias de MP por conciliación). Queda el botón "Confirmar transferencia" para
 * la que no se pudo emparejar sola, y "Cancelar" para liberar el stock antes de
 * que venza.
 *
 * Confirmar registra la venta en el momento (sin pasar por el POS): entra en
 * la cuenta de Mercado Pago de la tienda, no en el cajón.
 */
export function OrdenesPanel({
  ordenes,
  puedeCobrar,
  sinPermiso,
}: Readonly<{ ordenes: OrdenPanel[]; puedeCobrar: boolean; sinPermiso: boolean }>) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("PENDIENTES");
  const [pendiente, startTransition] = useTransition();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: "cobrar" | "cancelar"; orden: OrdenPanel } | null>(null);

  const visibles = useMemo(
    () =>
      ordenes.filter((o) =>
        filtro === "TODAS"
          ? true
          : filtro === "PENDIENTES"
            ? o.estado === "PENDIENTE_PAGO" || o.estado === "EN_PROCESO" || o.estado === "REVISAR" ||
              o.estado === "PAGADA_SIN_STOCK" || o.estado === "CONTRACARGO" || o.estado === "EN_DISPUTA"
            : o.estado === "PAGADA" || o.estado === "ENTREGADA",
      ),
    [ordenes, filtro],
  );
  const cantidadPendientes = ordenes.filter((o) => o.estado === "PENDIENTE_PAGO").length;

  const correr = (orden: OrdenPanel, tipo: "cobrar" | "cancelar") =>
    startTransition(async () => {
      setEnCurso(orden.id);
      const r = tipo === "cobrar" ? await confirmarTransferenciaAction(orden.id) : await cancelarOrdenAction(orden.id);
      setEnCurso(null);
      setConfirmar(null);
      if (r.ok) toast.success(r.mensaje);
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ShoppingBag className="h-5 w-5 text-primary" /> Órdenes de la tienda
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Los pagos con Mercado Pago y las transferencias que coinciden se confirman solos y la venta
          queda registrada.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border p-1" role="tablist">
        {(["PENDIENTES", "PAGADAS", "TODAS"] as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filtro === f}
            onClick={() => setFiltro(f)}
            className={`h-11 rounded-md text-xs font-semibold transition-colors ${
              filtro === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {f === "PENDIENTES" ? `Pendientes${cantidadPendientes ? ` (${cantidadPendientes})` : ""}` : f === "PAGADAS" ? "Pagadas" : "Todas"}
          </button>
        ))}
      </div>

      {sinPermiso && (
        <p className="text-sm text-destructive">No pudimos cargar las órdenes. Recargá la página.</p>
      )}

      {visibles.length === 0 && !sinPermiso && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {filtro === "PENDIENTES" ? "No hay órdenes esperando pago." : "Todavía no hay órdenes acá."}
        </div>
      )}

      <ul className="space-y-3">
        {visibles.map((orden) => {
          const estado = ESTADOS[orden.estado] ?? { texto: orden.estado, clase: "bg-muted" };
          const pendientePago = orden.estado === "PENDIENTE_PAGO";
          const ocupada = pendiente && enCurso === orden.id;
          return (
            <li key={orden.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold">
                    Orden {numeroDeOrden(orden.numero)} · {pesos(orden.total)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fechaHora(orden.creado_en)} · {MEDIOS[orden.medio]}
                    {pendientePago && ` · vence ${fechaHora(orden.vence_en)}`}
                  </p>
                </div>
                <Badge className={estado.clase}>{estado.texto}</Badge>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium">{orden.cliente_nombre}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {orden.modalidad_entrega === "ENVIO" ? (
                    <>
                      <MapPin className="h-3.5 w-3.5" /> Envío: {orden.direccion}, {orden.localidad}
                    </>
                  ) : (
                    <>
                      <Store className="h-3.5 w-3.5" /> Retira en el local
                    </>
                  )}
                </p>
                {orden.nota && <p className="text-xs italic text-muted-foreground">“{orden.nota}”</p>}
              </div>

              <ul className="space-y-0.5 border-t border-border pt-2 text-xs">
                {orden.ordenes_tienda_items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {Number(item.cantidad)} × {item.nombre}
                      {item.variante ? ` · ${item.variante}` : ""}
                    </span>
                    <span className="shrink-0">{pesos(item.subtotal)}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline" className="h-11 flex-1">
                  <a
                    href={linkWhatsapp(
                      orden.cliente_telefono,
                      `¡Hola ${orden.cliente_nombre}! Te escribo por tu orden ${numeroDeOrden(orden.numero)}.`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" /> Escribirle
                  </a>
                </Button>
                {pendientePago && puedeCobrar && orden.medio === "TRANSFERENCIA" && (
                  <Button
                    className="h-11 flex-1"
                    disabled={ocupada}
                    onClick={() => setConfirmar({ tipo: "cobrar", orden })}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar transferencia
                  </Button>
                )}
                {pendientePago && puedeCobrar && (
                  <Button
                    variant="ghost"
                    className="h-11"
                    disabled={ocupada}
                    onClick={() => setConfirmar({ tipo: "cancelar", orden })}
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Cancelar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!confirmar} onOpenChange={(abierto) => !abierto && setConfirmar(null)}>
        <AlertDialogContent>
          {confirmar && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmar.tipo === "cobrar"
                    ? `¿Ya te llegaron ${pesos(confirmar.orden.total)}?`
                    : `¿Cancelar la orden ${numeroDeOrden(confirmar.orden.numero)}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmar.tipo === "cobrar"
                    ? "Fijate en tu Mercado Pago que la transferencia esté acreditada. Al confirmar se registra la venta y la plata entra en la cuenta de la tienda online."
                    : "Los productos vuelven a la venta. Si la clienta ya transfirió, no la canceles: confirmala."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pendiente}>Volver</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pendiente}
                  onClick={(e) => {
                    e.preventDefault();
                    correr(confirmar.orden, confirmar.tipo);
                  }}
                >
                  {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {confirmar.tipo === "cobrar" ? "Sí, confirmar" : "Cancelar orden"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
