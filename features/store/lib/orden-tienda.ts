import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { precioBaseDeVariante } from "@/shared/lib/precio-de-lista";
import { claveCantidad, precioPorCantidad, type TramoCantidad } from "@/shared/lib/precio-por-cantidad";
import { normalizarCantidadVendible, redondearCantidad } from "@/shared/lib/unidad-venta";
import { telefonoAWhatsapp } from "@/shared/lib/telefono-whatsapp";
import {
  calcularTotalesPedido,
  type ConfigEnvioGratis,
  type TotalesPedido,
} from "@/shared/lib/totales-pedido-publico";

/**
 * La orden del catálogo con pago online: qué se puede pagar online, y el
 * RECÁLCULO en el server de precios y total.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN CRITERIO, UN MÓDULO
 *
 * El total que la clienta acepta sale de `calcularTotalesPedido`, la misma
 * función que arma el desglose del carrito. El server la vuelve a correr con
 * los precios LEÍDOS DE LA BASE (`precioBaseDeVariante` + `precioPorCantidad`,
 * la cascada del POS) y con la categoría de la base. Lo que manda el navegador
 * solo se compara: si no coincide, la orden no se crea y se le muestra el
 * total nuevo. Nunca se cobra un número que la clienta no vio.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * QUÉ NO SE PAGA ONLINE TODAVÍA (fail-closed: esos pedidos siguen por
 * WhatsApp, como hasta hoy):
 *   - renglones con PRESENTACIÓN (balde, pack) o con IMPORTE FIJADO ("$1000
 *     de jamón"): su precio tiene reglas propias que hoy solo resuelve
 *     `create-sale.ts`, y duplicarlas acá sería un segundo criterio de plata;
 *   - ENVÍO A OTRA LOCALIDAD: el costo es "a convenir" y no se puede cobrar
 *     un total sin él.
 */

export type MedioOnline = "TRANSFERENCIA" | "MP_CHECKOUT" | "MP_CREDITO";

export interface OpcionesCobroOnline {
  transferencia: boolean;
  mercadopago: boolean;
}

export type MotivoSinPagoOnline = "PRESENTACION" | "IMPORTE_FIJADO" | "ENVIO_A_CONVENIR";

export const MENSAJE_SIN_PAGO_ONLINE: Record<MotivoSinPagoOnline, string> = {
  PRESENTACION:
    "Este pedido tiene productos por presentación: el pago online no está disponible, lo coordinás por WhatsApp.",
  IMPORTE_FIJADO:
    "Este pedido tiene productos por importe: el pago online no está disponible, lo coordinás por WhatsApp.",
  ENVIO_A_CONVENIR:
    "El envío a tu localidad se coordina por WhatsApp, así que este pedido no se puede pagar online.",
};

export function motivoSinPagoOnline({
  items,
  destinoEnvio,
}: {
  items: CartItemStore[];
  destinoEnvio?: "LOCAL" | "LEJOS" | null;
}): MotivoSinPagoOnline | null {
  if (items.some((i) => i.presentacionId)) return "PRESENTACION";
  if (items.some((i) => i.importeFijado != null)) return "IMPORTE_FIJADO";
  if (destinoEnvio === "LEJOS") return "ENVIO_A_CONVENIR";
  return null;
}

/**
 * El tipo de promoción contra el que matchea cada medio online.
 *
 * TRANSFERENCIA: las promos por método "Transferencia" valen, igual que en el
 * mostrador. MERCADO PAGO: ninguna promo por método aplica (solo las generales
 * y los cupones). Es fail-closed a propósito: un "10% con billetera" pensado
 * para el QR del mostrador no se regala solo en el checkout online con tarjeta.
 * Si el comercio quiere descuento por pagar con MP, se decide aparte.
 */
