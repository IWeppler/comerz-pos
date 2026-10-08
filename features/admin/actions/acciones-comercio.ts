"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { calcularPeriodoPago } from "@/features/admin/lib/periodo-pago";
import { createClient } from "@/shared/config/supabase/server";
import { slugify } from "@/shared/utils/slugify";
import { ESTADO_BAJA } from "@/shared/lib/estado-negocio";

/**
 * Las acciones que Comerz ejecuta sobre un comercio: cobrar, cambiar el plan,
 * darlo de baja, reactivarlo y cambiarle el link de la tienda.
 *
 * Todas pasan por RLS —`negocios_update_super_admin` y las policies de
 * `pagos_suscripcion`— así que a otro usuario no le hacen nada. El chequeo
 * explícito va igual: un server action es un endpoint.
 *
 * Ninguna registra eventos a mano: los generan los triggers de la base
 * (`trg_evento_negocio`, `trg_evento_pago`). Si el registro dependiera de que
 * cada action se acuerde, el primer camino nuevo dejaría el feed incompleto —
 * y un feed incompleto es peor que ninguno, porque se le cree.
 */

export interface ResultadoAccion {
  error: string | null;
  success: boolean;
}

async function comoSuperAdmin() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, autorizado: false };

  const { data } = await supabase.rpc("is_super_admin");
  return { supabase, user, autorizado: data === true };
}

function refrescarPanel() {
  revalidatePath("/admincomerz");
}

/**
 * Registra un cobro y mueve el vencimiento del negocio.
 *
 * QUÉ SE PIDE Y QUÉ SE DEDUCE
 *
 * Se piden tres cosas: cuánto pagó, si es mensual o semestral, y por qué medio.
 * Todo lo demás sale de ahí:
 *
 * - La FECHA es hoy. Se registra el pago cuando entra la plata, así que
 *   elegirla a mano era ofrecer equivocarse en el único dato que el sistema ya
 *   sabe con certeza.
 * - El PERÍODO se deduce de la modalidad. Antes se pedían "cubre desde" y
 *   "cubre hasta" a mano: dos fechas para expresar "un mes más", con la
 *   posibilidad de escribir un rango de 45 días sin que nada lo frenara.
 *
 * DESDE DÓNDE SE CUENTA: desde el vencimiento vigente si todavía no pasó, y
 * desde hoy si ya venció. Es lo que hace que pagar antes no cueste días — quien
 * paga el 20 con vencimiento el 30 tiene que terminar cubierto hasta el 30 del
 * mes siguiente, no hasta el 20. Y quien paga tarde arranca hoy, sin que se le
 * regalen los días de atraso.
 */
export async function registrarPagoAction(
  _prev: ResultadoAccion | null,
  formData: FormData,
): Promise<ResultadoAccion> {
  const negocioId = formData.get("negocio_id") as string;
  const monto = Number(formData.get("monto"));
  const modalidad = (formData.get("modalidad") as string) || "mensual";
  const medio = (formData.get("medio") as string) || "transferencia";
  const nota = ((formData.get("nota") as string) ?? "").trim() || null;

  if (!negocioId) return { error: "Falta el comercio.", success: false };
  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "El monto no es válido.", success: false };
  }
  if (modalidad !== "mensual" && modalidad !== "semestral") {
    return { error: "Modalidad inválida.", success: false };
  }

  const { supabase, user, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  const { data: negocio } = await supabase
    .from("negocios")
    .select("estado, plan_vencimiento, planes(nombre)")
    .eq("id", negocioId)
    .maybeSingle();

  const plan = Array.isArray(negocio?.planes)
    ? negocio?.planes[0]
    : negocio?.planes;

  const hoy = new Date().toISOString().slice(0, 10);
  const vencimientoActual = negocio?.plan_vencimiento
    ? String(negocio.plan_vencimiento).slice(0, 10)
    : null;

  const { desde, hasta } = calcularPeriodoPago({
    hoy,
    vencimientoActual,
    modalidad,
  });

  const { error: errorPago } = await supabase
    .from("pagos_suscripcion")
    .insert({
      negocio_id: negocioId,
      monto,
      fecha_pago: hoy,
      periodo_desde: desde,
      periodo_hasta: hasta,
      medio,
      plan_nombre: (plan?.nombre as string | undefined) ?? null,
      nota,
      registrado_por: user?.id ?? null,
    });

  if (errorPago) {
    console.error("[PAGO SUSCRIPCION]", errorPago);
    return { error: "No se pudo registrar el pago.", success: false };
  }

  // `prueba` es "todavía no pagó nunca" (ver `estado-negocio.ts`): el primer
  // pago lo pasa a `activo`. Antes eso no lo hacía nadie, y los comercios que
  // ya pagaban seguían en prueba —fuera del MRR y con la barra de prueba
  // avisándoles que se les terminó—. Los demás estados no se tocan: un pago de
  // un suspendido se reactiva a mano, a propósito.
  const pasaAActivo = negocio?.estado === "prueba";

  const { error: errorVenc } = await supabase
    .from("negocios")
    .update({
      plan_vencimiento: hasta,
      ...(pasaAActivo
        ? { estado: "activo", estado_cambiado_en: new Date().toISOString() }
        : {}),
    })
    .eq("id", negocioId);

  if (errorVenc) {
    // El pago YA quedó registrado: se avisa en vez de fingir que todo salió
    // bien, porque la plata entró y el vencimiento quedó viejo.
    console.error("[PAGO SUSCRIPCION] vencimiento no actualizado", errorVenc);
    return {
      error:
        "El pago quedó registrado pero no se pudo mover el vencimiento. Revisalo.",
      success: false,
    };
  }

  refrescarPanel();
  return { error: null, success: true };
}

