import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItemStore } from "@/entities/cart/types";
import { pasoCantidad, redondearCantidad } from "@/shared/lib/unidad-venta";
import {
  precioEnForma,
  topeCantidadEnForma,
} from "@/shared/lib/presentaciones";

/**
 * Qué hace que dos líneas sean LA MISMA: producto + variante + forma. El kilo
 * suelto y el balde de la misma crema son dos renglones, con precio y
 * cantidad propios. Es la clave de los mapas de re-precio y la que usan
 * remove/update para encontrar la línea.
 */
export function claveLinea(item: {
  productoId: string;
  variante: string;
  presentacionId?: string | null;
}): string {
  return `${item.productoId}|${item.variante}|${item.presentacionId ?? ""}`;
}

/** Cuánto acepta la línea como máximo, en la unidad en que se vende. */
function topeDeLinea(item: CartItemStore): number {
  return topeCantidadEnForma(
    item.stockMaximo,
    item.presentacionId ? { factor: item.factor ?? 1 } : null,
  );
}

interface CartState {
  items: CartItemStore[];
  isOpen: boolean;
  /** Negocio al que pertenece el carrito guardado. Ver `sincronizarNegocio`. */
  negocioId: string | null;
  /**
   * Lista de precios con la que se está armando este ticket. `null` = precio
   * base, que es el comportamiento de siempre y el de 7 de los 8 negocios.
   *
   * Vive en el store y no en un componente porque la eligen y la leen DOS
   * pantallas hermanas: la grilla la necesita para poner el precio al agregar
   * y el ticket para mostrarla, re-preciar y mandarla con la venta.
   */
  listaPrecioId: string | null;
  /**
   * El pedido que la caja cargó al carrito para cobrar. Viaja con la venta
   * (`pedido_id`) para que quede COBRADO y a nombre de quien lo armó. Se
   * vacía con el carrito.
   */
  pedidoActivo: { id: string; numero: number; vendedor: string | null } | null;
  setPedidoActivo: (pedido: CartState["pedidoActivo"]) => void;

  addItem: (item: CartItemStore) => void;
  removeItem: (
    productoId: string,
    variante: string,
    presentacionId?: string | null,
  ) => void;
  updateQuantity: (
    productoId: string,
    variante: string,
    cantidad: number,
    presentacionId?: string | null,
  ) => void;
  /**
   * Cambia la FORMA de una línea: de kilo suelto a balde o al revés. Es otra
   * identidad, así que si ya hay una línea en la forma nueva se funde con
   * ella. La cantidad vuelve a 1: 2,35 kg no son "2,35 baldes".
   */
  cambiarForma: (
    productoId: string,
    variante: string,
    presentacionIdActual: string | null,
    presentacionIdNueva: string | null,
  ) => void;
  clearCart: () => void;
  sincronizarNegocio: (negocioId: string | null) => void;
  setListaPrecio: (
    listaPrecioId: string | null,
    preciosPorLinea: Record<
      string,
      { precio: number; precioBase: number; precioBaseEfectivo?: number }
    >,
  ) => void;

  toggleCart: () => void;
  setIsOpen: (isOpen: boolean) => void;

  getTotalItems: () => number;
  getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      negocioId: null,
      listaPrecioId: null,
      pedidoActivo: null,
      setPedidoActivo: (pedidoActivo) => set({ pedidoActivo }),

