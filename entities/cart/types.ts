export type CartItem = {
  productoId: string;
  nombre: string;
  tipo: string;
  variante: string;
  /** producto_variantes.id real, cuando la variante existe como fila propia. */
  varianteId?: string;
  cantidad: number;
  precioUnitario: number;
};

export interface CartItemStore {
  productoId: string;
  nombre: string;
  tipo: string;
  variante: string;
  /** producto_variantes.id real, cuando la variante existe como fila propia. */
  varianteId?: string;
  /** Precio por UNIDAD DE MEDIDA: por kilo si `unidadMedida` es KG, por pieza
   * si es UNIDAD. El subtotal de la línea es siempre `precio * cantidad`.
   * Con una lista de precios activa, este ya es el precio DE LA LISTA. */
  precio: number;
  /**
   * El precio de siempre, sin ninguna lista aplicada.
   *
   * Se guarda en la línea para que cambiar de lista pueda RE-PRECIAR el
   * carrito sin volver a mirar el catálogo: el ticket vive en otro componente
   * que a propósito no recibe los 2 MB de productos. También es lo que se
   * dibuja tachado al lado del precio de lista.
   *
   * Opcional: un carrito guardado en localStorage antes de esto no lo tiene, y
   * ahí se trata como igual a `precio` — sin lista, son lo mismo.
   */
  precioBase?: number;
  /** El costo, solo para las listas con regla por MARKUP. Mismo motivo. */
  costoBase?: number | null;
  cantidad: number;
  /**
   * Unidad en la que se vende el producto (`productos.unidad_medida`). Decide
   * si esta línea acepta cantidad fraccionada (0,750 kg) o solo enteros.
   *
   * Opcional porque no todos los orígenes del carrito conocen el producto
   * completo: una reserva confirmada, por ejemplo, entra con lo que guardó la
   * reserva. Ausente cae a UNIDAD, que es el comportamiento entero de
   * siempre — fail-closed, igual que en el server.
   */
  unidadMedida?: string | null;
  imagenUrl?: string | null;
  stockMaximo: number;
  /** IDs de `reservas` que esta línea del carrito viene a saldar (flujo "Confirmar venta" desde Reservas activas). */
  reservaIds?: string[];
  /**
   * Renglón cobrado SIN producto del catálogo (venta libre). `productoId` es
   * un id local sin correlato en la base, `nombre` y `variante` son la
   * descripción tipeada, y `precio` lo puso la vendedora. El server lo
   * registra con `producto_id` null y `es_venta_libre = true`, sin tocar
   * stock. Ver `features/pos/lib/venta-libre.ts`.
   */
  ventaLibre?: boolean;
}