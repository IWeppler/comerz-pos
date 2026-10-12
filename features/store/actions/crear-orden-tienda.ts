"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import { createPublicClient } from "@/shared/config/supabase/server";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { COLUMNAS_PROMOCION_PUBLICA } from "@/shared/lib/columnas-publicas";
import { HEADER_NEGOCIO_SLUG } from "@/shared/lib/negocio-slug";
import { slugify } from "@/shared/utils/slugify";
import {
  MENSAJE_SIN_PAGO_ONLINE,
  normalizarCelular,
  resolverRenglonesOrden,
  totalesDelServer,
  type ConfigEnvioOrden,
  type MedioOnline,
  type OpcionesCobroOnline,
  type ProductoDb,
  type VarianteDb,
} from "../lib/orden-tienda";
import { CHECKOUT_MP_DISPONIBLE } from "../lib/checkout-mp-disponible";
import { iniciarCheckoutOrden, tokenDelComercio } from "@/features/cobros-online/lib/checkout-mp-servidor";

/**
 * "Confirmar pedido" con pago online: crea la orden en Comerz y aparta el
 * stock.
 *
 * Es un endpoint PÚBLICO (el catálogo es anónimo): cualquiera puede llamarlo
 * con un curl. Por eso:
 *   - precios, categoría, promos, cupón y envío se leen de la BASE y el total
 *     se recalcula con la misma función que el carrito; si no coincide con el
 *     que vio la clienta, NO se crea y se le muestra el nuevo;
 *   - el total que llega del navegador nunca se guarda: solo se compara;
 *   - la RPC (`crear_orden_tienda`) es solo de service_role, vuelve a validar
 *     pertenencia, medio y stock, y tiene topes por IP y por celular;
 *   - un campo trampa (`sitio`) que una persona no ve y un bot llena.
 */

export interface EntradaOrdenTienda {
  /** Id generado por el navegador UNA vez por intento: si la respuesta se
   * pierde y se reintenta, vuelve la misma orden (no se aparta stock dos veces). */
  idOrden: string;
  items: CartItemStore[];
  medio: MedioOnline;
  nombre: string;
  celular: string;
  modalidad: "RETIRO" | "ENVIO";
  localidad: string;
  direccion: string;
  nota: string;
  cupon: string | null;
  /** El total que la clienta tenía en pantalla. Solo se compara. */
  totalVisto: number;
  /** Campo trampa: vacío siempre para una persona. */
  sitio?: string;
}

export interface OrdenCreada {
  numero: number;
  token: string;
  total: number;
  venceEn: string;
  medio: MedioOnline;
  alias: string | null;
  titular: string | null;
  /** Checkout de MP: a dónde mandar a la clienta. Null si no se pudo abrir
   * (la orden quedó creada y se puede pagar desde su página). */
  initPoint: string | null;
}

export type ResultadoOrdenTienda =
  | { ok: true; orden: OrdenCreada }
  | { ok: false; error: string; totalNuevo?: number };

const ERROR_GENERICO = "No pudimos crear tu orden. Probá de nuevo en un rato.";

const MENSAJES_RPC: Record<string, string> = {
  SIN_STOCK: "Se agotó un producto de tu pedido mientras comprabas",
  MEDIO_NO_DISPONIBLE: "Ese medio de pago ya no está disponible. Elegí otro.",
  COBROS_ONLINE_APAGADOS: "Esta tienda no está tomando pagos online ahora. Mandá tu pedido por WhatsApp.",
  TIENDA_NO_DISPONIBLE: "Esta tienda no está disponible.",
  DEMASIADAS_ORDENES: "Hiciste muchas órdenes seguidas. Esperá un rato y probá de nuevo.",
  DEMASIADAS_PENDIENTES:
    "Ya tenés órdenes esperando pago con este celular. Pagá esas o esperá a que venzan.",
  RENGLON_INVALIDO: "Algún producto de tu pedido cambió. Revisá el carrito y probá de nuevo.",
  TOTALES_NO_CUADRAN: ERROR_GENERICO,
  ORDEN_SIN_RENGLONES: "Tu carrito está vacío.",
};

function ipHash(valor: string | null, negocioId: string): string | null {
  const ip = valor?.split(",")[0]?.trim();
  if (!ip) return null;
  return createHash("sha256").update(`${negocioId}|${ip}`).digest("hex");
}

