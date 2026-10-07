"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizarCodigoCupon, codigoCuponValido } from "@/features/store/lib/codigo-cupon";

export async function togglePromotionAction(id: string, currentState: boolean) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase
    .from("promociones")
    .update({ activa: !currentState })
    .eq("id", id);

  if (error) return { success: false, error: "No se pudo actualizar el estado de la promoción." };
  
  revalidatePath("/configuracion");
  return { success: true, error: null };
}

export async function deletePromotionAction(id: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase
    .from("promociones")
    .delete()
    .eq("id", id);

  if (error) return { success: false, error: "No se pudo eliminar la promoción." };
  
  revalidatePath("/configuracion");
  return { success: true, error: null };
}

export async function editPromotionAction(
  prevState: unknown,
  formData: FormData,
) {
  try {
    const codigo = normalizarCodigoCupon(formData.get("codigo"));
    if (!codigoCuponValido(codigo)) return { error: "El código debe tener entre 4 y 20 letras o números.", success: false };
    const id = formData.get("id") as string;
    const nombre = formData.get("nombre") as string;
    const tipoReglaRaw = formData.get("tipo_regla") as string;
    const tipo_regla = tipoReglaRaw === "SIN_CONDICION" ? null : tipoReglaRaw;
    const tipo_descuento = formData.get("tipo_descuento") as string;
    const valor_descuento = Number(formData.get("valor_descuento"));
    const mostrar_en_catalogo = formData.get("mostrar_en_catalogo") === "true";
    const acumulable = formData.get("acumulable") === "true";
    const prioridad = Number(formData.get("prioridad") || 0);

    const fecha_inicio = formData.get("fecha_inicio") as string;
    const fecha_fin = formData.get("fecha_fin") as string;

    const metodo_pago = formData.get("metodo_pago") as string;
    const categoria_nombre = formData.get("categoria_nombre") as string;
    const monto_minimo = Number(formData.get("monto_minimo") || 0);

    if (!id || !nombre || !tipoReglaRaw || !tipo_descuento || isNaN(valor_descuento)) {
      return { error: "Faltan datos obligatorios.", success: false };
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // 1. Actualizamos la cabecera
    const { error: promoError, data: filas } = await supabase
      .from("promociones")
      .update({
        codigo,
        nombre,
        tipo_regla,
        tipo_descuento,
        valor_descuento,
        monto_minimo: tipo_regla === "MONTO_MINIMO" ? monto_minimo : 0,
        fecha_inicio: fecha_inicio ? fecha_inicio : null,
        fecha_fin: fecha_fin ? fecha_fin : null,
        mostrar_en_catalogo,
        acumulable,
        prioridad,
      })
      .eq("id", id)
      .select("id");

    if (promoError) return { error: promoError.code === "23505" ? "Ya tenés una promoción con ese código" : "No se pudo actualizar la promoción.", success: false };
    if (!filas?.length) return { error: "No se guardó la promoción. Revisá tus permisos y la sesión.", success: false };

    // 2. Limpiamos las relaciones antiguas
    await supabase.from("promociones_metodos_pago").delete().eq("promocion_id", id);
    await supabase.from("promociones_categorias").delete().eq("promocion_id", id);

    // 3. Insertamos la nueva relación según el tipo de regla editado
    if (tipo_regla === "METODO_PAGO" && metodo_pago) {
      await supabase.from("promociones_metodos_pago").insert({ promocion_id: id, metodo_pago });
    }

    if (tipo_regla === "CATEGORIA" && categoria_nombre) {
      await supabase.from("promociones_categorias").insert({ promocion_id: id, categoria_nombre });
    }

    revalidatePath("/configuracion");
    return { error: null, success: true };
  } catch (err) {
    console.error("Error al editar promoción:", err);
    return { error: "Error interno del servidor.", success: false };
  }
}
