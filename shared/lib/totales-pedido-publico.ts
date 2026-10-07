import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import {
  calcularDescuentoCarritoPublico,
  getPromocionesElegibles,
} from "@/shared/components/cart-sidebar/cart-sidebar-utils";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { esFraccionable } from "@/shared/lib/unidad-venta";
import { calcularDescuentoPromocion } from "@/shared/lib/descuento-promocion";

export interface ConfigEnvioGratis {
  envio_gratis_desde_monto?: number | null;
  envio_gratis_desde_unidades?: number | null;
  envio_gratis_alcance?: "LOCAL" | "TODOS";
}

export function progresoEnvioGratis({ items, base, config }: {
  items: CartItemStore[];
  base: number;
  config?: ConfigEnvioGratis | null;
}) {
  const monto = Number(config?.envio_gratis_desde_monto);
  const unidades = Number(config?.envio_gratis_desde_unidades);
  const porMonto = Number.isFinite(monto) && monto > 0;
  const porUnidades = Number.isFinite(unidades) && unidades > 0;
  const cantidad = items.reduce((s, i) => s + (esFraccionable(i.unidadMedida) ? 1 : i.cantidad), 0);
  const faltaMonto = porMonto ? Math.max(0, monto - Math.max(0, base)) : null;
  const faltaUnidades = porUnidades ? Math.max(0, unidades - cantidad) : null;
  const porcentaje = Math.min(100, Math.max(0, porMonto ? base / monto * 100 : 0, porUnidades ? cantidad / unidades * 100 : 0));
  return { aplica: porMonto || porUnidades, alcanzado: items.length > 0 && (faltaMonto === 0 || faltaUnidades === 0), faltaMonto, faltaUnidades, porcentaje };
}

/**
 * EL total del pedido del catálogo público, con su desglose.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES EL ÚNICO LUGAR DONDE SE CALCULA
 *
 * Lo consumen las DOS puntas que tienen que decir lo mismo: el desglose que la
 * clienta ve antes de apretar, y el mensaje de WhatsApp que le llega al
 * comercio. Antes cada una armaba su propia cuenta —la UI restaba promos y el
 * generador del mensaje recibía un total ya calculado más tres listas de
 * avisos— y alcanzaba con tocar una para que el papel y la pantalla dijeran
 * números distintos. Acá se calcula una vez y se pasa el mismo objeto a las
 * dos.
 *
 * Es PURO y sin IO: recibe items, promociones y el método elegido, y devuelve
 * números. Toda la matriz —promo general contra promo por método, recargo
 * sobre descuento, envío— se prueba sin base y sin navegador.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL ORDEN DE LA CUENTA IMPORTA Y ES EL DEL POS:
 *
 *   base   = subtotal − descuento
 *   recargo = base × porcentaje        ← sobre la BASE, no sobre el subtotal
 *   total  = base + recargo + envío
 *
 * El recargo se calcula sobre lo que realmente se va a cobrar por la
 * mercadería, que es lo que hace `calcularPagosConRecargo` en el mostrador
 * (ver `recargo-metodo.ts`, mismo redondeo al peso). Calcularlo sobre el
 * subtotal le cobraría a la clienta un recargo por plata que le descontaron.
 *
 * EL ENVÍO QUEDA AFUERA DEL RECARGO a propósito: es un costo que el comercio
 * traslada, no mercadería, y recargarlo sería cobrar comisión sobre el flete.
 *
 * DESCUENTO Y RECARGO SON RENGLONES SEPARADOS, nunca un neto. Un negocio puede
 * tener las dos cosas a la vez —Evens tiene 30% OFF con tarjeta y 15% de
 * recargo con tarjeta— y mostrar solo la resta escondería que hay un recargo.
 * El renglón de recargo dice el porcentaje justamente para que se lea como
 * recargo y no como "descuento más chico".
 */
export interface RenglonTotal {
  etiqueta: string;
  monto: number;
}

export interface TotalesPedido {
  descuentosPorPromocion?: { id: string; monto: number }[];
  subtotal: number;
  /** Null cuando no hay promo aplicable (o cuando todavía no se eligió pago). */
  descuento: RenglonTotal | null;
  /** Null cuando el método elegido no cobra recargo. */
  recargo: RenglonTotal | null;
  /** Null salvo envío con costo conocido. "A convenir" no es un número. */
  envio: RenglonTotal | null;
  total: number;
  /** Las promos que efectivamente entraron, para el mensaje de WhatsApp. */
  promosAplicadas: PromocionDB[];
}