/** Cambia el plan. El vencimiento no se toca: cambiar de plan y cobrar son dos
 * cosas distintas, y atarlas haría que corregir un plan mal asignado le regale
 * un mes a alguien. */
export async function cambiarPlanAction(
  negocioId: string,
  planId: string | null,
): Promise<ResultadoAccion> {
  const { supabase, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  const { error } = await supabase
    .from("negocios")
    .update({ plan_id: planId })
    .eq("id", negocioId);

  if (error) {
    console.error("[CAMBIAR PLAN]", error);
    return { error: "No se pudo cambiar el plan.", success: false };
  }

  refrescarPanel();
  return { error: null, success: true };
}

/**
 * Estado del comercio.
 *
 * 'suspendido' es la falta de pago: el comercio deja de entrar pero NO se
 * borra nada, así que al pagar vuelve exactamente a donde estaba. 'cancelado'
 * es que se fue. Los datos se conservan en los dos casos — perderlos por una
 * cuota impaga sería un daño irreversible por un problema temporal.
 *
 * El estado de baja se llama 'cancelado' y NO 'baja'. Esta action recibía
 * 'baja' desde el menú, que no está en el CHECK de `negocios.estado`: el
 * update fallaba SIEMPRE, y como el error se mostraba como un toast genérico
 * ("No se pudo") parecía un problema de permisos. Por eso el valor sale de
 * `ESTADO_BAJA` y no de un string escrito a mano.
 *
 * 'demo' es el comercio de muestra que abre un vendedor para enseñar el
 * producto: sigue funcionando entero, pero queda afuera de las métricas y de
 * los avisos de cobranza (ver `shared/lib/estado-negocio.ts`).
 */
export async function cambiarEstadoNegocioAction(
  negocioId: string,
  estado: "activo" | "suspendido" | "demo" | typeof ESTADO_BAJA,
): Promise<ResultadoAccion> {
  const { supabase, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  const { data, error } = await supabase
    .from("negocios")
    .update({ estado, estado_cambiado_en: new Date().toISOString() })
    .eq("id", negocioId)
    .select("id");

  if (error) {
    console.error("[CAMBIAR ESTADO]", error);
    return { error: "No se pudo cambiar el estado.", success: false };
  }
  // Un UPDATE que la RLS filtra vuelve con 0 filas y sin error.
  if (!data?.length) {
    return { error: "No se encontró el comercio.", success: false };
  }

  refrescarPanel();
  return { error: null, success: true };
}

/**
 * Mete o saca al comercio del MRR. No toca el estado: un comercio de cortesía
 * está `activo` (trabaja, sin barra de prueba) y no suma. Ver `sumaAlMrr`.
 */
export async function cambiarCuentaEnMrrAction(
  negocioId: string,
  cuentaEnMrr: boolean,
): Promise<ResultadoAccion> {
  const { supabase, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  const { data, error } = await supabase
    .from("negocios")
    .update({ cuenta_en_mrr: cuentaEnMrr })
    .eq("id", negocioId)
    .select("id");

  if (error) {
    console.error("[CUENTA EN MRR]", error);
    return { error: "No se pudo cambiar el MRR.", success: false };
  }
  if (!data?.length) {
    return { error: "No se encontró el comercio.", success: false };
  }

  refrescarPanel();
  return { error: null, success: true };
}

/**
 * Cambia el link público de la tienda.
 *
 * El slug viejo NO se pierde: el trigger `trg_evento_negocio` lo guarda en
 * `slugs_historicos` para que el link que el comercio ya compartió siga
 * entrando y redirija al nuevo. Un catálogo vive meses en chats de WhatsApp.
 */
export async function cambiarSlugAction(
  negocioId: string,
  slugCrudo: string,
): Promise<ResultadoAccion> {
  const slug = slugify(slugCrudo ?? "");

  if (slug.length < 3) {
    return { error: "El link tiene que tener al menos 3 caracteres.", success: false };
  }

  const { supabase, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  // Se avisa antes en vez de dejar que reviente el unique: el mensaje de la
  // base para esto no le dice nada a nadie.
  const { data: ocupado } = await supabase
    .from("negocios")
    .select("id")
    .eq("slug", slug)
    .neq("id", negocioId)
    .maybeSingle();

  if (ocupado) {
    return { error: `El link "${slug}" ya lo usa otro comercio.`, success: false };
  }

  const { error } = await supabase
    .from("negocios")
    .update({ slug })
    .eq("id", negocioId);

  if (error) {
    console.error("[CAMBIAR SLUG]", error);
    return { error: "No se pudo cambiar el link.", success: false };
  }

  refrescarPanel();
  return { error: null, success: true };
}

/**
 * Prende o apaga el módulo de presupuestos y planes en cuotas.
 *
 * Es una decisión de Comerz, no del comercio: la columna vive en `negocios`,
 * que solo actualiza el super admin, y no en `configuracion_pos`, que la
 * escribe el ADMIN del negocio. Apagarlo esconde el módulo pero no borra nada:
 * los planes y los cobros quedan en la base.
 *
 * `.select("id")` + chequeo de filas: un UPDATE que la RLS filtra vuelve con
 * `error: null` y 0 filas, y acá eso sería decir "prendido" sin haberlo hecho.
 */
export async function cambiarModuloPresupuestosAction(
  negocioId: string,
  activo: boolean,
): Promise<ResultadoAccion> {
  const { supabase, autorizado } = await comoSuperAdmin();
  if (!autorizado) return { error: "No autorizado.", success: false };

  const { data, error } = await supabase
    .from("negocios")
    .update({ modulo_presupuestos: activo })
    .eq("id", negocioId)
    .select("id");

  if (error) {
    console.error("[MODULO PRESUPUESTOS]", error);
    return { error: "No se pudo cambiar el módulo.", success: false };
  }
  if (!data?.length) {
    return { error: "No se encontró el comercio.", success: false };
  }

  refrescarPanel();
  return { error: null, success: true };
}

export interface PagoDelNegocio {
  id: string;
  monto: number;
  fecha_pago: string;
  periodo_desde: string;
  periodo_hasta: string;
  medio: string;
  plan_nombre: string | null;
  nota: string | null;
}

export async function getPagosDelNegocioAction(
  negocioId: string,
): Promise<PagoDelNegocio[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data } = await supabase
    .from("pagos_suscripcion")
    .select(
      "id, monto, fecha_pago, periodo_desde, periodo_hasta, medio, plan_nombre, nota",
    )
    .eq("negocio_id", negocioId)
    .order("fecha_pago", { ascending: false });

  return (data ?? []).map((p) => ({
    id: p.id as string,
    monto: Number(p.monto ?? 0),
    fecha_pago: p.fecha_pago as string,
    periodo_desde: p.periodo_desde as string,
    periodo_hasta: p.periodo_hasta as string,
    medio: p.medio as string,
    plan_nombre: (p.plan_nombre as string | null) ?? null,
    nota: (p.nota as string | null) ?? null,
  }));
}
