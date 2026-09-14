import { formatearNumeroComprobante } from "@/shared/lib/facturacion";

/** Lo mínimo que hace falta de una venta para saber cómo se llama su ticket. */
type VentaConComprobante = {
  id: string;
  comprobantes?:
    | { punto_venta?: number | null; numero?: number | null }[]
    | { punto_venta?: number | null; numero?: number | null }
    | null;
};

/**
 * El número con el que se identifica una venta, UNO para toda la app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NACE DE UN BUG DE USABILIDAD, NO DE ESTILO
 *
 * La columna "Ticket" del historial mostraba el prefijo del UUID de la venta
 * (`#75DF84C3`) y el recibo impreso mostraba el número del comprobante
 * (`#00001-00000417`). Son la misma venta con dos nombres distintos y sin
 * ninguna relación entre ellos: con el papel en la mano era IMPOSIBLE
 * encontrar la fila, y al revés también. En un mostrador eso es no poder
 * contestar "¿me cambiás esto que compré ayer?".
 *
 * El número del comprobante gana porque es el que existe fuera del sistema:
 * está impreso, se lo dictó al cliente por WhatsApp y —cuando se prenda
 * ARCA— es el que va a tener el CAE. El prefijo del UUID no está en ningún
 * papel.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL PREFIJO DEL UUID QUEDA COMO RESPALDO, no como formato alternativo: las
 * ventas anteriores a la tabla `comprobantes` no tienen ninguno, y las que
 * fallaron al emitir tampoco (la emisión es el único paso de la venta que no
 * puede voltearla — ver `emitir-comprobante.ts`). Sin respaldo esas filas
 * quedarían sin nada que decirle al cliente.
 *
 * Se toma el PRIMER comprobante, que es el de emisión. Una nota de crédito
 * posterior tiene su propio número y no reemplaza al del ticket que el cliente
 * se llevó.
 *
 * Devuelve el número PELADO, sin `#`: el numeral lo pone cada lugar que lo
 * dibuja, y ya son cinco (tabla, tarjeta mobile, hoja del ticket, impresión y
 * PDF).
 */
export function numeroTicketVenta(venta: VentaConComprobante): string {
  const comprobante = Array.isArray(venta.comprobantes)
    ? venta.comprobantes[0]
    : venta.comprobantes;

  return (
    formatearNumeroComprobante(comprobante?.punto_venta, comprobante?.numero) ??
    venta.id.split("-")[0].toUpperCase()
  );
}
