"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { CopiarDato } from "@/features/clients/ui/copiar-dato";
import { formatearCuit } from "@/shared/lib/cuit";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import { pagarOrdenMpAction } from "../actions/pagar-orden-mp";

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
  /** Datos para transferir: solo vienen en una transferencia que espera pago. */
  alias: string | null;
  titular: string | null;
  cvu?: string | null;
  cuit?: string | null;
  items: {
    nombre: string;
    variante: string | null;
    cantidad: number;
    subtotal: number;
  }[];
}

const pesos = (monto: number) =>
  Number(monto).toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const ZONA = "America/Argentina/Buenos_Aires";
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONA,
  });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONA,
  });

const numeroDeOrden = (numero: number) => `#${String(numero).padStart(5, "0")}`;

const MEDIO: Record<OrdenPublicaDatos["medio"], string> = {
  TRANSFERENCIA: "Transferencia",
  MP_CHECKOUT: "Mercado Pago",
  MP_CREDITO: "Cuotas sin tarjeta (Mercado Pago)",
};

/** Cada cuánto se vuelve a mirar una orden que espera pago. */
const REFRESCO_MS = 20_000;

/**
 * La orden vista por la clienta: es su COMPROBANTE del pedido (número, fecha,
 * productos, total, entrega y medio) y, si eligió transferencia, la pantalla
 * con todo lo que necesita para transferir desde cualquier banco: monto,
 * alias, CVU, titular y CUIT, cada uno para copiar.
 *
 * Mientras espera el pago se refresca sola cada 20 s: cada lectura intenta
 * conciliar en el server, así que cuando la plata entra la pantalla pasa a
 * "pagada" sin que toque nada. El link es el comprobante: se puede guardar o
 * imprimir.
 */
