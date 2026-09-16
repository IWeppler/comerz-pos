"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { FEATURES, tieneFeatureServer } from "@/features/planes/lib/tiene-feature-server";
import type { CartItemStore } from "@/entities/cart/types";

/**
 * Pedidos por cobrar: el carrito viaja del punto de venta a la caja.
 *
 * Lo que se guarda es el carrito tal cual (snapshot): la caja lo vuelve a
 * cargar y cobra por `registrarVentaAction`, que revalida precios y stock
 * como con cualquier venta. Por eso acá no se valida nada de plata — no es
 * la fuente de verdad de nada, es un papel con un número.
 */

export interface PedidoItem {
  productoId: string;
  nombre: string;
  tipo: string;
  variante: string;
  varianteId?: string;
  precio: number;
  precioBase?: number;
  cantidad: number;
  unidadMedida?: string | null;
  imagenUrl?: string | null;
}

/**
 * El paso de cobro tal como lo dejó la vendedora. La caja lo abre así, en el
 * paso de pago, y solo cobra. Todo opcional: un pedido viejo o mandado desde
 * el paso de productos viene sin nada y la caja arranca como siempre.
 */
export interface PedidoContexto {
  isCuentaCorriente?: boolean;
  ccSinRecargo?: boolean;
  cliente?: {
    id: string;
    nombre: string;
    telefono?: string | null;
    exceptuado_entrega_minima?: boolean;
    lista_precio_id?: string | null;
  } | null;
  pagos?: { metodoPagoId: string; montoAsignado: number }[];
  modoMixto?: boolean;
  promocionId?: string | null;
  listaPrecioId?: string | null;
  /** null = el default del comercio. */
  facturar?: boolean | null;
}

export interface PedidoPorCobrar {
  id: string;
  numero: number;
  dia: string;
  estado: string;
  vendedor_id: string;
  vendedor_nombre: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  items: PedidoItem[];
  total_estimado: number;
  nota: string | null;
  creado_en: string;
  contexto: PedidoContexto | null;
}

/** Lo que del carrito vale la pena guardar. `stockMaximo` y `reservaIds` no:
 * son del dispositivo que armó el pedido, no del pedido. */
function aItemPedido(i: CartItemStore): PedidoItem {
  return {
    productoId: i.productoId,
    nombre: i.nombre,
    tipo: i.tipo,
    variante: i.variante,
    varianteId: i.varianteId,
    precio: i.precio,
    precioBase: i.precioBase,
    cantidad: i.cantidad,
    unidadMedida: i.unidadMedida ?? null,
    imagenUrl: i.imagenUrl ?? null,
  };
}

export async function crearPedidoAction(datos: {
  items: CartItemStore[];
  clienteId?: string | null;
  nota?: string | null;
  contexto?: PedidoContexto | null;
}): Promise<
  { success: true; numero: number; id: string } | { success: false; error: string }
> {
  if (!datos.items?.length) {
    return { success: false, error: "El carrito está vacío." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: config } = await supabase
    .from("configuracion_pos")
    .select("pedidos_a_caja")
    .single();
  if (!config?.pedidos_a_caja) {
    return {
      success: false,
      error: "Enviar a caja no está activado en este comercio (Configuración → Empleados).",
    };
  }
  if (!(await tieneFeatureServer(supabase, FEATURES.PEDIDOS_A_CAJA))) {
    return { success: false, error: "Tu plan no incluye pedidos a caja." };
  }

  const items = datos.items.map(aItemPedido);
  const total = items.reduce((acc, i) => acc + i.precio * i.cantidad, 0);

  const { data, error } = await supabase.rpc("crear_pedido", {
    p_items: items,
    p_cliente_id: datos.clienteId || null,
    p_total_estimado: Math.round(total * 100) / 100,
    p_nota: datos.nota ?? null,
    p_contexto: datos.contexto ?? null,
  });

  if (error || !data) {
    console.error("[PEDIDOS] No se pudo crear el pedido:", error);
    return { success: false, error: "No se pudo enviar el pedido a la caja." };
  }

  const r = data as { id: string; numero: number };
  return { success: true, numero: r.numero, id: r.id };
}

/**
 * La lista que ve la caja. Desde el 16/9/2026 ya no se pollea cada 15 s: la
 * llama React Query cuando llega la señal de Realtime (ver
 * `use-pedidos-realtime.ts`) y, como red, cada 90 s.
 *
 * PENDIENTE, documentado y no hecho: esta lectura podría ir directo desde el
 * navegador con supabase-js —el cliente de `client.ts` ya manda
 * `x-negocio-activo`, así que la RLS de `pedidos` resolvería igual— y ahí
 * costaría CERO invocaciones de Vercel. No se hizo todavía porque el select
 * embebe `perfiles` y `clientes`, y las policies de esas dos tablas se
 * escribieron pensando en el server (`perfiles` en particular: qué nombres de
 * otros usuarios puede leer una vendedora desde el navegador es una decisión
 * que hay que tomar mirando esa policy, no heredarla por accidente). Con la
 * señal por Realtime la cantidad de llamadas ya bajó ~10×; el resto es una
 * mejora, no una urgencia.
 */
export async function listarPedidosPorCobrarAction(): Promise<{
  data: PedidoPorCobrar[];
  error: string | null;
}> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("pedidos")
    .select(
      "id, numero, dia, estado, vendedor_id, cliente_id, items, total_estimado, nota, contexto, creado_en, perfiles!pedidos_vendedor_id_fkey(nombre), clientes(nombre)",
    )
    .eq("estado", "POR_COBRAR")
    .order("creado_en", { ascending: true });

  if (error) {
    console.error("[PEDIDOS] No se pudieron listar:", error);
    return { data: [], error: "No se pudieron cargar los pedidos por cobrar." };
  }

  const rel = (v: unknown): { nombre: string } | null => {
    const x = Array.isArray(v) ? v[0] : v;
    return (x as { nombre: string } | null) ?? null;
  };

  return {
    error: null,
    data: (data ?? []).map((p) => ({
      id: p.id,
      numero: p.numero,
      dia: p.dia,
      estado: p.estado,
      vendedor_id: p.vendedor_id,
      vendedor_nombre: rel(p.perfiles)?.nombre ?? null,
      cliente_id: p.cliente_id,
      cliente_nombre: rel(p.clientes)?.nombre ?? null,
      items: (p.items ?? []) as PedidoItem[],
      total_estimado: Number(p.total_estimado ?? 0),
      nota: p.nota,
      creado_en: p.creado_en,
      contexto: (p.contexto ?? null) as PedidoContexto | null,
    })),
  };
}

export async function cancelarPedidoAction(
  pedidoId: string,
): Promise<{ success: boolean; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // `.select("id")`: un UPDATE que la RLS filtra devuelve 0 filas sin error.
  const { data, error } = await supabase
    .from("pedidos")
    .update({ estado: "CANCELADO", actualizado_en: new Date().toISOString() })
    .eq("id", pedidoId)
    .eq("estado", "POR_COBRAR")
    .select("id");

  if (error || !data?.length) {
    return {
      success: false,
      error: "No se pudo cancelar: ya fue cobrado, o no es tuyo.",
    };
  }
  return { success: true, error: null };
}

/** Si esta persona puede cobrar (confirmar ventas). Solo decide qué mostrar;
 * la puerta real está en `registrarVentaAction`. */
export async function puedeCobrarAction(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  return tienePermiso(supabase, PERMISOS.VENTAS_COBRAR);
}
