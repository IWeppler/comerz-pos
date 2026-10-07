import { CartItemStore } from "@/entities/cart/types";
import { CreateSalePaymentInput } from "@/entities/ventas/types";
import { MetodoPago, TipoMetodo } from "@/entities/payments/types";
import { DescuentoDetalle, PromocionDB } from "./types";
import type { TotalesPedido } from "@/shared/lib/totales-pedido-publico";
import {
  calcularDescuentoPromocion,
  promocionAplica,
  promocionVigente,
  TIPOS_REGLA_CONOCIDOS,
} from "@/shared/lib/descuento-promocion";

export type CanalVenta = "PUBLICO" | "POS";

interface PromocionesElegiblesParams {
  promociones: PromocionDB[];
  pagos: CreateSalePaymentInput[];
  items: CartItemStore[];
  metodosPago: MetodoPago[];
  /** Default "POS": preserva el comportamiento histórico para el admin. */
  canal?: CanalVenta;
  /**
   * Canal PUBLICO: qué TIPO de pago eligió la clienta en el paso 2.
   *
   * Antes el carrito público no tenía este dato —el medio se resolvía después
   * por WhatsApp— y las promos por método pasaban como elegibles SIEMPRE, para
   * poder mostrarlas como aviso. Ahora que se elige antes de enviar, una promo
   * por método es elegible o no según el tipo, igual que en el POS.
   *
   * Sin tipo elegido NO son elegibles: un descuento por pagar en efectivo no
   * se puede dar por hecho cuando todavía no se sabe cómo se paga, y un total
   * que lo incluya de prepo es un total que después sube.
   */
  tipoPagoSeleccionado?: TipoMetodo | null;
}

export function getPromocionesElegibles({
  promociones,
  pagos,
  items,
  metodosPago,
  canal = "POS",
  tipoPagoSeleccionado = null,
}: PromocionesElegiblesParams) {
  const ahora = new Date();

  return promociones.filter((promo) => {
    // Vigencia (activa, fechas, límite de usos) y condición (tipo_regla,
    // monto mínimo) salen del módulo COMPARTIDO con el server: si acá se
    // decidiera distinto que en `create-sale.ts`, la pantalla ofrecería un
    // descuento que la venta después no da. Ver `descuento-promocion.ts`.
    if (!promocionVigente(promo, ahora)) return false;

    // Lo único propio del canal: la vidriera solo muestra lo que el comercio
    // decidió publicar. No es una condición de la promo, es de la superficie.
    if (canal === "PUBLICO" && !promo.mostrar_en_catalogo) return false;

    if (!TIPOS_REGLA_CONOCIDOS.has(promo.tipo_regla)) {
      console.warn(
        `[promociones] tipo_regla desconocido: "${promo.tipo_regla}" en la promoción "${promo.nombre}" (id: ${promo.id}) — se descarta por seguridad.`,
      );
      return false;
    }

    return promocionAplica({
      promo,
      lineas: items,
      categorias: categoriasDe(promo),
      // El catálogo público elige UN tipo de pago; el POS puede tener varios
      // cobros en el mismo ticket. En los dos casos la promo por método exige
      // que TODOS sean de un método incluido, así que la diferencia es solo
      // cómo se arma la lista.
      tiposDePago:
        canal === "PUBLICO"
          ? tipoPagoSeleccionado
            ? [tipoPagoSeleccionado]
            : []
          : pagos.map(
              (p) => metodosPago.find((m) => m.id === p.metodoPagoId)?.tipo,
            ),
      metodosDeLaPromo:
        promo.promociones_metodos_pago?.map((m) => m.metodo_pago) ?? [],
    });
  });
}

/** Las categorías de una promo, normalizadas una sola vez y en un solo lugar. */
const categoriasDe = (promo: PromocionDB): string[] =>
  promo.promociones_categorias?.map((c) => c.categoria_nombre.toLowerCase()) ??
  [];

export function getPromocionActivaId(
  promocionId: string,
  promocionesElegibles: PromocionDB[],
) {
  if (promocionId === "ninguna") return "ninguna";

  return promocionesElegibles.some((promo) => promo.id === promocionId)
    ? promocionId
    : "ninguna";
}

/**
 * El monto que descuenta una promo sobre este carrito.
 *
 * Es una envoltura fina sobre `descuento-promocion.ts` a propósito: el cálculo
 * TIENE que ser el mismo que corre en `create-sale.ts`, porque desde el
 * 8/9/2026 el server lo recalcula y rechaza la venta si el cliente pide de
 * más. Si esta función volviera a tener aritmética propia, cualquier
 * diferencia de un peso frenaría ventas en el mostrador.
 */
function calcularDescuentoPromo(
  promo: PromocionDB,
  items: CartItemStore[],
): number {
  return calcularDescuentoPromocion({
    promo,
    lineas: items,
    categorias: categoriasDe(promo),
  });
}

