"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type {
  NegocioPedidosCrudo,
  PedidosCatalogoCrudos,
} from "@/features/admin/lib/pedidos-catalogo";

/**
 * Los pedidos del catálogo de todos los comercios, en UNA llamada (la RPC
 * cuenta del lado de la base). `null` si no hay permiso o falla: la página
 * muestra el aviso en vez de un tablero en cero, que se leería como "nadie
 * pide por el catálogo".
 */
export async function getPedidosCatalogoAction(): Promise<PedidosCatalogoCrudos | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("metricas_pedidos_catalogo");
  if (error || !data) {
    console.error("[PEDIDOS CATALOGO]", error);
    return null;
  }

  const crudo = data as Record<string, unknown>;
  const numero = (v: unknown) => Number(v ?? 0);
  const conteo = (v: unknown) =>
    Object.fromEntries(
      Object.entries((v as Record<string, unknown>) ?? {}).map(([k, n]) => [k, numero(n)]),
    );

  return {
    medicion_desde: (crudo.medicion_desde as string | null) ?? null,
    negocios: ((crudo.negocios as Record<string, unknown>[]) ?? []).map(
      (n): NegocioPedidosCrudo => ({
        id: n.id as string,
        nombre: n.nombre as string,
        estado: n.estado as string,
        rubro: (n.rubro as string | null) ?? null,
        catalogo_activo: n.catalogo_activo !== false,
        pedidos_whatsapp: n.pedidos_whatsapp !== false,
        publicados: numero(n.publicados),
        pedidos: numero(n.pedidos),
        pedidos_7d: numero(n.pedidos_7d),
        pedidos_30d: numero(n.pedidos_30d),
        monto_30d: numero(n.monto_30d),
        ultimo_pedido: (n.ultimo_pedido as string | null) ?? null,
        ventas_30d: numero(n.ventas_30d),
        marketing: Object.fromEntries(Object.entries((n.marketing as Record<string, Record<string, unknown>>) ?? {}).map(([clave, d]) => [clave, { pedidos: numero(d.pedidos), monto: numero(d.monto), con_beneficio: numero(d.con_beneficio), monto_beneficio: numero(d.monto_beneficio) }])),
      }),
    ),
    por_dia: ((crudo.por_dia as Record<string, unknown>[]) ?? []).map((d) => ({
      dia: d.dia as string,
      pedidos: numero(d.pedidos),
      monto: numero(d.monto),
    })),
    por_modalidad: conteo(crudo.por_modalidad),
    por_pago: conteo(crudo.por_pago),
    generado_en: crudo.generado_en as string,
  };
}
