"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { ReglasPlan } from "@/shared/lib/planes";

export interface PlanMinimo {
  nombre: string;
  precio_mensual: number;
  /** Las reglas COMPLETAS del plan destino, no solo su nombre y precio.
   *
   * Van acá porque el paywall arma con ellas lo que se gana al subir, y esa
   * lista tiene que salir de la base y no de un texto escrito a mano: un
   * beneficio redactado aparte se desactualiza en silencio. Pasó — el modal
   * decía "cuenta corriente sin límites" para el plan Gestión, que en realidad
   * tiene 250 clientes. La ilimitada es de Empresa. */
  reglas: ReglasPlan;
}

export interface ContextoPlan {
  /** Nombre del plan del negocio activo. Null si todavía no tiene uno. */
  planActual: string | null;
  /** Features habilitadas hoy. */
  features: string[];
  /**
   * Para cada feature, el plan MÁS BARATO que la incluye. Es lo que el paywall
   * necesita para decir "necesitás el plan X" sin hardcodear la escalera de
   * planes en el frontend.
   */
  planMinimoPorFeature: Record<string, PlanMinimo>;
  /**
   * Sin plan asignado no se bloquea nada (mismo criterio que en la base): los
   * comercios que ya venían trabajando no tienen plan cargado.
   */
  sinPlan: boolean;
  /** Reglas del plan de HOY. El paywall las compara contra las del plan
   * destino para decir "hasta 5 usuarios" en vez de "más usuarios". */
  reglasActuales: ReglasPlan;
  /**
   * El negocio está en prueba gratis (`estado = 'prueba'`, "todavía no pagó
   * nunca") y la prueba tiene fecha de fin. Null para todos los demás,
   * incluido `demo`, que no vence. Viaja en la misma consulta del negocio que
   * ya hacía este action: la barra de prueba no le cuesta un viaje a nadie.
   */
  prueba: { inicio: string; vencimiento: string } | null;
}

export async function getContextoPlanAction(): Promise<ContextoPlan> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: negocioId } = await supabase.rpc("negocio_actual");

  // Las reglas EFECTIVAS salen del RPC `reglas_plan()`, que aplica
  // `negocios.reglas_override` sobre las del plan. Leer `planes.reglas` derecho
  // ignoraría el grandfathering: a los comercios que conservan 75 clientes de
  // cuenta corriente les mostraría el 50 del plan nuevo, y el medidor diría que
  // están llenos cuando la base los deja seguir.
  const [{ data: negocio }, { data: reglasEfectivas }, { data: planes }] =
    await Promise.all([
      negocioId
        ? supabase
            .from("negocios")
            .select("plan_id, estado, plan_vencimiento, created_at, planes(nombre)")
            .eq("id", negocioId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc("reglas_plan"),
      // Estas SÍ son las del plan puro: es el catálogo comercial, lo que se
      // ofrece al subir. Un override es una excepción de un negocio, no algo
      // que se le pueda prometer a otro.
      supabase
        .from("planes")
        .select("nombre, precio_mensual, reglas")
        .eq("activo", true)
        .order("precio_mensual", { ascending: true }),
    ]);

  const planActivo = Array.isArray(negocio?.planes)
    ? negocio?.planes[0]
    : negocio?.planes;

  const reglas = (reglasEfectivas ?? {}) as ReglasPlan;

  // Los planes vienen del más barato al más caro, así que el primero que
  // incluye una feature es el mínimo necesario.
  const planMinimoPorFeature: Record<string, PlanMinimo> = {};
  for (const plan of planes ?? []) {
    const reglasPlan = (plan.reglas ?? {}) as ReglasPlan;
    for (const feature of reglasPlan.features ?? []) {
      if (planMinimoPorFeature[feature]) continue;
      planMinimoPorFeature[feature] = {
        nombre: plan.nombre as string,
        precio_mensual: Number(plan.precio_mensual ?? 0),
        reglas: reglasPlan,
      };
    }
  }

  return {
    planActual: (planActivo?.nombre as string | undefined) ?? null,
    features: reglas.features ?? [],
    planMinimoPorFeature,
    sinPlan: !negocio?.plan_id,
    reglasActuales: reglas,
    prueba:
      negocio?.estado === "prueba" && negocio.plan_vencimiento
        ? {
            inicio: negocio.created_at as string,
            vencimiento: negocio.plan_vencimiento as string,
          }
        : null,
  };
}
