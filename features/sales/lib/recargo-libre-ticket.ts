import { formatearPct } from "@/shared/lib/recargo-ticket";

/**
 * El renglón del recargo libre en el papel, el PDF, el WhatsApp y la pantalla
 * del ticket. Una sola etiqueta para las cuatro superficies: dos redacciones
 * del mismo renglón terminan diciendo cosas distintas.
 *
 * Es plata de la venta (ya está en `total`), no interés de fiar: por eso no se
 * llama "recargo cuenta corriente". Con el porcentaje cuando se conoce.
 */
export function etiquetaRecargoLibre(datos: {
  recargoLibrePorcentaje?: number | null;
}): string {
  const pct = Number(datos.recargoLibrePorcentaje ?? 0);
  return pct > 0 ? `Recargo (${formatearPct(pct)})` : "Recargo";
}