export interface DescuentoPorMetodo {
  /** Lo que sale pagando con ese método, ya redondeado al peso. */
  precio: number;
  /** Cuánto se ahorra, en pesos. */
  ahorro: number;
  /**
   * El ahorro como porcentaje entero, o null si no hay uno que sea EXACTO.
   *
   * Se deriva de la plata y después se verifica contra ella: solo se devuelve
   * un porcentaje si al aplicarlo sobre el precio de lista se llega otra vez al
   * mismo ahorro al peso. Con eso, un badge que dice "20% OFF" es una cuenta
   * que la clienta puede hacer y le va a dar.
   *
   * Es null con las promos de monto fijo ($2.000 OFF sobre $17.350 son
   * 11,53%, y "12% OFF" sería $2.082). En ese caso el badge muestra la plata,
   * que siempre es exacta.
   *
   * No se lee `valor_descuento` de la promo a propósito: el descuento que
   * termina aplicando puede venir de otra promo que la del método (en Evens
   * gana una general del 20% sobre la de efectivo del 10%) o de varias
   * acumulables. El único número que siempre corresponde al precio de al lado
   * es el que sale del precio.
   */
  porcentaje: number | null;
  /** Cómo se lo nombra a la clienta, en minúscula: "efectivo". */
  metodo: string;
}

/** Ver `DescuentoPorMetodo.porcentaje`. */
function porcentajeExacto(precio: number, ahorro: number): number | null {
  const redondeado = Math.round((ahorro / precio) * 100);
  if (redondeado <= 0) return null;
  return Math.round((precio * redondeado) / 100) === ahorro ? redondeado : null;
}

/**
 * El mejor precio que consigue UN producto eligiendo cómo pagar. Es lo que la
 * tarjeta del catálogo y la ficha muestran debajo del precio de lista.
 *
 * SALE DE `calcularTotalesPedido`, la misma función que arma el desglose del
 * paso 2, corriéndola sobre un carrito de un solo ítem. No es reuso por
 * elegancia: si la ficha calculara por su cuenta, la clienta vería un precio en
 * la grilla y otro al confirmar, y el que pierde credibilidad es el segundo.
 * Todo lo que la cuenta del carrito ya sabe —monto mínimo, promo por
 * categoría, fechas, acumulables contra exclusivas, redondeo— vale acá sin
 * escribir una línea más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SOLO MÉTODOS SIN RECARGO, y es la decisión que hace que el número sea
 * cumplible.
 *
 * En Evens la tarjeta tiene 30% OFF y ADEMÁS 15% de recargo. Es el mayor
 * descuento del negocio, así que "el mejor" sin más criterio anunciaría
 * $14.000 sobre un producto de $20.000 — y al confirmar con tarjeta el
 * desglose diría $16.100, porque el recargo entra. Como acá los recargos no se
 * muestran (son del paso 2, cuando se elige), la única forma de que la
 * anotación no mienta es no ofrecer métodos que lo tengan. Con efectivo o
 * transferencia, el precio anunciado es exactamente el que aparece al
 * confirmar.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DEVUELVE NULL cuando no hay nada que decir, y la pantalla no dibuja nada: ni
 * "0% OFF" ni un espacio reservado. Es null si el negocio no tiene ninguna
 * promo por método publicada, si no tiene métodos sin recargo, o si para ESTE
 * producto no aplica ninguna (el caso típico: una promo con monto mínimo por
 * encima del precio).
 */
export function mejorDescuentoPorMetodo({
  precio,
  categoria,
  promociones,
  opcionesPago,
}: {
  precio: number;
  /** `productos.tipo`, que es contra lo que matchean las promos por categoría. */
  categoria?: string | null;
  promociones: PromocionDB[];
  opcionesPago: OpcionPagoPublica[];
}): DescuentoPorMetodo | null {
  if (precio <= 0) return null;

  // La regla es de CONFIGURACIÓN: la anotación habla de pagar de una manera,
  // así que sin ninguna promo por método no corresponde, aunque haya un
  // descuento general que sí aplique. Ese descuento general igual entra en la
  // cuenta de abajo cuando la anotación se muestra — es parte del precio real.
  const hayPromoPorMetodo = promociones.some(
    (promo) =>
      promo.tipo_regla === "METODO_PAGO" && promo.mostrar_en_catalogo !== false,
  );
  if (!hayPromoPorMetodo) return null;

  const sinRecargo = opcionesPago.filter(
    (opcion) => opcion.recargoPorcentaje === 0,
  );
  if (sinRecargo.length === 0) return null;

  const item: CartItemStore = {
    productoId: "ficha",
    nombre: "",
    tipo: categoria ?? "",
    variante: "",
    precio,
    cantidad: 1,
    stockMaximo: 1,
  };

  let mejor: DescuentoPorMetodo | null = null;

  for (const opcion of sinRecargo) {
    const totales = calcularTotalesPedido({
      items: [item],
      promociones,
      opcionPago: opcion,
    });

    // Sin recargo ni envío, el total ES el precio con descuento.
    if (totales.total >= precio) continue;
    if (mejor && totales.total >= mejor.precio) continue;

    const ahorro = precio - totales.total;

    mejor = {
      precio: totales.total,
      ahorro,
      porcentaje: porcentajeExacto(precio, ahorro),
      metodo: opcion.etiqueta.toLowerCase(),
    };
  }

  return mejor;
}

