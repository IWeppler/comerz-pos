import { describe, expect, it } from "vitest";
import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { calcularTotalesPedido } from "@/shared/lib/totales-pedido-publico";
import {
  motivoSinPagoOnline,
  normalizarCelular,
  opcionDeMedioOnline,
  opcionesConPagoOnline,
  resolverRenglonesOrden,
  totalesDelServer,
  type ProductoDb,
  type VarianteDb,
} from "./orden-tienda";

const item = (over: Partial<CartItemStore> = {}): CartItemStore => ({
  productoId: "p1",
  nombre: "Remera",
  tipo: "remeras",
  variante: "M",
  varianteId: "v1",
  precio: 10000,
  cantidad: 1,
  stockMaximo: 10,
  ...over,
});

const producto = (over: Partial<ProductoDb> = {}): ProductoDb => ({
  id: "p1",
  nombre: "Remera",
  precio: 10000,
  precios_por_cantidad: null,
  unidad_medida: "UNIDAD",
  tipo: "remeras",
  ...over,
});

const variante = (over: Partial<VarianteDb> = {}): VarianteDb => ({
  id: "v1",
  producto_id: "p1",
  precio: null,
  nombre_display: "M",
  ...over,
});

const promo = (over: Partial<PromocionDB>): PromocionDB =>
  ({
    id: "promo",
    nombre: "Promo",
    activa: true,
    acumulable: false,
    tipo_descuento: "PORCENTAJE",
    valor_descuento: 10,
    tipo_regla: null,
    monto_minimo: 0,
    mostrar_en_catalogo: true,
    prioridad: 0,
    promociones_metodos_pago: [],
    promociones_categorias: [],
    ...over,
  }) as PromocionDB;

describe("qué se puede pagar online", () => {
  it("presentación, importe fijado y envío lejano siguen por WhatsApp", () => {
    expect(motivoSinPagoOnline({ items: [item()] })).toBeNull();
    expect(motivoSinPagoOnline({ items: [item({ presentacionId: "x" })] })).toBe("PRESENTACION");
    expect(motivoSinPagoOnline({ items: [item({ importeFijado: 1000 })] })).toBe("IMPORTE_FIJADO");
    expect(motivoSinPagoOnline({ items: [item()], destinoEnvio: "LEJOS" })).toBe("ENVIO_A_CONVENIR");
    expect(motivoSinPagoOnline({ items: [item()], destinoEnvio: "LOCAL" })).toBeNull();
  });

  it("con cobro online, solo los medios online: los de WhatsApp se esconden", () => {
    const base: OpcionPagoPublica[] = [
      { tipo: "EFECTIVO", etiqueta: "Efectivo", recargoPorcentaje: 0 },
      { tipo: "TRANSFERENCIA", etiqueta: "Transferencia", recargoPorcentaje: 5 },
    ];
    const r = opcionesConPagoOnline(base, { transferencia: true, mercadopago: false }, { disponible: true, incluirMercadoPago: true });
    expect(r).toEqual([{ tipo: "TRANSFERENCIA", etiqueta: "Transferencia", recargoPorcentaje: 0, online: "TRANSFERENCIA" }]);
    const todos = opcionesConPagoOnline(base, { transferencia: true, mercadopago: true }, { disponible: true, incluirMercadoPago: true });
    expect(todos.map((o) => o.online)).toEqual(["MP_CHECKOUT", "MP_CREDITO", "TRANSFERENCIA"]);
  });

  it("sin ningún medio online prendido, quedan los de siempre", () => {
    const base: OpcionPagoPublica[] = [{ tipo: "EFECTIVO", etiqueta: "Efectivo", recargoPorcentaje: 0 }];
    expect(opcionesConPagoOnline(base, { transferencia: false, mercadopago: false }, { disponible: true, incluirMercadoPago: true })).toBe(base);
  });

  it("Mercado Pago suma dos opciones solo cuando el checkout está listo", () => {
    const sin = opcionesConPagoOnline([], { transferencia: false, mercadopago: true }, { disponible: true, incluirMercadoPago: false });
    expect(sin).toEqual([]);
    const con = opcionesConPagoOnline([], { transferencia: false, mercadopago: true }, { disponible: true, incluirMercadoPago: true });
    expect(con.map((o) => o.online)).toEqual(["MP_CHECKOUT", "MP_CREDITO"]);
  });

  it("si el pedido no se puede pagar online, quedan las opciones de siempre", () => {
    const base: OpcionPagoPublica[] = [{ tipo: "TRANSFERENCIA", etiqueta: "Transferencia", recargoPorcentaje: 0 }];
    const r = opcionesConPagoOnline(base, { transferencia: true, mercadopago: true }, { disponible: false, incluirMercadoPago: true });
    expect(r).toBe(base);
  });
});

