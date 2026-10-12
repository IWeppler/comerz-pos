"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { CopiarDato } from "@/features/clients/ui/copiar-dato";
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import { pagarOrdenMpAction } from "../actions/pagar-orden-mp";
import { Loader2 } from "lucide-react";

export interface OrdenPublicaDatos {
  numero: number;
  estado: string;
  medio: "TRANSFERENCIA" | "MP_CHECKOUT" | "MP_CREDITO";
  cliente_nombre: string;
  modalidad_entrega: "RETIRO" | "ENVIO";
  subtotal: number;
  descuento: number;
  recargo: number;
  envio: number;
  total: number;
  vence_en: string;
  creado_en: string;
  pagada_en: string | null;
  comercio: string | null;
  whatsapp: string | null;
  alias: string | null;
  titular: string | null;
  items: { nombre: string; variante: string | null; cantidad: number; subtotal: number }[];
}

const pesos = (monto: number) =>
  Number(monto).toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

const numeroDeOrden = (numero: number) => `#${String(numero).padStart(5, "0")}`;

/** Cada cuánto se vuelve a mirar una orden que espera pago. */
const REFRESCO_MS = 20_000;

/**
 * La orden vista por la clienta. Mientras espera el pago se refresca sola cada
 * 20 s: cada lectura intenta conciliar la transferencia en el server, así que
 * cuando la plata entra la pantalla pasa a "pagada" sin que toque nada.
 */
