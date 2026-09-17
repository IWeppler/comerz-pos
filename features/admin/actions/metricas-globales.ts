"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { MetricasGlobalesCrudas } from "@/features/admin/lib/metricas-globales";

/**
 * Los hechos crudos de todo el SaaS, en UNA llamada.
 *
 * La RPC cuenta del lado de la base y devuelve números (ver la migración
 * `20260917150000`): traer las ventas de los 11 negocios para sumarlas acá
 * sería bajar el historial entero en cada carga. Los porcentajes y qué se
 * excluye se deciden en `metricas-globales.ts`, con tests.
 *
 * `null` si no hay permiso o falla: la página muestra el aviso en vez de un
 * tablero en cero, que se leería como "no hay ventas".
 */
export async function getMetricasGlobalesAction(): Promise<MetricasGlobalesCrudas | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("metricas_globales_comerz");

  if (error || !data) {
    console.error("[METRICAS GLOBALES]", error);
    return null;
  }

  const crudo = data as Record<string, unknown>;
  const numero = (v: unknown) => Number(v ?? 0);

  return {
    negocios: ((crudo.negocios as Record<string, unknown>[]) ?? []).map((n) => ({
      id: n.id as string,
      nombre: n.nombre as string,
      estado: n.estado as string,
      created_at: n.created_at as string,
      plan_id: (n.plan_id as string | null) ?? null,
      plan_nombre: (n.plan_nombre as string | null) ?? null,
      plan_precio: numero(n.plan_precio),
      rubro: (n.rubro as string | null) ?? null,
      usuarios: numero(n.usuarios),
      productos: numero(n.productos),
      ventas: numero(n.ventas),
      facturado: numero(n.facturado),
      ventas_30d: numero(n.ventas_30d),
      facturado_30d: numero(n.facturado_30d),
      ultima_venta: (n.ultima_venta as string | null) ?? null,
    })),
    planes: ((crudo.planes as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      nombre: p.nombre as string,
      precio_mensual: numero(p.precio_mensual),
    })),
    usuarios: {
      total: numero((crudo.usuarios as Record<string, unknown>)?.total),
      activos_7d: numero((crudo.usuarios as Record<string, unknown>)?.activos_7d),
      activos_30d: numero((crudo.usuarios as Record<string, unknown>)?.activos_30d),
      por_rol: Object.fromEntries(
        Object.entries(
          ((crudo.usuarios as Record<string, unknown>)?.por_rol as Record<string, unknown>) ?? {},
        ).map(([rol, n]) => [rol, numero(n)]),
      ),
    },
    catalogo: {
      productos: numero((crudo.catalogo as Record<string, unknown>)?.productos),
      variantes: numero((crudo.catalogo as Record<string, unknown>)?.variantes),
      clientes: numero((crudo.catalogo as Record<string, unknown>)?.clientes),
      deuda_cc_viva: numero((crudo.catalogo as Record<string, unknown>)?.deuda_cc_viva),
    },
    ventas_por_mes: ((crudo.ventas_por_mes as Record<string, unknown>[]) ?? []).map((m) => ({
      mes: m.mes as string,
      ventas: numero(m.ventas),
      facturado: numero(m.facturado),
    })),
    generado_en: crudo.generado_en as string,
  };
}
