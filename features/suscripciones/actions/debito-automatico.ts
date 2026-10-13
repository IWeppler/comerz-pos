"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { urlDelPanel } from "@/shared/lib/ruteo-host";
import { precioEfectivo } from "@/features/admin/lib/precio-efectivo";
import { armarPreapproval, estadoPreapproval, inicioPrimerDebito } from "../lib/preapproval";
import { mpComerz, tokenComerz } from "../lib/mp-comerz-servidor";

/**
 * Activar el débito automático de un comercio: crea (o reusa) su suscripción
 * de MP en la cuenta de Comerz y devuelve el link para autorizar la tarjeta.
 *
 * Lo puede pedir el super admin (desde /admincomerz, para mandarle el link) o
 * el ADMIN del propio comercio (desde su panel). La suscripción se escribe con
 * service_role: la tabla no tiene policies de escritura.
 *
 * Monto = precio efectivo (acordado o de lista). Primer débito = vencimiento o
 * ahora si venció (`inicioPrimerDebito`). Un comercio en prueba elige el plan.
 */

export type ResultadoDebito =
  | { ok: true; initPoint: string | null; estado: string; inicio: string | null; monto: number }
  | { ok: false; error: string };

export interface SuscripcionVista {
  estado: "pending" | "authorized" | "paused" | "cancelled";
  monto: number;
  planNombre: string | null;
  inicio: string | null;
  initPoint: string | null;
}

async function puedeGestionar(negocioId: string): Promise<{ ok: boolean; usuarioId: string | null }> {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, usuarioId: null };
  const [{ data: superAdmin }, { data: negocioActual }, { data: rol }] = await Promise.all([
    supabase.rpc("is_super_admin"),
    supabase.rpc("negocio_actual"),
    supabase.rpc("rol_actual"),
  ]);
  const ok = superAdmin === true || (negocioActual === negocioId && rol === "ADMIN");
  return { ok, usuarioId: user.id };
}

