"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Ban, Loader2, Printer, ThumbsDown } from "lucide-react";
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
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  cerrarPresupuestoAction,
  type PresupuestoDetalle,
} from "../actions/presupuestos";
import {
  estadoVisiblePresupuesto,
  formatearNumeroPresupuesto,
  puedeCerrarse,
} from "../lib/estado";
import { opcionesDeFinanciacion } from "../lib/cuotas";
import {
  etiquetaFrecuencia,
  fechaCorta,
  mensajeWhatsappPresupuesto,
} from "../lib/mensaje-whatsapp";
import { EstadoPresupuestoBadge } from "./estado-badge";

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const cantidadTexto = (cantidad: number, unidad: string) => {
  const n = cantidad.toLocaleString("es-AR", { maximumFractionDigits: 3 });
  return unidad === "UNIDAD" ? n : `${n} ${unidad.toLowerCase()}`;
};

/**
 * El papel en A4 y no en la térmica: una cotización se manda, se guarda y se
 * compara, no se corta en el mostrador. Mismo truco que el ticket
 * (`cssImpresionTicket`): todo invisible menos el papel.
 */
const CSS_IMPRESION = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  #presupuesto-print, #presupuesto-print * { visibility: visible !important; }
  #presupuesto-print {
    position: absolute !important; left: 0; top: 0; width: 100%;
    background: #fff; color: #000; border: 0 !important; box-shadow: none !important;
  }
}`;

export function PresupuestoDetalleView({
  presupuesto: p,
  comercio,
  puedeCerrar,
}: Readonly<{
  presupuesto: PresupuestoDetalle;
  comercio: { nombre: string; logo: string | null; whatsapp: string | null; direccion: string | null };
  puedeCerrar: boolean;
}>) {
  const [estado, setEstado] = useState(p.estado);
  const [confirmar, setConfirmar] = useState<"RECHAZADO" | "ANULADO" | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = estadoVisiblePresupuesto(estado, p.vigencia_hasta);
  const opciones = opcionesDeFinanciacion(p.total, p.tasas_financiacion);
  const numero = formatearNumeroPresupuesto(p.numero);

  const whatsapp = () => {
    const mensaje = mensajeWhatsappPresupuesto(p, comercio.nombre);
    window.open(linkWhatsapp(p.cliente_telefono, mensaje), "_blank");
  };

  const cerrar = (nuevo: "RECHAZADO" | "ANULADO") => {
    startTransition(async () => {
      const r = await cerrarPresupuestoAction(p.id, nuevo);
      setConfirmar(null);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo cambiar el estado.");
        return;
      }
      setEstado(nuevo);
      toast.success(nuevo === "RECHAZADO" ? "Cotización rechazada." : "Cotización anulada.");
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <style>{CSS_IMPRESION}</style>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/presupuestos"
          className="mr-auto flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Presupuestos
        </Link>
        <Button variant="outline" className="h-11 gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Imprimir
        </Button>
        <Button className="h-11 gap-2 bg-[#25D366] text-white hover:bg-[#1EBE57]" onClick={whatsapp}>
          WhatsApp
        </Button>
        {puedeCerrar && puedeCerrarse(estado) && (
          <>
            <Button variant="outline" className="h-11 gap-2" disabled={isPending} onClick={() => setConfirmar("RECHAZADO")}>
              <ThumbsDown className="h-4 w-4" />
              Rechazada
            </Button>
            <Button variant="outline" className="h-11 gap-2 text-destructive" disabled={isPending} onClick={() => setConfirmar("ANULADO")}>
              <Ban className="h-4 w-4" />
              Anular
            </Button>
          </>
        )}
      </div>

      <article
        id="presupuesto-print"
        className="mx-auto max-w-3xl space-y-6 rounded-xl border border-border bg-card p-5 md:p-8"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {comercio.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={comercio.logo} alt="" className="h-12 w-12 rounded object-contain" />
            )}
            <div>
              <p className="text-lg font-semibold">{comercio.nombre}</p>
              {comercio.direccion && <p className="text-xs text-muted-foreground">{comercio.direccion}</p>}
              {comercio.whatsapp && <p className="text-xs text-muted-foreground">{comercio.whatsapp}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">Cotización {numero}</p>
            <p className="text-xs text-muted-foreground">
              {fechaCorta(diaComercial(p.creado_en))} · válida hasta {fechaCorta(p.vigencia_hasta)}
            </p>
            <div className="mt-1 print:hidden">
              <EstadoPresupuestoBadge estado={visible} />
            </div>
          </div>
        </header>

        {p.cliente_nombre && (
          <p className="text-sm">
            <span className="text-muted-foreground">Para: </span>
            {p.cliente_nombre}
          </p>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 font-medium">Cant.</th>
              <th className="py-2 font-medium">Descripción</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Precio</th>
              <th className="py-2 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.orden} className="border-b border-border/60 align-top">
                <td className="py-2 pr-2 font-mono whitespace-nowrap">{cantidadTexto(i.cantidad, i.unidad_medida)}</td>
                <td className="py-2 pr-2">
                  {i.descripcion}
                  {i.variante && i.variante !== i.descripcion && (
                    <span className="text-muted-foreground"> · {i.variante}</span>
                  )}
                </td>
                <td className="hidden py-2 text-right font-mono sm:table-cell">{pesos(i.precio_unitario)}</td>
                <td className="py-2 text-right font-mono">
                  {pesos(Math.round(i.precio_unitario * i.cantidad * 100) / 100)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-3 text-base font-semibold sm:hidden">Total</td>
              <td colSpan={3} className="hidden pt-3 text-base font-semibold sm:table-cell">Total</td>
              <td className="pt-3 text-right font-mono text-base font-semibold">{pesos(p.total)}</td>
            </tr>
          </tfoot>
        </table>

        {opciones.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Opciones en cuotas {etiquetaFrecuencia(p.frecuencia)}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {opciones.map((o) => (
                <li key={o.cuotas} className="rounded-lg border border-border p-3">
                  <p className="font-medium">
                    {o.cuotas} × {pesos(o.montoCuota)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {o.pct > 0 ? `Recargo ${o.pct.toLocaleString("es-AR")} %` : "Sin recargo"} · total {pesos(o.totalFinal)}
                    {o.ultimaCuota !== o.montoCuota && ` · última ${pesos(o.ultimaCuota)}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-sm">
          <span className="text-muted-foreground">Entrega: </span>
          {p.modalidad_entrega === "AL_INICIO"
            ? "se retira al confirmar."
            : "se retira al completar el pago."}
        </p>

        {p.nota && <p className="whitespace-pre-line text-sm">{p.nota}</p>}

        <p className="text-xs text-muted-foreground">
          Precios válidos hasta el {fechaCorta(p.vigencia_hasta)}. Esta cotización no es una factura.
        </p>
      </article>

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && !isPending && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar === "RECHAZADO" ? `¿El cliente rechazó la ${numero}?` : `¿Anular la ${numero}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "RECHAZADO"
                ? "Queda registrada como rechazada. No se puede volver atrás."
                : "Es para una cotización mal cargada. No se puede volver atrás: si hace falta, se arma otra."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmar) cerrar(confirmar);
              }}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