export function subtotalDeItems(items: CartItemStore[]): number {
  return items.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
}

export function calcularTotalesPedido({
  items,
  promociones,
  opcionPago,
  costoEnvio = 0,
  configEnvio,
  destinoEnvio,
}: {
  items: CartItemStore[];
  /** Las promociones activas del negocio, sin filtrar. */
  promociones: PromocionDB[];
  /** El tipo de pago elegido en el paso 2. Null hasta que se elige. */
  opcionPago: OpcionPagoPublica | null;
  /** Solo el envío con costo CONOCIDO (localidad del negocio). */
  costoEnvio?: number;
  configEnvio?: ConfigEnvioGratis | null;
  destinoEnvio?: "LOCAL" | "LEJOS" | null;
}): TotalesPedido {
  const subtotal = subtotalDeItems(items);

  const elegibles = getPromocionesElegibles({
    promociones,
    pagos: [],
    items,
    metodosPago: [],
    canal: "PUBLICO",
    tipoPagoSeleccionado: opcionPago?.tipo ?? null,
  });

  const { calculablesAplicadas, totalDescuento } =
    calcularDescuentoCarritoPublico({
      promocionesElegibles: elegibles,
      totalCarrito: subtotal,
      items,
      tipoPagoElegido: opcionPago?.tipo ?? null,
    });

  // SIN MÉTODO ELEGIDO NO SE MUESTRA NINGÚN DESCUENTO, ni siquiera el de una
  // promo general que aplica igual. Es deliberado: el paso 2 promete que el
  // total es el de verdad, y un total que baja al elegir efectivo enseña a
  // desconfiar del que estaba antes. Mientras no haya método, el pie muestra
  // lo único que se sabe con certeza.
  const hayMetodo = opcionPago !== null;
  const descuentoMonto = hayMetodo ? totalDescuento : 0;
  const base = subtotal - descuentoMonto;

  const recargoPorcentaje = opcionPago?.recargoPorcentaje ?? 0;
  const recargoMonto = calcularRecargoMonto(base, recargoPorcentaje);
  const gratis = progresoEnvioGratis({ items, base, config: configEnvio }).alcanzado &&
    !!destinoEnvio && (destinoEnvio === "LOCAL" || configEnvio?.envio_gratis_alcance === "TODOS");
  const envioMonto = gratis ? 0 : costoEnvio;
  let disponible = descuentoMonto;
  const descuentosPorPromocion = hayMetodo ? calculablesAplicadas.map(promo => {
    const monto = Math.min(disponible, calcularDescuentoPromocion({ promo, lineas: items, categorias: promo.promociones_categorias?.map(c => c.categoria_nombre.toLowerCase()) ?? [] }));
    disponible -= monto;
    return { id: promo.id, monto };
  }) : [];

  return {
    descuentosPorPromocion,
    subtotal,
    descuento:
      descuentoMonto > 0
        ? {
            etiqueta: calculablesAplicadas.length === 1 && calculablesAplicadas[0].codigo ? `Cupón ${calculablesAplicadas[0].codigo}` : `Descuento ${opcionPago!.etiqueta.toLowerCase()}`,
            monto: descuentoMonto,
          }
        : null,
    recargo:
      recargoMonto > 0
        ? {
            etiqueta: `Recargo ${opcionPago!.etiqueta.toLowerCase()} (${recargoPorcentaje}%)`,
            monto: recargoMonto,
          }
        : null,
    envio: gratis ? { etiqueta: "Envío gratis", monto: 0 } : costoEnvio > 0 ? { etiqueta: "Envío", monto: costoEnvio } : null,
    total: base + recargoMonto + envioMonto,
    promosAplicadas: hayMetodo ? calculablesAplicadas : [],
  };
}