const TIPO_PROMO_DE_MEDIO: Record<MedioOnline, string> = {
  TRANSFERENCIA: "TRANSFERENCIA",
  MP_CHECKOUT: "MERCADO_PAGO_ONLINE",
  MP_CREDITO: "MERCADO_PAGO_ONLINE",
};

const ETIQUETA_MEDIO: Record<MedioOnline, string> = {
  TRANSFERENCIA: "Transferencia",
  MP_CHECKOUT: "Mercado Pago",
  MP_CREDITO: "Cuotas sin tarjeta",
};

export function opcionDeMedioOnline(medio: MedioOnline): OpcionPagoPublica {
  return {
    tipo: TIPO_PROMO_DE_MEDIO[medio] as OpcionPagoPublica["tipo"],
    etiqueta: ETIQUETA_MEDIO[medio],
    // Sin recargo: la transferencia a MP no tiene costo y el recargo por pagar
    // con MP online es una decisión del comercio que todavía no existe.
    recargoPorcentaje: 0,
    online: medio,
  };
}

/**
 * Los botones del paso 2 con los medios online del comercio.
 *
 * Con la transferencia online prendida, el botón "Transferencia" de siempre
 * (pedido por WhatsApp) se REEMPLAZA por el online: dos botones iguales con
 * comportamientos distintos confunden. Mercado Pago se suma como dos opciones
 * (checkout y cuotas sin tarjeta), que por detrás son la misma preference.
 *
 * `incluirMercadoPago` existe porque el checkout de MP (T6) todavía no está:
 * hasta entonces se ofrece solo la transferencia.
 */
export function opcionesConPagoOnline(
  opciones: OpcionPagoPublica[],
  online: OpcionesCobroOnline,
  { disponible, incluirMercadoPago }: { disponible: boolean; incluirMercadoPago: boolean },
): OpcionPagoPublica[] {
  if (!disponible) return opciones;
  let resultado = opciones;
  if (online.transferencia) {
    const transferencia = opcionDeMedioOnline("TRANSFERENCIA");
    resultado = resultado.some((o) => o.tipo === "TRANSFERENCIA")
      ? resultado.map((o) => (o.tipo === "TRANSFERENCIA" ? transferencia : o))
      : [transferencia, ...resultado];
  }
  if (online.mercadopago && incluirMercadoPago) {
    resultado = [opcionDeMedioOnline("MP_CHECKOUT"), opcionDeMedioOnline("MP_CREDITO"), ...resultado];
  }
  return resultado;
}

// ─── Recálculo en el server ─────────────────────────────────────────────

export interface ProductoDb {
  id: string;
  nombre: string;
  precio: number | null;
  precios_por_cantidad: TramoCantidad[] | null;
  unidad_medida: string | null;
  tipo: string | null;
}

export interface VarianteDb {
  id: string;
  producto_id: string;
  precio: number | null;
  nombre_display: string;
}

export interface RenglonOrden {
  producto_id: string;
  variante_id: string;
  nombre: string;
  variante: string;
  precio_unitario: number;
  cantidad: number;
  subtotal: number;
}

export type ErrorOrden =
  | { codigo: "PRODUCTO_NO_DISPONIBLE"; nombre: string }
  | { codigo: "SIN_PRECIO"; nombre: string }
  | { codigo: "CANTIDAD_INVALIDA"; nombre: string }
  | { codigo: "NO_ONLINE"; motivo: MotivoSinPagoOnline };

/**
 * Cada renglón con el precio de la BASE. El producto y la variante se leen
 * con el cliente anónimo del catálogo, así que uno despublicado o una variante
 * inactiva simplemente no vienen: el renglón falla con el nombre puesto, no se
 * descarta en silencio.
 */
