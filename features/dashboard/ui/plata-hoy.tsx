import Link from "next/link";
import { Banknote, Clock, HandCoins } from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";

interface PlataHoyProps {
  /** Efectivo en las cajas abiertas ahora (`posicion_dinero.efectivo.total`):
   * el mismo número que /caja y el arqueo. */
  efectivo: number;
  cajasAbiertas: number;
  /** Cobrado que todavía no cayó en ninguna cuenta (tarjetas, diferidos). */
  porAcreditar: number;
  /** Deuda de cuenta corriente ya vencida y cobrable (`deuda_cc_vencida`). */
  deudaVencida: { monto: number; clientes: number } | null;
}

/**
 * "¿Cuánta plata hay?" — la primera pregunta del día, contestada arriba del
 * panel sin tener que ir a /caja (6/10/2026).
 *
 * Solo LEE números que ya calculan /caja y Clientes; no hay cuenta nueva acá.
 * Tres cosas distintas y por eso tres tarjetas, nunca sumadas: el efectivo se
 * puede usar ya, lo por acreditar es tuyo pero todavía no, y la deuda vencida
 * es plata que hay que salir a cobrar. Sumarlas daría un número que no existe.
 *
 * Cada tarjeta lleva a donde se actúa sobre ese número.
 */
export function PlataHoy({
  efectivo,
  cajasAbiertas,
  porAcreditar,
  deudaVencida,
}: Readonly<PlataHoyProps>) {
  const tarjetas = [
    {
      href: "/caja",
      Icono: Banknote,
      titulo: "Efectivo en caja",
      monto: efectivo,
      detalle:
        cajasAbiertas === 0
          ? "No hay cajas abiertas"
          : `${cajasAbiertas} caja${cajasAbiertas === 1 ? "" : "s"} abierta${cajasAbiertas === 1 ? "" : "s"}`,
      tono: "text-foreground",
    },
    {
      href: "/caja",
      Icono: Clock,
      titulo: "Por acreditar",
      monto: porAcreditar,
      detalle: "Cobrado que todavía no está en la cuenta",
      tono: "text-foreground",
    },
    {
      href: "/clientes",
      Icono: HandCoins,
      titulo: "Deuda vencida",
      monto: deudaVencida?.monto ?? 0,
      detalle:
        deudaVencida && deudaVencida.clientes > 0
          ? `${deudaVencida.clientes} cliente${deudaVencida.clientes === 1 ? "" : "s"} para cobrar`
          : "Nadie con deuda vencida",
      tono:
        deudaVencida && deudaVencida.monto > 0 ? "text-danger" : "text-foreground",
    },
  ];

  return (
    <section aria-label="Plata" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {tarjetas.map(({ href, Icono, titulo, monto, detalle, tono }) => (
        <Link
          key={titulo}
          href={href}
          className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icono className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{titulo}</span>
            <span
              className={`block truncate font-sans text-lg font-semibold tabular-nums ${tono}`}
            >
              {formatearMoneda(monto)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {detalle}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}
