import type { PresentacionCarrito } from "@/shared/lib/presentaciones";

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
  /**
   * Precio vigente de UNA unidad base después de aplicar la lista activa.
   * Se conserva separado porque una presentación FIJA no permite reconstruir
   * ese número desde `precio`, y cambiar luego a una forma HEREDADA tiene que
   * seguir respetando la lista sin esperar a un efecto de React.
   */
  precioBaseEfectivo?: number;
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
  /**
   * Presentación en la que se vende ESTA línea (Balde 4,7 kg, Pack x10).
   * null/ausente = unidad base. Con presentación, `cantidad` es en
   * presentaciones (entera), `precio` es por presentación y el stock que se
   * descuenta es `cantidad × factor`, que calcula el server desde la base.
   * Forma parte de la IDENTIDAD de la línea: el kilo suelto y el balde de la
   * misma crema son dos renglones.
   */
  presentacionId?: string | null;
  presentacionNombre?: string | null;
  factor?: number;
  /**
   * Las presentaciones que aplican a esta variante, para poder cambiar de
   * forma desde el ticket sin volver al catálogo. Snapshot al agregar.
   */
  presentaciones?: PresentacionCarrito[];
  imagenUrl?: string | null;
  /** Siempre en UNIDAD BASE, también en una línea por presentación. */
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
