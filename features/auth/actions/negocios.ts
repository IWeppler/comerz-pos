"use server";

import { negocioHabilitado } from "@/shared/lib/estado-negocio";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  COOKIE_NEGOCIO_ACTIVO,
  COOKIE_NEGOCIO_MAX_AGE,
} from "@/shared/lib/negocio-activo";
import { slugDesdeNombre, validarSlugNegocio } from "@/shared/lib/slug-negocio";
import {
  CONDICIONES_IVA,
  RUBROS,
  TAMANOS_EQUIPO,
  rubroOperativoDesde,
} from "@/shared/lib/rubros";
import { errorDeCuit, normalizarCuit } from "@/shared/lib/cuit";
import { refrescarClaimDeMembresias } from "../lib/refrescar-claim";

export interface MembresiaNegocio {
  negocio_id: string;
  rol: string;
  es_owner: boolean;
  nombre: string;
  slug: string;
  estado: string;
}

/**
 * Negocios a los que pertenece el usuario logueado. Se usa para decidir si
 * hay que mostrar el selector: con uno solo se entra derecho.
 */
export async function listarMisNegociosAction(): Promise<MembresiaNegocio[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("usuarios_negocios")
    .select("negocio_id, rol, es_owner, negocios(nombre, slug, estado)")
    .eq("usuario_id", user.id);

  if (error) {
    console.error("[LISTAR MIS NEGOCIOS ERROR]", error);
    return [];
  }

  return (data ?? [])
    .map((fila) => {
      // El embed de Supabase puede venir como objeto o como array de uno.
      const negocio = Array.isArray(fila.negocios)
        ? fila.negocios[0]
        : fila.negocios;
      return {
        negocio_id: fila.negocio_id as string,
        rol: fila.rol as string,
        es_owner: fila.es_owner as boolean,
        nombre: negocio?.nombre ?? "Negocio",
        slug: negocio?.slug ?? "",
        estado: negocio?.estado ?? "activo",
      };
    })
    // Incluye los de prueba: si no, el dueño de un comercio recién dado de
    // alta no lo ve en su propio selector y no puede entrar a nada.
    .filter((m) => negocioHabilitado(m.estado));
}

/**
 * Deja elegido el negocio en la cookie. Verifica la membresía acá igual que
 * la base: así el error se ve como mensaje y no como una pantalla vacía.
 */
export async function seleccionarNegocioAction(negocioId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión vencida. Volvé a entrar.", success: false };

  const { data: membresia } = await supabase
    .from("usuarios_negocios")
    .select("negocio_id")
    .eq("usuario_id", user.id)
    .eq("negocio_id", negocioId)
    .maybeSingle();

  if (!membresia) {
    return { error: "No pertenecés a ese negocio.", success: false };
  }

  cookieStore.set(COOKIE_NEGOCIO_ACTIVO, negocioId, {
    path: "/",
    maxAge: COOKIE_NEGOCIO_MAX_AGE,
    sameSite: "lax",
    // No es httpOnly a propósito: el cliente de browser la lee para mandar
    // el header. No es una credencial, la membresía se valida en la base.
    httpOnly: false,
  });

  revalidatePath("/", "layout");
  return { error: null, success: true };
}

export async function salirDeNegocioAction() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NEGOCIO_ACTIVO);
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/**
 * Alta de negocio: el que lo crea queda como owner con rol ADMIN. Todo el
 * armado (roles, permisos del admin, configuración y método de pago inicial)
 * corre dentro de la RPC, en una transacción.
 */