      addItem: (newItem) => {
        set((state) => {
          const existingItemIndex = state.items.findIndex(
            (item) => claveLinea(item) === claveLinea(newItem),
          );

          if (existingItemIndex >= 0) {
            const updatedItems = [...state.items];
            const currentItem = updatedItems[existingItemIndex];

            // Redondeado a 3 decimales: sumar pesos en binario deja colas
            // (0,1 + 0,2 = 0,30000000000000004) y esa cola se arrastraría
            // hasta el subtotal de la línea.
            const newQuantity = redondearCantidad(
              Math.min(
                currentItem.cantidad + newItem.cantidad,
                topeDeLinea(currentItem),
              ),
            );

            updatedItems[existingItemIndex] = {
              ...currentItem,
              cantidad: newQuantity,
              reservaIds:
                currentItem.reservaIds || newItem.reservaIds
                  ? [
                      ...(currentItem.reservaIds ?? []),
                      ...(newItem.reservaIds ?? []),
                    ]
                  : undefined,
            };

            return { items: updatedItems, isOpen: true };
          }

          return {
            items: [...state.items, newItem],
            isOpen: true,
          };
        });
      },

      removeItem: (productoId, variante, presentacionId = null) => {
        const clave = claveLinea({ productoId, variante, presentacionId });
        set((state) => ({
          items: state.items.filter((item) => claveLinea(item) !== clave),
        }));
      },

      updateQuantity: (productoId, variante, cantidad, presentacionId = null) => {
        const clave = claveLinea({ productoId, variante, presentacionId });
        set((state) => ({
          items: state.items.map((item) => {
            if (claveLinea(item) === clave) {
              // No pasar el stock máximo ni bajar del mínimo vendible. Ese
              // mínimo YA NO es siempre 1: en un producto por peso es un
              // gramo, y clavarlo en 1 obligaría a vender de a kilos enteros
              // justo en el rubro donde nadie compra un kilo redondo.
              // Por presentación es al revés: entera siempre, y el tope es
              // cuántas presentaciones entran en el stock.
              const enPresentacion = !!item.presentacionId;
              const minimo = enPresentacion
                ? 1
                : pasoCantidad(item.unidadMedida);
              const pedida = enPresentacion ? Math.round(cantidad) : cantidad;
              const safeQuantity = redondearCantidad(
                Math.max(minimo, Math.min(pedida, topeDeLinea(item))),
              );
              return { ...item, cantidad: safeQuantity };
            }
            return item;
          }),
        }));
      },

      cambiarForma: (productoId, variante, actual, nueva) => {
        if ((actual ?? null) === (nueva ?? null)) return;
        const claveActual = claveLinea({
          productoId,
          variante,
          presentacionId: actual,
        });
        set((state) => {
          const origen = state.items.find(
            (i) => claveLinea(i) === claveActual,
          );
          if (!origen) return {};
          const presentacion =
            nueva === null
              ? null
              : (origen.presentaciones?.find((p) => p.id === nueva) ?? null);
          // Una forma que la línea no conoce no se puede elegir.
          if (nueva !== null && !presentacion) return {};

          const precioBase = origen.precioBase ?? origen.precio;
          // No derivarlo del precio de la presentación: una FIJA de $45.000
          // no revela si el kilo vigente por lista vale $12.000 o $10.000.
          const precioBaseEfectivo =
            origen.precioBaseEfectivo ??
            (origen.presentacionId ? precioBase : origen.precio);
          const cambiada: CartItemStore = {
            ...origen,
            presentacionId: presentacion?.id ?? null,
            presentacionNombre: presentacion?.nombre ?? null,
            factor: presentacion?.factor ?? 1,
            precio: precioEnForma(precioBaseEfectivo, presentacion),
            precioBase,
            precioBaseEfectivo,
            cantidad: 1,
          };

          const claveNueva = claveLinea(cambiada);
          const destino = state.items.find(
            (i) => claveLinea(i) === claveNueva,
          );
          if (destino) {
            // Ya había una línea en esa forma: se suma ahí y la de origen se va.
            return {
              items: state.items
                .filter((i) => claveLinea(i) !== claveActual)
                .map((i) =>
                  claveLinea(i) === claveNueva
                    ? {
                        ...i,
                        cantidad: Math.min(i.cantidad + 1, topeDeLinea(i)),
                      }
                    : i,
                ),
            };
          }
          return {
            items: state.items.map((i) =>
              claveLinea(i) === claveActual ? cambiada : i,
            ),
          };
        });
      },

