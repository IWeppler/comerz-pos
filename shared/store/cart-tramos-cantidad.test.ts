import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore, claveLinea } from "./cart-store";
import type { CartItemStore } from "@/entities/cart/types";

const copia = (): CartItemStore => ({ productoId:"a4", variante:"Simple", varianteId:"simple", nombre:"Fotocopia A4", tipo:"Servicio", precio:250, cantidad:1, stockMaximo:1000,
  preciosPorCantidad:[{desde:10,precio:220},{desde:50,precio:200},{desde:100,precio:180}] });

describe("tramos en el carrito real", () => {
  beforeEach(() => useCartStore.setState({items:[], listaPrecioId:null, pedidoActivo:null}));
  it("agregar, aumentar y bajar cantidad cambia precio y total en la misma escritura", () => {
    const store = useCartStore.getState();
    store.addItem({...copia(),cantidad:9}); expect(store.getTotalPrice()).toBe(2250);
    store.addItem(copia()); expect(store.getTotalPrice()).toBe(2200);
    store.updateQuantity("a4","Simple",12); expect(store.getTotalPrice()).toBe(2640);
    store.updateQuantity("a4","Simple",50); expect(store.getTotalPrice()).toBe(10000);
    store.updateQuantity("a4","Simple",100); expect(store.getTotalPrice()).toBe(18000);
    store.updateQuantity("a4","Simple",9); expect(store.getTotalPrice()).toBe(2250);
  });
  it("respeta el stock y mantiene cada variante separada", () => {
    const store=useCartStore.getState(); store.addItem({...copia(),cantidad:9,stockMaximo:9});
    store.addItem(copia()); expect(store.getTotalPrice()).toBe(2250);
    store.addItem({...copia(),variante:"Doble",varianteId:"doble",cantidad:9});
    expect(useCartStore.getState().items.map(i=>i.precio)).toEqual([250,250]);
  });
  it("cambiar listas conserva el tramo y su precio habitual para volver a él", () => {
    const store=useCartStore.getState(); store.addItem({...copia(),cantidad:12});
    store.setListaPrecio("mayorista",{[claveLinea(copia())]:{precio:230,precioBase:250,precioBaseEfectivo:230}});
    expect(store.getTotalPrice()).toBe(2640);
    store.updateQuantity("a4","Simple",9); expect(store.getTotalPrice()).toBe(2070);
  });
  it("cambiar a pack y volver a unidad no mezcla sus cantidades ni altera su precio fijo", () => {
    const store=useCartStore.getState(); const pack={id:"pack",nombre:"Pack x10",factor:10,regla_precio:"FIJO" as const,precio:2000};
    store.addItem({...copia(),cantidad:12,presentaciones:[pack]});
    store.cambiarForma("a4","Simple",null,"pack"); expect(store.getTotalPrice()).toBe(2000);
    store.updateQuantity("a4","Simple",10,"pack"); expect(store.getTotalPrice()).toBe(20000);
    store.cambiarForma("a4","Simple","pack",null); expect(store.getTotalPrice()).toBe(250);
  });
  it("restaurar un ticket recalcula desde su cantidad", () => {
    useCartStore.getState().reemplazarCarrito({items:[{...copia(),cantidad:50}],listaPrecioId:null,pedidoActivo:null});
    expect(useCartStore.getState().getTotalPrice()).toBe(10000);
  });
  it("sincronizar reglas modificadas o eliminadas actualiza el ticket y mantiene la base", () => {
    const store=useCartStore.getState(); store.addItem({...copia(),cantidad:12});
    store.actualizarTramos([{id:"a4",precios_por_cantidad:[{desde:10,precio:210}]}]);
    expect(store.getTotalPrice()).toBe(2520);
    store.actualizarTramos([{id:"a4",precios_por_cantidad:[]}]);
    expect(store.getTotalPrice()).toBe(3000);
    expect(useCartStore.getState().items[0].tramoCantidadDesde).toBeNull();
  });
  it("sumar la misma variante con nombre actualizado usa la cantidad conjunta", () => {
    const store=useCartStore.getState(); store.addItem({...copia(),cantidad:6});
    store.addItem({...copia(),variante:"Simple renombrada",cantidad:6});
    expect(useCartStore.getState().items.map(i=>i.precio)).toEqual([220,220]);
    expect(store.getTotalPrice()).toBe(2640);
  });
});
