"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { CopiarDato } from "@/features/clients/ui/copiar-dato";
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import { useLinkCatalogo } from "@/shared/lib/use-negocio";
import Link from "next/link";
import type { OrdenCreada } from "../actions/crear-orden-tienda";

const pesos = (monto: number) =>
  monto.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export const numeroDeOrden = (numero: number) => `#${String(numero).padStart(5, "0")}`;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

/**
 * Lo que ve la clienta apenas se crea la orden con transferencia.
 *
 * El stock ya quedó apartado: por eso el plazo va bien a la vista. El aviso
 * por WhatsApp es un SEGUNDO toque y no automático: abrir WhatsApp después del
 * `await` de crear la orden lo convierte en un popup que el navegador bloquea
 * (mismo motivo que en el pedido de siempre).
 *
 * "Ver mi orden" lleva a la página pública (`/orden/<token>`): ahí se ve
 * cuando el pago se confirma, y se puede volver a abrir más tarde.
 */
export function OrdenCreadaPublica({
  orden,
  numeroWhatsApp,
  nombreComercio,
  onSeguir,
}: Readonly<{
  orden: OrdenCreada;
  numeroWhatsApp?: string | null;
  nombreComercio?: string | null;
  onSeguir: () => void;
}>) {
  const numero = numeroDeOrden(orden.numero);
  const linkCatalogo = useLinkCatalogo();

  const avisar = () => {
    const mensaje = `¡Hola${nombreComercio ? ` ${nombreComercio}` : ""}! Hice la orden ${numero} por ${pesos(orden.total)} y ya transferí. Te paso el comprobante.`;
    // Sincrónico dentro del click: si no, el navegador lo bloquea.
    window.open(linkWhatsapp(numeroWhatsApp, mensaje), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
      <div className="space-y-1 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <p className="text-lg font-bold text-foreground">¡Listo! Tu orden {numero} está reservada</p>
        <p className="text-sm text-muted-foreground">
          Transferí el total y la confirmamos apenas entre la plata.
        </p>
      </div>

      <div className="mt-6 space-y-2">
        <CopiarDato
          etiqueta="Total a transferir"
          valor={pesos(orden.total)}
          textoACopiar={String(orden.total)}
        />
        {orden.alias && <CopiarDato etiqueta="Alias de Mercado Pago" valor={orden.alias} />}
        {orden.titular && (
          <p className="px-1 text-xs text-muted-foreground">
            Titular: <span className="font-medium text-foreground">{orden.titular}</span>
          </p>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Tenés hasta las <span className="font-semibold text-foreground">{hora(orden.venceEn)}</span> para
          transferir. Después la orden vence y los productos vuelven a la venta.
        </p>
      </div>

      <div className="mt-auto space-y-2 pt-6">
        <Button
          type="button"
          onClick={avisar}
          className={`h-12 w-full text-sm font-bold ${BOTON_CATALOGO}`}
        >
          Ya transferí: avisar por WhatsApp
        </Button>
        <Button asChild variant="outline" className="h-11 w-full">
          <Link href={linkCatalogo(`orden/${orden.token}`)} onClick={onSeguir}>
            Ver mi orden
          </Link>
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onSeguir}>
          Seguir mirando
        </Button>
      </div>
    </div>
  );
}