export function resolverRenglonesOrden({
  items,
  productos,
  variantes,
}: {
  items: CartItemStore[];
  productos: ProductoDb[];
  variantes: VarianteDb[];
}): { ok: true; renglones: RenglonOrden[]; itemsServer: CartItemStore[] } | { ok: false; error: ErrorOrden } {
  const motivo = motivoSinPagoOnline({ items });
  if (motivo) return { ok: false, error: { codigo: "NO_ONLINE", motivo } };

  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const variantePorId = new Map(variantes.map((v) => [v.id, v]));

  // Primero las cantidades por variante REAL: el tramo de precio por cantidad
  // se decide sobre el total de la variante, como en el POS.
  const cantidades = new Map<string, number>();
  const resueltos: { item: CartItemStore; producto: ProductoDb; variante: VarianteDb; cantidad: number }[] = [];
  for (const item of items) {
    const producto = productoPorId.get(item.productoId);
    const variante = item.varianteId ? variantePorId.get(item.varianteId) : undefined;
    if (!producto || !variante || variante.producto_id !== producto.id) {
      return { ok: false, error: { codigo: "PRODUCTO_NO_DISPONIBLE", nombre: item.nombre } };
    }
    const cantidad = normalizarCantidadVendible(item.cantidad, producto.unidad_medida);
    if (cantidad === null) {
      return { ok: false, error: { codigo: "CANTIDAD_INVALIDA", nombre: item.nombre } };
    }
    const clave = claveCantidad({ productoId: producto.id, varianteId: variante.id, variante: variante.nombre_display });
    cantidades.set(clave, redondearCantidad((cantidades.get(clave) ?? 0) + cantidad));
    resueltos.push({ item, producto, variante, cantidad });
  }

  const renglones: RenglonOrden[] = [];
  const itemsServer: CartItemStore[] = [];
  for (const { item, producto, variante, cantidad } of resueltos) {
    const base = precioBaseDeVariante({ precio: producto.precio }, { precio: variante.precio });
    const clave = claveCantidad({ productoId: producto.id, varianteId: variante.id, variante: variante.nombre_display });
    const precio = precioPorCantidad(base, cantidades.get(clave) ?? cantidad, producto.precios_por_cantidad).precio;
    if (!(precio > 0)) return { ok: false, error: { codigo: "SIN_PRECIO", nombre: item.nombre } };

    renglones.push({
      producto_id: producto.id,
      variante_id: variante.id,
      nombre: producto.nombre,
      variante: variante.nombre_display,
      precio_unitario: precio,
      cantidad,
      subtotal: Math.round(precio * cantidad * 100) / 100,
    });
    // El mismo renglón para `calcularTotalesPedido`, con precio y CATEGORÍA de
    // la base: con el `tipo` del navegador cualquiera entraría en una promo.
    itemsServer.push({
      ...item,
      precio,
      cantidad,
      tipo: producto.tipo ?? "",
      unidadMedida: producto.unidad_medida,
    });
  }
  return { ok: true, renglones, itemsServer };
}

export interface ConfigEnvioOrden extends ConfigEnvioGratis {
  envio_costo_local?: number | null;
}

/** El total del server, con la MISMA función que el carrito. */
export function totalesDelServer({
  itemsServer,
  promociones,
  medio,
  modalidad,
  config,
}: {
  itemsServer: CartItemStore[];
  promociones: PromocionDB[];
  medio: MedioOnline;
  modalidad: "RETIRO" | "ENVIO";
  config: ConfigEnvioOrden | null;
}): TotalesPedido {
  // Solo llega acá RETIRO o envío LOCAL (el lejano no se paga online).
  const destino = modalidad === "ENVIO" ? "LOCAL" : null;
  return calcularTotalesPedido({
    items: itemsServer,
    promociones,
    opcionPago: opcionDeMedioOnline(medio),
    costoEnvio: destino ? Number(config?.envio_costo_local) || 0 : 0,
    configEnvio: config,
    destinoEnvio: destino,
  });
}

/** Celular de la clienta en el formato de wa.me (549 + área + número). */
export function normalizarCelular(entrada: string): string | null {
  return telefonoAWhatsapp(entrada);
}