export function OrdenPublica({
  orden,
  token,
  volvioDeMp = false,
}: Readonly<{ orden: OrdenPublicaDatos; token: string; volvioDeMp?: boolean }>) {
  const router = useRouter();
  const [abriendoMp, startAbrirMp] = useTransition();
  const [errorMp, setErrorMp] = useState<string | null>(null);
  const esCheckout = orden.medio === "MP_CHECKOUT" || orden.medio === "MP_CREDITO";

  const pagarConMp = () =>
    startAbrirMp(async () => {
      setErrorMp(null);
      const r = await pagarOrdenMpAction(token);
      if (r.ok) window.location.assign(r.initPoint);
      else setErrorMp(r.error);
    });
  const esperando = orden.estado === "PENDIENTE_PAGO" || orden.estado === "EN_PROCESO";
  const numero = numeroDeOrden(orden.numero);

  useEffect(() => {
    if (!esperando) return;
    const id = setInterval(() => router.refresh(), REFRESCO_MS);
    return () => clearInterval(id);
  }, [esperando, router]);

  const avisar = (mensaje: string) =>
    window.open(linkWhatsapp(orden.whatsapp, mensaje), "_blank", "noopener,noreferrer");

  return (
    <div className="space-y-5">
      <Encabezado estado={orden.estado} numero={numero} comercio={orden.comercio} />

      {orden.estado === "PENDIENTE_PAGO" && orden.medio === "TRANSFERENCIA" && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Transferí exactamente este total:</p>
          <CopiarDato etiqueta="Total" valor={pesos(orden.total)} textoACopiar={String(orden.total)} />
          {orden.alias && <CopiarDato etiqueta="Alias de Mercado Pago" valor={orden.alias} />}
          {orden.titular && (
            <p className="px-1 text-xs text-muted-foreground">
              Titular: <span className="font-medium text-foreground">{orden.titular}</span>
            </p>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Tenés hasta las <span className="font-semibold text-foreground">{hora(orden.vence_en)}</span>.
              Transferí el monto exacto: así confirmamos tu pago solos. Esta página se actualiza sola.
            </p>
          </div>
          <Button
            type="button"
            className={`h-12 w-full text-sm font-bold ${BOTON_CATALOGO}`}
            onClick={() =>
              avisar(`¡Hola! Hice la orden ${numero} por ${pesos(orden.total)} y ya transferí. Te paso el comprobante.`)
            }
          >
            Ya transferí: avisar por WhatsApp
          </Button>
        </section>
      )}

      {orden.estado === "PENDIENTE_PAGO" && esCheckout && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          {volvioDeMp ? (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Estamos confirmando tu pago con Mercado Pago. Esta página se actualiza sola.
            </p>
          ) : (
            <p className="text-sm">
              Tenés hasta las <span className="font-semibold">{hora(orden.vence_en)}</span> para pagar.
            </p>
          )}
          <Button
            type="button"
            onClick={pagarConMp}
            disabled={abriendoMp}
            variant={volvioDeMp ? "outline" : "default"}
            className={`h-12 w-full text-sm font-bold ${volvioDeMp ? "" : BOTON_CATALOGO}`}
          >
            {abriendoMp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {volvioDeMp ? "No pude pagar: intentar de nuevo" : "Pagar con Mercado Pago"}
          </Button>
          {errorMp && <p role="alert" className="text-xs font-medium text-danger">{errorMp}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold">Tu pedido</p>
        <ul className="space-y-2 text-sm">
          {orden.items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                {Number(item.cantidad)} × {item.nombre}
                {item.variante && <span className="text-muted-foreground"> · {item.variante}</span>}
              </span>
              <span className="shrink-0 font-medium">{pesos(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {Number(orden.descuento) > 0 && <Renglon etiqueta="Descuento" valor={`− ${pesos(orden.descuento)}`} />}
          {Number(orden.recargo) > 0 && <Renglon etiqueta="Recargo" valor={`+ ${pesos(orden.recargo)}`} />}
          {Number(orden.envio) > 0 && <Renglon etiqueta="Envío" valor={pesos(orden.envio)} />}
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-muted-foreground">Total</span>
          <span className="text-xl font-bold">{pesos(orden.total)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {orden.modalidad_entrega === "ENVIO" ? "Con envío" : "Retirás en el local"}
        </p>
      </section>

      {!esperando && orden.whatsapp && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => avisar(`¡Hola! Te escribo por la orden ${numero}.`)}
        >
          Escribirle a {orden.comercio ?? "la tienda"}
        </Button>
      )}
    </div>
  );
}

function Encabezado({
  estado,
  numero,
  comercio,
}: Readonly<{ estado: string; numero: string; comercio: string | null }>) {
  if (estado === "PAGADA" || estado === "ENTREGADA") {
    return (
      <div className="space-y-1 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h1 className="text-lg font-bold">¡Pago confirmado! Orden {numero}</h1>
        <p className="text-sm text-muted-foreground">
          {comercio ?? "La tienda"} ya tiene tu pedido. Te va a escribir para coordinar la entrega.
        </p>
      </div>
    );
  }
  if (estado === "EN_PROCESO") {
    return (
      <div className="space-y-1 text-center">
        <Clock className="mx-auto h-10 w-10 text-warning" />
        <h1 className="text-lg font-bold">Orden {numero}: tu pago está en proceso</h1>
        <p className="text-sm text-muted-foreground">
          Mercado Pago lo está revisando. No vuelvas a pagar: esta página se actualiza sola.
        </p>
      </div>
    );
  }
  if (estado === "REVISAR" || estado === "PAGADA_SIN_STOCK") {
    return (
      <div className="space-y-1 text-center">
        <Clock className="mx-auto h-10 w-10 text-warning" />
        <h1 className="text-lg font-bold">Recibimos tu pago de la orden {numero}</h1>
        <p className="text-sm text-muted-foreground">
          {comercio ?? "La tienda"} lo tiene que revisar antes de confirmar tu pedido. Te va a escribir.
        </p>
      </div>
    );
  }
  if (estado === "REEMBOLSADA" || estado === "CONTRACARGO" || estado === "EN_DISPUTA") {
    return (
      <div className="space-y-1 text-center">
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">
          Orden {numero}: {estado === "REEMBOLSADA" ? "pago devuelto" : "pago en reclamo"}
        </h1>
        <p className="text-sm text-muted-foreground">Por cualquier duda, escribile a la tienda.</p>
      </div>
    );
  }
  if (estado === "VENCIDA" || estado === "CANCELADA") {
    return (
      <div className="space-y-1 text-center">
        <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">
          La orden {numero} {estado === "VENCIDA" ? "venció" : "se canceló"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Los productos volvieron a la venta. Si ya transferiste, escribile a la tienda y lo resuelven.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1 text-center">
      <Clock className="mx-auto h-10 w-10 text-warning" />
      <h1 className="text-lg font-bold">Orden {numero}: esperando tu pago</h1>
      <p className="text-sm text-muted-foreground">Tus productos quedan reservados mientras tanto.</p>
    </div>
  );
}

function Renglon({ etiqueta, valor }: Readonly<{ etiqueta: string; valor: string }>) {
  return (
    <div className="flex items-center justify-between">
      <span>{etiqueta}</span>
      <span className="font-medium">{valor}</span>
    </div>
  );
}