export function OrdenPublica({
  orden,
  token,
  volvioDeMp = false,
}: Readonly<{
  orden: OrdenPublicaDatos;
  token: string;
  volvioDeMp?: boolean;
}>) {
  const router = useRouter();
  const [abriendoMp, startAbrirMp] = useTransition();
  const [errorMp, setErrorMp] = useState<string | null>(null);
  const esCheckout =
    orden.medio === "MP_CHECKOUT" || orden.medio === "MP_CREDITO";
  const esperando =
    orden.estado === "PENDIENTE_PAGO" || orden.estado === "EN_PROCESO";
  const numero = numeroDeOrden(orden.numero);
  const transfiere =
    orden.estado === "PENDIENTE_PAGO" && orden.medio === "TRANSFERENCIA";

  useEffect(() => {
    if (!esperando) return;
    const id = setInterval(() => router.refresh(), REFRESCO_MS);
    return () => clearInterval(id);
  }, [esperando, router]);

  const pagarConMp = () =>
    startAbrirMp(async () => {
      setErrorMp(null);
      const r = await pagarOrdenMpAction(token);
      if (r.ok) window.location.assign(r.initPoint);
      else setErrorMp(r.error);
    });

  return (
    <div className="comprobante-orden space-y-5">
      {/* Al imprimir sale SOLO esto: ni el navbar, ni la franja de promos,
          ni el footer de la tienda, ni ningún botón. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .comprobante-orden, .comprobante-orden * { visibility: visible !important; }
        .comprobante-orden { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 16px; }
        .comprobante-orden button, .comprobante-orden .no-imprimir { display: none !important; }
        @page { margin: 12mm; }
      }`}</style>
      <Encabezado
        estado={orden.estado}
        medio={orden.medio}
        numero={numero}
        comercio={orden.comercio}
      />

      {transfiere && (
        <section className="space-y-3 rounded-2xl border-2 border-foreground/80 bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Datos para transferir</h2>
            <p className="no-imprimir text-xs text-muted-foreground">
              Tocá cada dato para copiarlo. Transferí el monto exacto: así
              confirmamos tu pago solos.
            </p>
          </div>
          {/* Impreso, los datos van como texto: los de copiar son botones. */}
          <dl className="hidden grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm print:grid">
            <dt>Monto a transferir</dt>
            <dd className="text-right font-semibold">{pesos(orden.total)}</dd>
            {orden.alias && (
              <>
                <dt>Alias</dt>
                <dd className="text-right font-mono">{orden.alias}</dd>
              </>
            )}
            {orden.cvu && (
              <>
                <dt>CVU</dt>
                <dd className="text-right font-mono">{orden.cvu}</dd>
              </>
            )}
          </dl>
          <CopiarDato
            etiqueta="Monto a transferir"
            valor={pesos(orden.total)}
            textoACopiar={String(Number(orden.total))}
            className="border-foreground/30"
          />
          {orden.alias && <CopiarDato etiqueta="Alias" valor={orden.alias} />}
          {orden.cvu && <CopiarDato etiqueta="CVU" valor={orden.cvu} />}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
            {orden.titular && (
              <>
                <dt className="text-muted-foreground">Titular</dt>
                <dd className="text-right font-medium">{orden.titular}</dd>
              </>
            )}
            {orden.cuit && (
              <>
                <dt className="text-muted-foreground">CUIT</dt>
                <dd className="text-right font-medium">
                  {formatearCuit(orden.cuit)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Banco</dt>
            <dd className="text-right font-medium">Mercado Pago</dd>
            {orden.comercio && (
              <>
                <dt className="text-muted-foreground">Comercio</dt>
                <dd className="text-right font-medium">{orden.comercio}</dd>
              </>
            )}
          </dl>
          {/* Sin "avisar por WhatsApp": la transferencia al alias de la cuenta
              conectada se confirma sola (webhook + conciliación). */}
          <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              Tenés hasta las{" "}
              <span className="font-semibold">{hora(orden.vence_en)}</span>. Tus
              productos quedan reservados hasta entonces. Cuando llegue tu
              transferencia, esta página se confirma sola.
            </p>
          </div>
        </section>
      )}

      {orden.estado === "PENDIENTE_PAGO" && esCheckout && (
        <section className="no-imprimir space-y-3 rounded-2xl border border-border bg-card p-4">
          {volvioDeMp ? (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Estamos confirmando tu pago con Mercado Pago. Esta página se
              actualiza sola.
            </p>
          ) : (
            <p className="text-sm">
              Tenés hasta las{" "}
              <span className="font-semibold">{hora(orden.vence_en)}</span> para
              pagar.
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
            {volvioDeMp
              ? "No pude pagar: intentar de nuevo"
              : "Pagar con Mercado Pago"}
          </Button>
          {errorMp && (
            <p role="alert" className="text-xs font-medium text-danger">
              {errorMp}
            </p>
          )}
        </section>
      )}

      {/* El comprobante del pedido. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3 border-b border-dashed border-border pb-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Comprobante de pedido
            </p>
            <p className="text-lg font-bold">Orden {numero}</p>
            {orden.comercio && (
              <p className="text-sm text-muted-foreground">{orden.comercio}</p>
            )}
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {fechaHora(orden.creado_en)}
          </p>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-dashed border-border py-3 text-sm">
          <dt className="text-muted-foreground">Cliente</dt>
          <dd className="text-right">{orden.cliente_nombre}</dd>
          <dt className="text-muted-foreground">Entrega</dt>
          <dd className="text-right">
            {orden.modalidad_entrega === "ENVIO"
              ? "Envío a domicilio"
              : "Retiro en el local"}
          </dd>
          <dt className="text-muted-foreground">Pago</dt>
          <dd className="text-right">{MEDIO[orden.medio]}</dd>
          {orden.pagada_en && (
            <>
              <dt className="text-muted-foreground">Pagado</dt>
              <dd className="text-right">{fechaHora(orden.pagada_en)}</dd>
            </>
          )}
        </dl>

        <ul className="space-y-2 border-b border-dashed border-border py-3 text-sm">
          {orden.items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                {Number(item.cantidad)} × {item.nombre}
                {item.variante && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {item.variante}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-medium">
                {pesos(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-1 pt-3 text-sm text-muted-foreground">
          <Renglon etiqueta="Subtotal" valor={pesos(orden.subtotal)} />
          {Number(orden.descuento) > 0 && (
            <Renglon
              etiqueta="Descuento"
              valor={`− ${pesos(orden.descuento)}`}
            />
          )}
          {Number(orden.recargo) > 0 && (
            <Renglon etiqueta="Recargo" valor={`+ ${pesos(orden.recargo)}`} />
          )}
          {orden.modalidad_entrega === "ENVIO" && (
            <Renglon
              etiqueta="Envío"
              valor={Number(orden.envio) > 0 ? pesos(orden.envio) : "Gratis"}
            />
          )}
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-base font-semibold">Total</span>
          <span className="text-2xl font-bold">{pesos(orden.total)}</span>
        </div>
      </section>
    </div>
  );
}

function Encabezado({
  estado,
  medio,
  numero,
  comercio,
}: Readonly<{
  estado: string;
  medio: OrdenPublicaDatos["medio"];
  numero: string;
  comercio: string | null;
}>) {
  const tienda = comercio ?? "La tienda";
  if (estado === "PAGADA" || estado === "ENTREGADA") {
    return (
      <Titulo
        icono={<CheckCircle2 className="h-12 w-12 text-success" />}
        titulo="¡Pago confirmado!"
      >
        {tienda} ya tiene tu pedido {numero}. Te va a escribir para coordinar la
        entrega.
      </Titulo>
    );
  }
  if (estado === "EN_PROCESO") {
    return (
      <Titulo
        icono={<Clock className="h-12 w-12 text-warning" />}
        titulo="Tu pago está en proceso"
      >
        Mercado Pago lo está revisando. No vuelvas a pagar: esta página se
        actualiza sola.
      </Titulo>
    );
  }
  if (estado === "REVISAR" || estado === "PAGADA_SIN_STOCK") {
    return (
      <Titulo
        icono={<Clock className="h-12 w-12 text-warning" />}
        titulo="Recibimos tu pago"
      >
        {tienda} lo tiene que revisar antes de confirmar tu pedido {numero}. Te
        va a escribir.
      </Titulo>
    );
  }
  if (
    estado === "REEMBOLSADA" ||
    estado === "CONTRACARGO" ||
    estado === "EN_DISPUTA"
  ) {
    return (
      <Titulo
        icono={<XCircle className="h-12 w-12 text-muted-foreground" />}
        titulo={estado === "REEMBOLSADA" ? "Pago devuelto" : "Pago en reclamo"}
      >
        Por cualquier duda sobre la orden {numero}, escribile a la tienda.
      </Titulo>
    );
  }
  if (estado === "VENCIDA" || estado === "CANCELADA") {
    return (
      <Titulo
        icono={<XCircle className="h-12 w-12 text-muted-foreground" />}
        titulo={`La orden ${numero} ${estado === "VENCIDA" ? "venció" : "se canceló"}`}
      >
        Los productos volvieron a la venta. Si ya transferiste, escribile a la
        tienda y lo resuelven.
      </Titulo>
    );
  }
  // PENDIENTE_PAGO: el pedido está hecho; falta pagarlo.
  return (
    <Titulo
      icono={<CheckCircle2 className="h-12 w-12 text-success" />}
      titulo="¡Pedido realizado!"
    >
      {medio === "TRANSFERENCIA"
        ? `Orden ${numero}. Falta tu transferencia para confirmarlo.`
        : `Orden ${numero}. Falta el pago para confirmarlo.`}
    </Titulo>
  );
}

function Titulo({
  icono,
  titulo,
  children,
}: Readonly<{
  icono: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="space-y-2 text-center">
      <div className="flex justify-center">{icono}</div>
      <h1 className="text-xl font-bold">{titulo}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Renglon({
  etiqueta,
  valor,
}: Readonly<{ etiqueta: string; valor: string }>) {
  return (
    <div className="flex items-center justify-between">
      <span>{etiqueta}</span>
      <span className="font-medium">{valor}</span>
    </div>
  );
}