export async function activarDebitoAutomaticoAction(
  negocioId: string,
  planIdElegido?: string | null,
): Promise<ResultadoDebito> {
  if (!tokenComerz()) return { ok: false, error: "El débito automático todavía no está disponible." };
  const permiso = await puedeGestionar(negocioId);
  if (!permiso.ok) return { ok: false, error: "No tenés permiso para gestionar la suscripción de este comercio." };

  const admin = createAdminClient();
  const [{ data: negocio }, { data: duenio }, { data: viva }] = await Promise.all([
    admin
      .from("negocios")
      .select("id, nombre, estado, plan_id, plan_vencimiento, precio_acordado, cuenta_en_mrr")
      .eq("id", negocioId)
      .maybeSingle(),
    admin
      .from("usuarios_negocios")
      .select("perfiles(email)")
      .eq("negocio_id", negocioId)
      .eq("es_owner", true)
      .limit(1)
      .maybeSingle(),
    admin
      .from("suscripciones_mp")
      .select("preapproval_id, estado, monto, plan_id, init_point, inicio")
      .eq("negocio_id", negocioId)
      .in("estado", ["pending", "authorized", "paused"])
      .maybeSingle(),
  ]);
  if (!negocio) return { ok: false, error: "No encontramos el comercio." };

  const planId = planIdElegido || (negocio.plan_id as string | null);
  const { data: plan } = planId
    ? await admin.from("planes").select("id, nombre, precio_mensual, activo").eq("id", planId).maybeSingle()
    : { data: null };
  if (!plan || !(Number(plan.precio_mensual) > 0) || plan.activo === false) {
    return { ok: false, error: "Elegí un plan para activar el débito automático." };
  }

  // El precio acordado es del comercio con SU plan; si elige otro, va el de lista.
  const acordado =
    planId === negocio.plan_id && negocio.precio_acordado !== null ? Number(negocio.precio_acordado) : null;
  const monto = precioEfectivo(acordado, Number(plan.precio_mensual));
  if (!(monto > 0)) return { ok: false, error: "Este comercio no paga (cortesía): no lleva débito automático." };

  const perfil = (Array.isArray(duenio?.perfiles) ? duenio?.perfiles[0] : duenio?.perfiles) as
    | { email?: string }
    | null
    | undefined;
  const email = perfil?.email;
  if (!email) return { ok: false, error: "El comercio no tiene un dueño con email." };

  // Ya tiene una viva: si es la misma (plan y monto), se reusa el link.
  if (viva) {
    const igual = Number(viva.monto) === monto && (viva.plan_id ?? null) === plan.id;
    if (igual || viva.estado !== "pending") {
      return {
        ok: true,
        initPoint: (viva.init_point as string | null) ?? null,
        estado: viva.estado as string,
        inicio: (viva.inicio as string | null) ?? null,
        monto: Number(viva.monto),
      };
    }
    // Pendiente con otro plan o monto: se cancela y se crea la nueva.
    await mpComerz(`/preapproval/${encodeURIComponent(viva.preapproval_id as string)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    await admin
      .from("suscripciones_mp")
      .update({ estado: "cancelled", actualizado_en: new Date().toISOString() })
      .eq("preapproval_id", viva.preapproval_id as string);
  }

  const ahora = new Date();
  const cuerpo = armarPreapproval(
    {
      negocioId,
      nombreNegocio: negocio.nombre as string,
      planNombre: plan.nombre as string,
      monto,
      payerEmail: email,
      vencimiento: (negocio.plan_vencimiento as string | null) ?? null,
      urlRetorno: urlDelPanel("/perfil", "?tab=plan"),
    },
    ahora,
  );
  const r = await mpComerz("/preapproval", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    idempotencia: `preapproval-${negocioId}-${plan.id}-${monto}-${ahora.toISOString().slice(0, 13)}`,
  });
  const preapprovalId = r?.json?.id as string | undefined;
  const initPoint = (r?.json?.init_point as string | undefined) ?? null;
  if (!r?.ok || !preapprovalId) {
    console.error("[DEBITO MP] crear", r?.status, (r?.json as { message?: string } | null)?.message);
    return { ok: false, error: "Mercado Pago no pudo crear la suscripción. Probá de nuevo en un rato." };
  }

  const inicio = inicioPrimerDebito((negocio.plan_vencimiento as string | null) ?? null, ahora);
  const { error } = await admin.from("suscripciones_mp").insert({
    negocio_id: negocioId,
    preapproval_id: preapprovalId,
    estado: estadoPreapproval(r.json?.status) ?? "pending",
    plan_id: plan.id,
    monto,
    payer_email: email,
    inicio: inicio?.toISOString() ?? ahora.toISOString(),
    init_point: initPoint,
    creado_por: permiso.usuarioId,
  });
  if (error) {
    console.error("[DEBITO MP] guardar", error.code, error.message);
    return { ok: false, error: "No se pudo guardar la suscripción. Probá de nuevo." };
  }

  revalidatePath("/perfil");
  revalidatePath("/admincomerz");
  return { ok: true, initPoint, estado: "pending", inicio: inicio?.toISOString() ?? null, monto };
}

/** La suscripción viva del comercio de la sesión, para su panel. RLS: la suya. */
export async function getMiSuscripcionAction(): Promise<SuscripcionVista | null> {
  const supabase = createClient(await cookies());
  // Filtro explícito: al super admin la RLS le deja ver todas.
  const { data: negocioId } = await supabase.rpc("negocio_actual");
  if (!negocioId) return null;
  const { data } = await supabase
    .from("suscripciones_mp")
    .select("estado, monto, inicio, init_point, planes(nombre)")
    .eq("negocio_id", negocioId as string)
    .in("estado", ["pending", "authorized", "paused"])
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const plan = (Array.isArray(data.planes) ? data.planes[0] : data.planes) as { nombre?: string } | null;
  return {
    estado: data.estado as SuscripcionVista["estado"],
    monto: Number(data.monto),
    planNombre: plan?.nombre ?? null,
    inicio: (data.inicio as string | null) ?? null,
    initPoint: (data.init_point as string | null) ?? null,
  };
}