export async function crearNegocioAction(
  prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const rubro = String(formData.get("rubro") ?? "").trim();
  const tamanoEquipo = String(formData.get("tamano_equipo") ?? "").trim();

  // Paso 3 del onboarding, TODO opcional: un comercio puede empezar a vender
  // sin haber cargado su identidad fiscal, y pedírsela para entrar sería
  // frenarlo en el peor momento. Se completa después desde Configuración.
  const razonSocial = String(formData.get("razon_social") ?? "").trim();
  const cuitCrudo = String(formData.get("cuit") ?? "").trim();
  const condicionIva = String(formData.get("condicion_iva") ?? "").trim();

  if (!nombre) {
    return { error: "El nombre del negocio es obligatorio.", success: false };
  }

  if (!RUBROS.some((r) => r.valor === rubro)) {
    return { error: "Elegí el rubro de tu comercio.", success: false };
  }

  // OPCIONAL: se valida solo si vino. Era obligatorio y no debía serlo —
  // cuánta gente trabaja en el local no cambia nada de lo que el sistema
  // configura (eso lo decide el rubro), así que era un peaje en el alta a
  // cambio de un dato de segmentación. Se pregunta igual, pero no frena.
  if (tamanoEquipo && !TAMANOS_EQUIPO.some((t) => t.valor === tamanoEquipo)) {
    return { error: "Elegí una opción válida de tamaño de equipo.", success: false };
  }

  // El CUIT se valida por dígito verificador, igual que en clientes: atrapa el
  // tipeo en el momento y no dos días después, cuando aparece en una factura.
  if (cuitCrudo) {
    const errorCuit = errorDeCuit(cuitCrudo);
    if (errorCuit) return { error: errorCuit, success: false };
  }

  if (condicionIva && !CONDICIONES_IVA.some((c) => c.valor === condicionIva)) {
    return { error: "Elegí una condición frente al IVA válida.", success: false };
  }

  // El slug es el subdominio de la tienda, no un detalle cosmético: validarlo
  // acá es lo que evita que un comercio llamado "App" se lleve app.comerz.app.
  // La base tiene los mismos dos CHECK (20260811130000); esto existe para dar
  // un mensaje entendible en vez de un 23514.
  const candidato = slugDesdeNombre(nombre);
  const validacion = validarSlugNegocio(candidato);

  if (!validacion.valido) {
    return { error: validacion.error, success: false };
  }

  const slug = validacion.slug;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: negocioId, error } = await supabase.rpc(
    "crear_negocio_con_owner",
    {
      p_nombre: nombre,
      p_slug: slug,
      // Vacío se guarda como NULL y no como cadena vacía: "no lo cargó" y
      // "lo dejó en blanco" son lo mismo acá, y un "" en la columna se
      // filtraría distinto en cualquier consulta que pregunte por null.
      p_whatsapp: whatsapp || null,
      p_rubro_comercial: rubro,
      p_tamano_equipo: tamanoEquipo || null,
      // El operativo se deriva del comercial acá, en Node — mismo criterio que
      // la canonicalización de atributos: la traducción se queda del lado de la
      // app y la base recibe el valor ya resuelto. Es un default: el comercio
      // lo puede cambiar después en Configuración.
      p_rubro: rubroOperativoDesde(rubro),
      p_razon_social: razonSocial || null,
      p_cuit: cuitCrudo ? normalizarCuit(cuitCrudo) : null,
      p_condicion_iva: condicionIva || null,
    },
  );

  if (error) {
    console.error("[CREAR NEGOCIO ERROR]", error);
    // 23505 = slug o nombre ya tomado por otro negocio.
    if (error.code === "23505") {
      return {
        error: "Ya hay un negocio con ese nombre. Probá con otro.",
        success: false,
      };
    }
    return { error: "No se pudo crear el negocio.", success: false };
  }

  cookieStore.set(COOKIE_NEGOCIO_ACTIVO, negocioId as string, {
    path: "/",
    maxAge: COOKIE_NEGOCIO_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  await refrescarClaimDeMembresias(supabase, "crear negocio");

  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/** Invita a alguien al negocio activo. Solo ADMIN (lo exige la RLS). */
export async function invitarAlNegocioAction(email: string, rolId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión vencida.", success: false, token: null };

  const negocioActivo = cookieStore.get(COOKIE_NEGOCIO_ACTIVO)?.value;

  const { data, error } = await supabase
    .from("invitaciones")
    .insert({
      email: email.trim().toLowerCase(),
      rol_id: rolId,
      invitado_por: user.id,
      ...(negocioActivo ? { negocio_id: negocioActivo } : {}),
    })
    .select("token")
    .single();

  if (error) {
    console.error("[INVITAR AL NEGOCIO ERROR]", error);
    if (error.code === "23505") {
      return {
        error: "Ya hay una invitación pendiente para ese email.",
        success: false,
        token: null,
      };
    }
    return { error: "No se pudo crear la invitación.", success: false, token: null };
  }

  revalidatePath("/configuracion");
  return { error: null, success: true, token: data.token as string };
}

/** El invitado acepta con el token que le llegó. */
export async function aceptarInvitacionAction(token: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: negocioId, error } = await supabase.rpc("aceptar_invitacion", {
    p_token: token,
  });

  if (error) {
    console.error("[ACEPTAR INVITACION ERROR]", error);
    return { error: error.message, success: false };
  }

  cookieStore.set(COOKIE_NEGOCIO_ACTIVO, negocioId as string, {
    path: "/",
    maxAge: COOKIE_NEGOCIO_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  await refrescarClaimDeMembresias(supabase, "aceptar invitación");

  revalidatePath("/", "layout");
  return { error: null, success: true };
}