describe("recálculo en el server", () => {
  it("usa el precio de la BASE, no el del navegador", () => {
    const r = resolverRenglonesOrden({
      items: [item({ precio: 1, cantidad: 2 })],
      productos: [producto()],
      variantes: [variante({ precio: 12000 })],
    });
    expect(r.ok && r.renglones).toEqual([
      { producto_id: "p1", variante_id: "v1", nombre: "Remera", variante: "M", precio_unitario: 12000, cantidad: 2, subtotal: 24000 },
    ]);
  });

  it("variante sin precio propio hereda el del producto", () => {
    const r = resolverRenglonesOrden({ items: [item()], productos: [producto({ precio: 9000 })], variantes: [variante()] });
    expect(r.ok && r.renglones[0].precio_unitario).toBe(9000);
  });

  it("el tramo por cantidad se decide sobre el total de la variante", () => {
    const r = resolverRenglonesOrden({
      items: [item({ cantidad: 3 }), item({ cantidad: 3 })],
      productos: [producto({ precios_por_cantidad: [{ desde: 6, precio: 8000 }] })],
      variantes: [variante()],
    });
    expect(r.ok && r.renglones.map((x) => x.precio_unitario)).toEqual([8000, 8000]);
  });

  it("toma la categoría de la base: el navegador no puede meterse en una promo", () => {
    const r = resolverRenglonesOrden({ items: [item({ tipo: "en-promo" })], productos: [producto({ tipo: "remeras" })], variantes: [variante()] });
    expect(r.ok && r.itemsServer[0].tipo).toBe("remeras");
  });

  it.each([
    ["producto que no vino (despublicado)", { productos: [] }, "PRODUCTO_NO_DISPONIBLE"],
    ["variante de otro producto", { variantes: [variante({ producto_id: "otro" })] }, "PRODUCTO_NO_DISPONIBLE"],
    ["precio en cero", { productos: [producto({ precio: 0 })] }, "SIN_PRECIO"],
  ])("falla con %s", (_, over, codigo) => {
    const r = resolverRenglonesOrden({ items: [item()], productos: [producto()], variantes: [variante()], ...over });
    expect(r.ok === false && r.error.codigo).toBe(codigo);
  });

  it("rechaza cantidades negativas y decimales en productos por unidad", () => {
    for (const cantidad of [-1, 0, 1.5]) {
      const r = resolverRenglonesOrden({ items: [item({ cantidad })], productos: [producto()], variantes: [variante()] });
      expect(r.ok === false && r.error.codigo).toBe("CANTIDAD_INVALIDA");
    }
  });

  it("el total del server coincide con el del carrito cuando nadie tocó nada", () => {
    const promos = [promo({ tipo_regla: "METODO_PAGO", promociones_metodos_pago: [{ metodo_pago: "TRANSFERENCIA" }] })];
    const items = [item({ cantidad: 2 })];
    const delCarrito = calcularTotalesPedido({ items, promociones: promos, opcionPago: opcionDeMedioOnline("TRANSFERENCIA") });
    const r = resolverRenglonesOrden({ items, productos: [producto()], variantes: [variante()] });
    if (!r.ok) throw new Error("no resolvió");
    const delServer = totalesDelServer({ itemsServer: r.itemsServer, promociones: promos, medio: "TRANSFERENCIA", modalidad: "RETIRO", config: null });
    expect(delServer.total).toBe(delCarrito.total);
    expect(delServer.total).toBe(18000);
  });

  it("si el precio cambió en la base, el total del server es otro (la action frena)", () => {
    const items = [item({ precio: 10000 })];
    const delCarrito = calcularTotalesPedido({ items, promociones: [], opcionPago: opcionDeMedioOnline("TRANSFERENCIA") });
    const r = resolverRenglonesOrden({ items, productos: [producto({ precio: 11000 })], variantes: [variante()] });
    if (!r.ok) throw new Error("no resolvió");
    const delServer = totalesDelServer({ itemsServer: r.itemsServer, promociones: [], medio: "TRANSFERENCIA", modalidad: "RETIRO", config: null });
    expect(delServer.total).not.toBe(delCarrito.total);
  });

  it("una promo de billetera no se regala en el checkout de MP; una general sí", () => {
    const billetera = promo({ id: "b", tipo_regla: "METODO_PAGO", promociones_metodos_pago: [{ metodo_pago: "BILLETERA_VIRTUAL" }] });
    const general = promo({ id: "g", valor_descuento: 5 });
    const r = resolverRenglonesOrden({ items: [item()], productos: [producto()], variantes: [variante()] });
    if (!r.ok) throw new Error("no resolvió");
    expect(totalesDelServer({ itemsServer: r.itemsServer, promociones: [billetera], medio: "MP_CHECKOUT", modalidad: "RETIRO", config: null }).total).toBe(10000);
    expect(totalesDelServer({ itemsServer: r.itemsServer, promociones: [general], medio: "MP_CHECKOUT", modalidad: "RETIRO", config: null }).total).toBe(9500);
  });

  it("el envío local entra al total", () => {
    const r = resolverRenglonesOrden({ items: [item()], productos: [producto()], variantes: [variante()] });
    if (!r.ok) throw new Error("no resolvió");
    const t = totalesDelServer({ itemsServer: r.itemsServer, promociones: [], medio: "TRANSFERENCIA", modalidad: "ENVIO", config: { envio_costo_local: 1500 } });
    expect(t.total).toBe(11500);
  });
});

describe("celular de la clienta", () => {
  it.each([
    ["11 5470-2118", "5491154702118"],
    ["+54 9 11 5470 2118", "5491154702118"],
    ["0351 155 123456", null],
    ["123", null],
  ])("%s → %s", (entrada, esperado) => expect(normalizarCelular(entrada)).toBe(esperado));
});