export function getDescuentoDetalle({
  promocionActivaId,
  promocionesElegibles,
  items,
}: {
  promocionActivaId: string;
  promocionesElegibles: PromocionDB[];
  items: CartItemStore[];
}): DescuentoDetalle {
  if (promocionActivaId === "ninguna") return { monto: 0, nombre: "" };

  const promo = promocionesElegibles.find(
    (item) => item.id === promocionActivaId,
  );
  if (!promo) return { monto: 0, nombre: "" };

  return {
    monto: calcularDescuentoPromo(promo, items),
    nombre: promo.nombre,
  };
}

export interface DescuentoCarritoPublico {
  /** Promos que ya restan del total mostrado: todo menos METODO_PAGO. */
  calculablesAplicadas: PromocionDB[];
  /** METODO_PAGO: depende de un dato que este checkout no tiene (cómo paga), queda como aviso aparte. */
  informativasCondicionales: PromocionDB[];
  totalDescuento: number;
  totalConDescuento: number;
}

/**
 * Entre las calculables, "acumulable" decide si se suman todas (true) o si
 * compiten por una sola (false: gana la de mayor descuento en pesos;
 * empate exacto lo resuelve "prioridad", mayor gana).
 */
export function calcularDescuentoCarritoPublico({
  promocionesElegibles,
  totalCarrito,
  items,
  tipoPagoElegido = null,
}: {
  promocionesElegibles: PromocionDB[];
  totalCarrito: number;
  items: CartItemStore[];
  /**
   * Con un tipo de pago elegido, las promos por método dejan de ser un aviso y
   * compiten por el descuento como cualquier otra: ya se sabe si aplican. Sin
   * tipo, `getPromocionesElegibles` ni siquiera las devuelve.
   */
  tipoPagoElegido?: TipoMetodo | null;
}): DescuentoCarritoPublico {
  const calculables = tipoPagoElegido
    ? promocionesElegibles
    : promocionesElegibles.filter((p) => p.tipo_regla !== "METODO_PAGO");
  const informativasCondicionales = tipoPagoElegido
    ? []
    : promocionesElegibles.filter((p) => p.tipo_regla === "METODO_PAGO");

  const acumulables = calculables.filter((p) => p.acumulable);
  const exclusivas = calculables.filter((p) => !p.acumulable);

  const descuentoAcumulables = acumulables.map((promo) => ({
    promo,
    descuento: calcularDescuentoPromo(promo, items),
  }));

  let mejorExclusiva: { promo: PromocionDB; descuento: number } | null = null;
  for (const promo of exclusivas) {
    const descuento = calcularDescuentoPromo(promo, items);
    if (
      !mejorExclusiva ||
      descuento > mejorExclusiva.descuento ||
      (descuento === mejorExclusiva.descuento &&
        (promo.prioridad ?? 0) > (mejorExclusiva.promo.prioridad ?? 0))
    ) {
      mejorExclusiva = { promo, descuento };
    }
  }

  const calculablesAplicadas = [
    ...descuentoAcumulables.map((d) => d.promo),
    ...(mejorExclusiva ? [mejorExclusiva.promo] : []),
  ];

  const totalDescuento = Math.min(
    totalCarrito,
    descuentoAcumulables.reduce((acc, d) => acc + d.descuento, 0) +
      (mejorExclusiva?.descuento ?? 0),
  );

  return {
    calculablesAplicadas,
    informativasCondicionales,
    totalDescuento,
    totalConDescuento: totalCarrito - totalDescuento,
  };
}

const METODO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  TARJETA: "tarjeta",
};

/**
 * Texto informativo para mostrar una promo en el carrito público (sin
 * aplicarla, solo como aviso). No usado por el admin/POS.
 */
export function formatearPromoPublica(promo: PromocionDB): string {
  const valor =
    promo.tipo_descuento === "PORCENTAJE"
      ? `${promo.valor_descuento}% OFF`
      : `$${promo.valor_descuento.toLocaleString("es-AR")} OFF`;

  switch (promo.tipo_regla) {
    case "METODO_PAGO": {
      const metodo = promo.promociones_metodos_pago?.[0]?.metodo_pago;
      const metodoLabel = metodo ? METODO_PAGO_LABEL[metodo] || metodo : "";
      return `${valor} pagando en ${metodoLabel}`;
    }
    case "CATEGORIA": {
      const categoria = promo.promociones_categorias?.[0]?.categoria_nombre;
      return `${valor} en ${categoria}`;
    }
    case "MONTO_MINIMO":
      return `${valor} a partir de $${promo.monto_minimo.toLocaleString("es-AR")}`;
    default:
      return `${valor}`;
  }
}

