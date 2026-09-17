"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ConfiguracionPOS } from "@/entities/config/types";
import { errorDeCuit, normalizarCuit } from "@/shared/lib/cuit";
import { validarSlugNegocio } from "@/shared/lib/slug-negocio";

export async function getConfiguracionAction(): Promise<{
  data: ConfiguracionPOS | null;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await supabase
      .from("configuracion_pos")
      .select("*")
      .single();

    if (error) {
      console.error("Error al obtener configuración:", error);
      return { data: null, error: "No se pudo cargar la configuración." };
    }

    return { data: data as ConfiguracionPOS, error: null };
  } catch (err) {
    console.error("Error inesperado:", err);
    return { data: null, error: "Ocurrió un error en el servidor." };
  }
}

export async function updateConfiguracionAction(
  prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  /**
   * Un campo vacío es "sin dato", no cadena vacía. Importa de verdad en dos
   * columnas: `inicio_actividades` es `date` (un "" revienta con 22007) y
   * `condicion_iva` tiene CHECK (un "" no está en la lista permitida).
   */
  const textoOpcional = (clave: string): string | null => {
    const valor = ((formData.get(clave) as string | null) ?? "").trim();
    return valor === "" ? null : valor;
  };

  const id = formData.get("id") as string;
  const posName = ((formData.get("posName") as string) ?? "").trim();
  const razon_social = textoOpcional("razon_social");
  // Se guarda normalizado a 11 dígitos, igual que el de los clientes: el campo
  // ahora lo muestra con guiones, y esos guiones son de la pantalla, no del
  // dato. Guardar "30-71234567-8" lo dejaría impreso así en el comprobante y
  // haría que el mismo CUIT no se compare igual consigo mismo.
  const cuitCrudo = textoOpcional("cuit");
  const cuit = cuitCrudo ? normalizarCuit(cuitCrudo) : null;
  const condicion_iva = textoOpcional("condicion_iva");
  const inicio_actividades = textoOpcional("inicio_actividades");
  const provincia = textoOpcional("provincia");
  const localidad = textoOpcional("localidad");
  const whatsapp = ((formData.get("whatsapp") as string) ?? "").trim();
  const direccion = textoOpcional("direccion");
  const logoFile = formData.get("logo") as File | null;

  // El id sale de un input hidden: si falta no es que el usuario olvidó algo,
  // es que el formulario se cargó mal. Merece su propio mensaje, en vez de
  // mandarlo a revisar campos que ya completó.
  if (!id) {
    return {
      error: "No se pudo identificar la configuración. Recargá la página.",
      success: false,
    };
  }

  // El CUIT del emisor no se validaba: entraba cualquier cosa y recién se
  // notaba en una factura. Mismo criterio que en clientes y en el alta —
  // vacío sigue siendo válido (se puede completar después).
  if (cuitCrudo) {
    const errorCuit = errorDeCuit(cuitCrudo);
    if (errorCuit) return { error: errorCuit, success: false };
  }

  // Los mensajes nombran el campo tal cual figura en pantalla: "el nombre" a
  // secas mandaba a buscar entre Nombre Comercial y Razón Social.
  if (!posName || !whatsapp) {
    const faltantes = [
      !posName ? "Nombre Comercial" : null,
      !whatsapp ? "Teléfono / WhatsApp" : null,
    ].filter(Boolean);

    return {
      error: `Falta completar: ${faltantes.join(" y ")}.`,
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  let posLogoUrl: string | undefined = undefined;

  // 1. Si el usuario subió un nuevo logo, lo subimos al bucket "logos"
  if (logoFile && logoFile.size > 0) {
    // Bajo la carpeta del negocio: la policy de storage no deja escribir
    // fuera de ella, y así el logo de un comercio no pisa el de otro.
    const { data: negocioId } = await supabase.rpc("negocio_actual");
    if (!negocioId) {
      return {
        error: "No hay un negocio activo en esta sesión.",
        success: false,
      };
    }

    const fileExt = logoFile.name.split(".").pop();
    const fileName = `${negocioId}/logo-${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(fileName, logoFile, { cacheControl: "31536000" });

    if (!uploadError) {
      const {
        data: { publicUrl },
      } = supabase.storage.from("logos").getPublicUrl(fileName);
      posLogoUrl = publicUrl;
    } else {
      console.error("Error subiendo logo:", uploadError);
      return { error: "No se pudo subir la imagen del logo.", success: false };
    }
  }

  // 2. Preparamos la data a actualizar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    posName,
    whatsapp,
    direccion,
    razon_social,
    cuit,
    condicion_iva,
    inicio_actividades,
    provincia,
    localidad,
    updated_at: new Date().toISOString(),
  };

  // Solo actualizamos el logo si se subió uno nuevo
  if (posLogoUrl) {
    updateData.posLogo = posLogoUrl;
  }

  // 3. Impactamos en la BD
  //
  // Con `.select("id")` y chequeo de filas: desde `20260905120000` escribir
  // `configuracion_pos` pide ADMIN, y un UPDATE filtrado por RLS devuelve 0
  // filas con `error: null`. Sin esto, un ENCARGADO veía "Configuración
  // guardada" y no se había guardado nada — el mismo éxito silencioso que
  // costó 35 fotos el 5/9/2026.
  const { data: filasTocadas, error } = await supabase
    .from("configuracion_pos")
    .update(updateData)
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("Error al actualizar configuración:", error);
    return { error: "No se pudo guardar la configuración.", success: false };
  }

  if (!filasTocadas || filasTocadas.length === 0) {
    return {
      error:
        "Solo un administrador puede cambiar la configuración del comercio.",
      success: false,
    };
  }

  revalidatePath("/", "layout");

  return { error: null, success: true };
}

/**
 * Cambia la dirección web de la tienda (el slug del negocio activo).
 *
 * La escritura la hace `cambiar_slug_negocio`, que es SECURITY DEFINER y NO
 * recibe el negocio: lo resuelve de la sesión. Acá no se puede escribir
 * `negocios` a mano — la única policy de UPDATE de esa tabla es la del super
 * admin, y abrirla para el dueño le daría también `estado` y `plan_id`, porque
 * la RLS es por fila y no por columna.
 *
 * La validación de formato se hace primero en TS (mensaje entendible y sin
 * viaje a la base) y otra vez adentro de la función: un server action es un
 * endpoint, y el freno de verdad son los CHECK de `negocios`.
 */
export async function cambiarSlugTiendaAction(slugCrudo: string): Promise<{
  error: string | null;
  slug: string | null;
}> {
  const validacion = validarSlugNegocio(slugCrudo ?? "");
  if (!validacion.valido) return { error: validacion.error, slug: null };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("cambiar_slug_negocio", {
    p_slug: validacion.slug,
  });

  if (error) {
    console.error("[CAMBIAR SLUG ERROR]", error);
    const mensaje = error.message ?? "";

    if (mensaje.includes("SLUG_OCUPADO")) {
      return {
        error: `"${validacion.slug}" ya es la dirección de otro comercio. Probá con otra.`,
        slug: null,
      };
    }
    if (mensaje.includes("SLUG_RESERVADO")) {
      return {
        error: `"${validacion.slug}" está reservado por la plataforma. Elegí otra dirección.`,
        slug: null,
      };
    }
    if (mensaje.includes("SOLO_ADMIN")) {
      return {
        error: "Solo un administrador puede cambiar la dirección de la tienda.",
        slug: null,
      };
    }
    if (mensaje.includes("SIN_NEGOCIO_ACTIVO")) {
      return { error: "No hay un negocio activo en esta sesión.", slug: null };
    }

    return {
      error: "No se pudo cambiar la dirección de la tienda.",
      slug: null,
    };
  }

  // El slug viaja en el layout (NegocioActivo) y es la clave con la que la RLS
  // resuelve el catálogo público, así que se revalida todo: el panel para que
  // los links nuevos salgan bien, y /store porque la ruta vieja dejó de existir.
  revalidatePath("/", "layout");
  revalidatePath("/store", "layout");

  return { error: null, slug: (data as string) ?? validacion.slug };
}
