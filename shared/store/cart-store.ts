import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItemStore } from "@/entities/cart/types";
import { pasoCantidad, redondearCantidad } from "@/shared/lib/unidad-venta";

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
  removeItem: (productoId: string, variante: string) => void;
  updateQuantity: (
    productoId: string,
    variante: string,
    cantidad: number,
  ) => void;
  clearCart: () => void;
  sincronizarNegocio: (negocioId: string | null) => void;
  setListaPrecio: (
    listaPrecioId: string | null,
    preciosPorLinea: Record<string, { precio: number; precioBase: number }>,
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
            (item) =>
              item.productoId === newItem.productoId &&
              item.variante === newItem.variante,
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
                currentItem.stockMaximo,
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

      removeItem: (productoId, variante) => {
        set((state) => ({
          items: state.items.filter(
            (item) =>
              !(item.productoId === productoId && item.variante === variante),
          ),
        }));
      },

      updateQuantity: (productoId, variante, cantidad) => {
        set((state) => ({
          items: state.items.map((item) => {
            if (item.productoId === productoId && item.variante === variante) {
              // No pasar el stock máximo ni bajar del mínimo vendible. Ese
              // mínimo YA NO es siempre 1: en un producto por peso es un
              // gramo, y clavarlo en 1 obligaría a vender de a kilos enteros
              // justo en el rubro donde nadie compra un kilo redondo.
              const minimo = pasoCantidad(item.unidadMedida);
              const safeQuantity = redondearCantidad(
                Math.max(minimo, Math.min(cantidad, item.stockMaximo)),
              );
              return { ...item, cantidad: safeQuantity };
            }
            return item;
          }),
        }));
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
       * La clave del mapa es `productoId|variante`, que es la misma con la que
       * el carrito identifica una línea. Una línea sin entrada en el mapa
       * queda como está.
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
            const nuevo = preciosPorLinea[`${item.productoId}|${item.variante}`];
            return nuevo === undefined
              ? item
              : { ...item, precio: nuevo.precio, precioBase: nuevo.precioBase };
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