export function generarLinkWhatsApp({
  numeroWhatsApp,
  nombreComercio,
  items,
  total,
}: {
  numeroWhatsApp?: string;
  nombreComercio?: string | null;
  items: CartItemStore[];
  total: number;
}) {
  if (!numeroWhatsApp) return "#";

  const nombre = nombreComercio?.trim() || "el negocio";
  let mensaje = `Hola ${nombre}!\nQuiero realizar el siguiente pedido:\n\n`;

  items.forEach((item) => {
    mensaje += `${item.cantidad}x ${item.nombre} (${item.tipo})\n`;
    mensaje += ` - Talle: ${item.variante} - $${(
      item.precio * item.cantidad
    ).toLocaleString("es-AR")}\n`;
  });

  mensaje += `\nTOTAL: $${total.toLocaleString(
    "es-AR",
  )}\n\nTienen stock disponible para confirmar?`;

  return `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
}

export type ModalidadEntregaPublica = "RETIRO" | "ENVIO";

/**
 * El mensaje de WhatsApp del pedido.
 *
 * NO CALCULA NADA. Recibe los totales ya resueltos por
 * `calcularTotalesPedido` —los mismos que la clienta acaba de ver en el
 * pie— y los escribe. Antes recibía un total y tres listas de avisos, y
 * armaba con eso un texto que hablaba de descuentos "a confirmar" y recargos
 * "no incluidos": el mensaje decía una cosa y la pantalla otra, y el que
 * tenía que reconciliarlas era el comercio, a mano, por chat.
 *
 * El desglose viaja ENTERO —subtotal, descuento, recargo, envío— y no solo el
 * total, porque del otro lado hay una persona que va a cargar esa venta en el
 * POS y necesita saber de dónde sale cada peso.
 */
export function generarLinkWhatsAppPublico({
  numeroWhatsApp,
  nombreComercio,
  items,
  totales,
  etiquetaPago,
  nombreCliente,
  modalidad,
  direccion,
  localidad,
  envioACoordinar,
  nota,
}: {
  numeroWhatsApp?: string;
  nombreComercio?: string | null;
  items: CartItemStore[];
  totales: TotalesPedido;
  /** Cómo eligió pagar, con la etiqueta que vio en pantalla. */
  etiquetaPago: string;
  nombreCliente: string;
  modalidad: ModalidadEntregaPublica;
  direccion?: string;
  localidad?: string;
  /** Envío sin costo calculable: el mensaje lo dice en vez de callarlo. */
  envioACoordinar?: boolean;
  nota?: string;
}) {
  if (!numeroWhatsApp) return "#";

  const pesos = (monto: number) => `$${monto.toLocaleString("es-AR")}`;
  const nombre = nombreComercio?.trim() || "el negocio";

  let mensaje = `Hola ${nombre}!\nQuiero realizar el siguiente pedido:\n\n`;

  items.forEach((item) => {
    mensaje += `${item.cantidad}x ${item.nombre} (${item.tipo})\n`;
    mensaje += ` - Talle: ${item.variante} - ${pesos(
      item.precio * item.cantidad,
    )}\n`;
  });

  mensaje += `\nSubtotal: ${pesos(totales.subtotal)}`;
  if (totales.descuento) {
    mensaje += `\n${totales.descuento.etiqueta}: -${pesos(totales.descuento.monto)}`;
  }
  for (const promo of totales.promosAplicadas.filter(p => p.codigo)) {
    if (totales.descuento?.etiqueta === `Cupón ${promo.codigo}`) continue;
    const monto = totales.descuentosPorPromocion?.find(d => d.id === promo.id)?.monto ?? calcularDescuentoPromo(promo, items);
    mensaje += `\nIncluye cupón ${promo.codigo}: ${pesos(monto)} de descuento`;
  }
  if (totales.recargo) {
    mensaje += `\n${totales.recargo.etiqueta}: +${pesos(totales.recargo.monto)}`;
  }
  if (totales.envio) {
    mensaje += `\nEnvío: ${totales.envio.etiqueta === "Envío gratis" ? "gratis" : pesos(totales.envio.monto)}`;
  }
  mensaje += `\nTOTAL: ${pesos(totales.total)}`;

  mensaje += `\n\nNombre: ${nombreCliente}`;
  mensaje += `\nPago: ${etiquetaPago}`;

  if (modalidad === "ENVIO") {
    mensaje += `\nEntrega: Envío a domicilio`;
    mensaje += `\nLocalidad: ${localidad}`;
    mensaje += `\nDirección: ${direccion}`;
    if (envioACoordinar) {
      mensaje += `\n(costo de envío a coordinar)`;
    }
  } else {
    mensaje += `\nEntrega: Retiro en local`;
  }

  if (nota?.trim()) {
    mensaje += `\nNota: ${nota.trim()}`;
  }

  mensaje += `\n\nTienen stock disponible para confirmar?`;

  return `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
}
