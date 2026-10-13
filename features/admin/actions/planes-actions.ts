"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { Modalidad, ReglasPlan } from "@/shared/lib/planes";

export interface PlanCompleto {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual: number;
  orden: number;
  reglas: ReglasPlan;
}

export async function getPlanesCompletosAction(): Promise<PlanCompleto[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("planes")
    .select("id, nombre, descripcion, precio_mensual, orden, reglas")
    .eq("activo", true)
    .order("orden", { ascending: true });

  if (error) {
    console.error("[GET PLANES ERROR]", error);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    nombre: p.nombre as string,
    descripcion: (p.descripcion as string | null) ?? null,
    precio_mensual: Number(p.precio_mensual ?? 0),
    orden: Number(p.orden ?? 0),
    reglas: (p.reglas ?? {}) as ReglasPlan,
  }));
}

export interface PlanDelNegocio {
  negocio: string;
  plan: string | null;
  descripcion: string | null;
  precioLista: number;
  /** Lo que paga este comercio si tiene un precio acordado; null = el de lista. */
  precioAcordado: number | null;
  planId: string | null;
  modalidad: Modalidad;
  vencimiento: string | null;
  estado: string;
  reglas: ReglasPlan;
  usuariosUsados: number;
}

/**
 * Plan del negocio activo, para mostrárselo al dueño en su perfil. Devuelve
 * también cuántos usuarios tiene ocupados, que es el límite con el que se
 * choca primero.
 */
export async function getPlanDelNegocioAction(): Promise<PlanDelNegocio | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: negocioId } = await supabase.rpc("negocio_actual");
  if (!negocioId) return null;

  const [{ data: negocio }, { count }, { data: reglasEfectivas }] =
    await Promise.all([
      supabase
        .from("negocios")
        .select(
          "nombre, estado, modalidad, plan_id, precio_acordado, plan_vencimiento, planes(nombre, descripcion, precio_mensual)",
        )
        .eq("id", negocioId)
        .single(),
      supabase
        .from("usuarios_negocios")
        .select("id", { count: "exact", head: true })
        .eq("negocio_id", negocioId),
      // Las reglas que de verdad rigen para ESTE negocio, con su override
      // aplicado. Mostrar las del plan a secas le diría "50 clientes" a un
      // comercio que conserva 75 por grandfathering, y le haría reclamar un
      // límite que no tiene.
      supabase.rpc("reglas_plan"),
    ]);

  if (!negocio) return null;

  const plan = Array.isArray(negocio.planes) ? negocio.planes[0] : negocio.planes;

  return {
    negocio: negocio.nombre as string,
    plan: (plan?.nombre as string | undefined) ?? null,
    descripcion: (plan?.descripcion as string | undefined) ?? null,
    precioLista: Number(plan?.precio_mensual ?? 0),
    precioAcordado: negocio.precio_acordado === null ? null : Number(negocio.precio_acordado),
    planId: (negocio.plan_id as string | null) ?? null,
    modalidad: (negocio.modalidad as Modalidad) ?? "mensual",
    vencimiento: (negocio.plan_vencimiento as string | null) ?? null,
    estado: negocio.estado as string,
    reglas: (reglasEfectivas ?? {}) as ReglasPlan,
    usuariosUsados: count ?? 0,
  };
}