export async function crearOrdenTiendaAction(
  entrada: EntradaOrdenTienda,
): Promise<ResultadoOrdenTienda> {
  if (entrada.sitio) return { ok: false, error: ERROR_GENERICO };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entrada.idOrden ?? "")) {
    return { ok: false, error: ERROR_GENERICO };
  }

  // ─── Lo que tipeó la clienta ───
  const nombre = (entrada.nombre ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 1 || nombre.length > 120) return { ok: false, error: "Completá tu nombre." };
  const celular = normalizarCelular(entrada.celular ?? "");
  if (!celular) {
    return { ok: false, error: "Revisá tu celular: código de área y número, sin 0 ni 15." };
  }
  if (entrada.modalidad !== "RETIRO" && entrada.modalidad !== "ENVIO") return { ok: false, error: ERROR_GENERICO };
  const localidad = (entrada.localidad ?? "").trim().slice(0, 120);
  const direccion = (entrada.direccion ?? "").trim().slice(0, 200);
  if (entrada.modalidad === "ENVIO" && (!localidad || !direccion)) {
    return { ok: false, error: "Completá la localidad y la dirección de envío." };
  }
  const medio = entrada.medio;
  if (!["TRANSFERENCIA", "MP_CHECKOUT", "MP_CREDITO"].includes(medio)) return { ok: false, error: ERROR_GENERICO };
  if (medio !== "TRANSFERENCIA" && !CHECKOUT_MP_DISPONIBLE) {
    return { ok: false, error: MENSAJES_RPC.MEDIO_NO_DISPONIBLE };
  }
  const items = Array.isArray(entrada.items) ? entrada.items : [];
  if (items.length < 1 || items.length > 50) return { ok: false, error: MENSAJES_RPC.ORDEN_SIN_RENGLONES };

  // ─── El negocio: el del slug que puso el middleware ───
  const headerStore = await headers();
  const slug = headerStore.get(HEADER_NEGOCIO_SLUG);
  if (!slug) return { ok: false, error: MENSAJES_RPC.TIENDA_NO_DISPONIBLE };
  const supabase = await createPublicClient();

  const productoIds = [...new Set(items.map((i) => i.productoId))];
  const varianteIds = [...new Set(items.map((i) => i.varianteId).filter((v): v is string => !!v))];

  const [negocioRes, productosRes, variantesRes, promosRes, configRes, opcionesRes, cuponRes] =
    await Promise.all([
      supabase.from("negocios").select("id").eq("slug", slug).maybeSingle(),
      supabase
        .from("productos")
        .select("id, nombre, precio, precios_por_cantidad, unidad_medida, tipo")
        .in("id", productoIds),
      varianteIds.length
        ? supabase.from("producto_variantes").select("id, producto_id, precio, nombre_display").in("id", varianteIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("promociones")
        .select(`${COLUMNAS_PROMOCION_PUBLICA}, promociones_metodos_pago ( metodo_pago ), promociones_categorias ( categoria_nombre )`)
        .eq("activa", true),
      supabase
        .from("configuracion_pos")
        .select("envio_costo_local, envio_gratis_desde_monto, envio_gratis_desde_unidades, envio_gratis_alcance, localidad_negocio")
        .maybeSingle(),
      supabase.rpc("opciones_cobro_online"),
      entrada.cupon ? supabase.rpc("validar_cupon_catalogo", { p_codigo: entrada.cupon }) : Promise.resolve({ data: null, error: null }),
    ]);

  const negocioId = negocioRes.data?.id as string | undefined;
  if (!negocioId) return { ok: false, error: MENSAJES_RPC.TIENDA_NO_DISPONIBLE };
  if (productosRes.error || variantesRes.error || promosRes.error || configRes.error || opcionesRes.error) {
    console.error("[ORDEN TIENDA] lectura", {
      productos: productosRes.error?.code,
      variantes: variantesRes.error?.code,
      promos: promosRes.error?.code,
      config: configRes.error?.code,
      opciones: opcionesRes.error?.code,
    });
    return { ok: false, error: ERROR_GENERICO };
  }

  const opciones = (opcionesRes.data ?? {}) as Partial<OpcionesCobroOnline>;
  const medioPrendido = medio === "TRANSFERENCIA" ? opciones.transferencia : opciones.mercadopago;
  if (!medioPrendido) return { ok: false, error: MENSAJES_RPC.MEDIO_NO_DISPONIBLE };

  // ─── Envío: solo el local se paga online (el lejano es "a convenir") ───
  const config = (configRes.data ?? null) as (ConfigEnvioOrden & { localidad_negocio?: string | null }) | null;
  if (entrada.modalidad === "ENVIO") {
    const local = (config?.localidad_negocio ?? "").trim();
    if (!local || slugify(localidad) !== slugify(local)) {
      return { ok: false, error: MENSAJE_SIN_PAGO_ONLINE.ENVIO_A_CONVENIR };
    }
  }

  // ─── Precios y total desde la base ───
  const resuelto = resolverRenglonesOrden({
    items,
    productos: (productosRes.data ?? []) as ProductoDb[],
    variantes: (variantesRes.data ?? []) as VarianteDb[],
  });
  if (!resuelto.ok) {
    const e = resuelto.error;
    if (e.codigo === "NO_ONLINE") return { ok: false, error: MENSAJE_SIN_PAGO_ONLINE[e.motivo] };
    if (e.codigo === "CANTIDAD_INVALIDA") return { ok: false, error: `Revisá la cantidad de "${e.nombre}".` };
    return { ok: false, error: `"${e.nombre}" ya no está disponible. Sacalo del carrito para seguir.` };
  }

  const cupon = cuponRes.data
    ? ({ ...(cuponRes.data as PromocionDB), codigo: entrada.cupon } as PromocionDB)
    : null;
  const promociones = [...((promosRes.data ?? []) as unknown as PromocionDB[]), ...(cupon ? [cupon] : [])];
  const totales = totalesDelServer({
    itemsServer: resuelto.itemsServer,
    promociones,
    medio,
    modalidad: entrada.modalidad,
    config,
  });

  // Medio peso de tolerancia por redondeos de punto flotante; cualquier
  // diferencia real (un precio que cambió, una promo que venció) frena.
  if (!Number.isFinite(Number(entrada.totalVisto)) || Math.abs(totales.total - Number(entrada.totalVisto)) > 0.5) {
    return {
      ok: false,
      error: "Algunos precios cambiaron mientras comprabas. Revisá el total nuevo y confirmá otra vez.",
      totalNuevo: totales.total,
    };
  }

  // ─── Mercado Pago: la conexión tiene que andar ANTES de apartar stock ───
  // Si el token del comercio no sirve, la clienta elige otro medio y no queda
  // una orden colgada reteniendo mercadería. `tokenVigente` ya marcó la
  // conexión para que el comercio vea "Reconectar" en Cobros.
  if (medio !== "TRANSFERENCIA" && !(await tokenDelComercio(negocioId))) {
    return {
      ok: false,
      error: "Mercado Pago no está disponible en esta tienda ahora. Elegí otro medio de pago.",
    };
  }

  // ─── Crear: una transacción, stock incluido ───
  const descuento = totales.descuento?.monto ?? 0;
  const recargo = totales.recargo?.monto ?? 0;
  const envio = totales.envio?.monto ?? 0;
  const { data, error } = await createAdminClient().rpc("crear_orden_tienda", {
    p_negocio: negocioId,
    p_orden: {
      id: entrada.idOrden,
      medio,
      cliente_nombre: nombre,
      cliente_telefono: celular,
      modalidad_entrega: entrada.modalidad,
      localidad: entrada.modalidad === "ENVIO" ? localidad : null,
      direccion: entrada.modalidad === "ENVIO" ? direccion : null,
      nota: (entrada.nota ?? "").trim().slice(0, 500) || null,
      subtotal: totales.subtotal,
      descuento,
      recargo,
      envio,
      total: totales.total,
      promociones_aplicadas: totales.promosAplicadas.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        codigo: (p as PromocionDB & { codigo?: string | null }).codigo ?? null,
        monto: totales.descuentosPorPromocion?.find((d) => d.id === p.id)?.monto ?? null,
      })),
      ip_hash: ipHash(headerStore.get("x-forwarded-for"), negocioId),
    },
    p_items: resuelto.renglones,
  });

  if (error) {
    const codigo = error.message?.trim();
    if (codigo === "SIN_STOCK") {
      const cual = error.details ? ` ("${error.details}")` : "";
      return { ok: false, error: `${MENSAJES_RPC.SIN_STOCK}${cual}. Sacalo o bajá la cantidad.` };
    }
    if (codigo && MENSAJES_RPC[codigo]) return { ok: false, error: MENSAJES_RPC[codigo] };
    console.error("[ORDEN TIENDA] rpc", error.code, error.message);
    return { ok: false, error: ERROR_GENERICO };
  }

  const fila = data as {
    id: string;
    numero: number;
    token_publico: string;
    total: number;
    vence_en: string;
    alias: string | null;
    titular: string | null;
  };
  // Checkout: la preference se crea con la orden ya creada (necesita su id
  // como referencia). Si falla, la orden queda y se paga desde su página.
  const checkout = medio === "TRANSFERENCIA" ? null : await iniciarCheckoutOrden(negocioId, fila.id);

  return {
    ok: true,
    orden: {
      initPoint: checkout?.ok ? checkout.initPoint : null,
      numero: fila.numero,
      token: fila.token_publico,
      total: Number(fila.total),
      venceEn: fila.vence_en,
      medio,
      alias: fila.alias,
      titular: fila.titular,
    },
  };
}