      clearCart: () => set({ items: [], pedidoActivo: null }),

      /**
       * Cambia la lista Y los precios de las líneas EN LA MISMA ESCRITURA.
       *
       * El store no sabe calcular un precio y no tiene por qué: recibe el mapa
       * ya resuelto por `precioDeLista`, la misma función que usa el server.
       * Lo que sí garantiza es que las dos cosas cambien juntas — con dos
       * escrituras habría un render con la lista nueva y los precios viejos, y
       * ese es justo el instante en el que alguien confirma la venta.
       *
       * La clave del mapa es `claveLinea(item)` (producto|variante|forma), la
       * misma con la que el carrito identifica una línea. Una línea sin
       * entrada en el mapa queda como está. `precio` viene YA en la forma de
       * la línea (por balde si es balde); `precioBase` es el precio de lista
       * base y `precioBaseEfectivo` el vigente después de aplicar la lista.
       *
       * Se escribe TAMBIÉN `precioBase`, y eso no es un extra: una línea que
       * entró al carrito desde otra pantalla (Inventario, la ficha de un
       * producto) no lo trae, y sin sellarlo la próxima re-tarifación tomaría
       * el precio YA descontado como base y volvería a descontarle. Un
       * descuento sobre un descuento, cada vez que se toca el selector.
       */
      setListaPrecio: (listaPrecioId, preciosPorLinea) => {
        set((state) => ({
          listaPrecioId,
          items: state.items.map((item) => {
            const nuevo = preciosPorLinea[claveLinea(item)];
            return nuevo === undefined
              ? item
              : {
                  ...item,
                  precio: nuevo.precio,
                  precioBase: nuevo.precioBase,
                  precioBaseEfectivo:
                    nuevo.precioBaseEfectivo ?? nuevo.precioBase,
                };
          }),
        }));
      },

      /**
       * Deja el carrito atado al negocio activo, y lo vacía si venía de otro.
       *
       * El carrito se persiste en localStorage y el cambio de negocio es una
       * navegación blanda (router.refresh()), así que sin esto los productos
       * de un comercio sobreviven al cambio y se intentan vender en el otro:
       * precios, variantes y stock de un negocio ajeno, que la RLS ni siquiera
       * deja leer. Vaciar es la única lectura segura — un carrito a medias es
       * mercadería sobre el mostrador, no un dato que se pueda traducir.
       *
       * `negocioId` null (carrito guardado antes de que existiera este campo)
       * cuenta como "de otro": no hay forma de saber de quién era.
       */
      sincronizarNegocio: (negocioId) => {
        set((state) => {
          if (state.negocioId === negocioId) return {};
          // Sin negocio activo no se decide nada: es el estado en tránsito de
          // un render antes de que el layout resuelva la membresía, no un
          // cambio de comercio. Borrar el sello acá haría que la próxima
          // sincronización vaciara un carrito que estaba bien.
          if (!negocioId) return {};
          // La lista se descarta SIEMPRE al cambiar de comercio, aunque el
          // carrito esté vacío: `listas_precios` es por negocio, y un id de
          // otro comercio no lo devuelve ni la RLS.
          if (state.items.length === 0)
            return { negocioId, listaPrecioId: null };
          return { negocioId, items: [], listaPrecioId: null };
        });
      },

      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      setIsOpen: (isOpen) => set({ isOpen }),

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.cantidad, 0);
      },

      getTotalPrice: () => {
        return get().items.reduce(
          (total, item) => total + item.precio * item.cantidad,
          0,
        );
      },
    }),
    {
      name: "vivero-tostado-storage",
      partialize: (state) => ({
        items: state.items,
        negocioId: state.negocioId,
        listaPrecioId: state.listaPrecioId,
      }),
    },
  ),
);
