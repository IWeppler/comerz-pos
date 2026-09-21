/**
 * El ancho del papel de la impresora térmica.
 *
 * Las térmicas del mercado son de 58 o de 80 milímetros, y cuál tiene cada
 * comercio no se deduce de nada: ni del rubro, ni del tamaño, ni del navegador.
 * Hasta el 8/9/2026 estaba clavado en 80 dentro del `@media print` de
 * `ticket-sheet.tsx`, así que en una de 58 el ticket salía cortado.
 *
 * El CSS se arma acá y no en el componente para que el número que va al
 * `@page` y el que va al ancho del contenido salgan SIEMPRE del mismo lugar.
 * Con dos definiciones, la primera vez que alguien toque una y no la otra el
 * ticket se imprime con el papel de un ancho y el texto de otro, y eso solo se
 * descubre en papel.
 *
 * NO afecta al PDF (es A4) ni al texto de WhatsApp (no tiene ancho).
 */

export const ANCHOS_TICKET = [58, 80] as const;
export type AnchoTicket = (typeof ANCHOS_TICKET)[number];

/** Lo que se imprime hoy. Cambiarlo le cambia el papel a todos los comercios
 * que no hayan elegido: por eso es 80 y no otra cosa. */
export const ANCHO_TICKET_DEFAULT: AnchoTicket = 80;

/** Fail-closed, mismo criterio que `normalizarRubro`: lo que no se entiende
 * cae al default en vez de romper la impresión. */
export function normalizarAnchoTicket(valor: unknown): AnchoTicket {
  const numero = Number(valor);
  return (ANCHOS_TICKET as readonly number[]).includes(numero)
    ? (numero as AnchoTicket)
    : ANCHO_TICKET_DEFAULT;
}

export const ETIQUETA_ANCHO_TICKET: Record<AnchoTicket, string> = {
  58: "58 mm (angosto)",
  80: "80 mm (estándar)",
};

/**
 * A 58mm entra bastante menos texto: el cuerpo baja un punto y los nombres de
 * producto se cortan antes. Es lo único que cambia además del ancho.
 */
const CUERPO_PT: Record<AnchoTicket, number> = { 58: 10, 80: 12 };

/**
 * El CSS de impresión completo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE FALTABA: ESCONDER TODO LO DEMÁS
 *
 * El bloque anterior ocultaba el interior del sheet (`.ticket-screen-only`) y
 * mostraba el ticket, pero NADA escondía la aplicación de atrás. Radix portea
 * el sheet a `body`, así que el POS, la barra y la grilla seguían en el árbol
 * y salían impresos con él.
 *
 * Se resuelve con `visibility` y no con `display`, que es lo que permite que un
 * hijo vuelva a ser visible aunque su padre no lo sea: con `display:none` en el
 * body, el ticket —que está adentro— desaparecería también. Y por eso el
 * wrapper se posiciona absoluto arriba a la izquierda: sigue ocupando el lugar
 * que le daba su contenedor, que puede ser cualquiera.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function cssImpresionTicket(ancho: AnchoTicket): string {
  const mm = `${ancho}mm`;

  return `
@media print {
  @page { size: ${mm} auto; margin: 0; }

  html, body {
    width: ${mm};
    height: auto;
    margin: 0;
    padding: 0;
    background: #fff;
  }

  /* Todo invisible… */
  body * { visibility: hidden !important; }

  /* …menos el ticket y lo que tiene adentro. */
  #ticket-print-wrapper,
  #ticket-print-wrapper * { visibility: visible !important; }

  #ticket-print-wrapper {
    display: block !important;
    position: absolute !important;
    left: 0;
    top: 0;
    width: ${mm};
    min-height: 0;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-size: ${CUERPO_PT[ancho]}pt;
  }

  /* ───────────────────────────────────────────────────────────────────────
     DOS COPIAS EN UNA SOLA IMPRESIÓN (recibo de pago de cuenta corriente)

     Un papel posicionado ABSOLUTO no se pagina: el navegador ignora los
     cortes de página que tenga adentro, así que las dos copias saldrían
     pegadas en la misma hoja. Por eso el wrapper multicopia vuelve a ser
     estático — puede hacerlo porque cuelga directo del
     .ticket-sheet-print-scope, que arriba ya quedó sin margen ni ancho
     propio. El ticket de venta sigue absoluto, sin cambio.
     ─────────────────────────────────────────────────────────────────────── */
  #ticket-print-wrapper.ticket-print-multicopia {
    position: static !important;
  }

  /* El corte que separa una copia de la otra. Lo lleva solo la primera: en
     la última sería una hoja en blanco (o papel de más en la térmica). */
  #ticket-print-wrapper .recibo-copia-corte {
    break-after: page;
    page-break-after: always;
  }

  /* El sheet deja de ser un panel flotante y pasa a ser papel. */
  .ticket-sheet-print-scope {
    position: static !important;
    width: ${mm} !important;
    max-width: ${mm} !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    transform: none !important;
    border: 0 !important;
    box-shadow: none !important;
  }

  .ticket-screen-only { display: none !important; }
}
`.trim();
}
