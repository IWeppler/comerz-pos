"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizarCodigoCupon, codigoCuponValido } from "@/features/store/lib/codigo-cupon";

export async function createPromotionAction(
  prevState: unknown,
  formData: FormData,
) {
  try {
    const codigo = normalizarCodigoCupon(formData.get("codigo"));
    if (!codigoCuponValido(codigo)) return { error: "El código debe tener entre 4 y 20 letras o números.", success: false };
    const nombre = formData.get("nombre") as string;
    const tipoReglaRaw = formData.get("tipo_regla") as string;
    const tipo_regla = tipoReglaRaw === "SIN_CONDICION" ? null : tipoReglaRaw;
    const tipo_descuento = formData.get("tipo_descuento") as string;
    const valor_descuento = Number(formData.get("valor_descuento"));
    const mostrar_en_catalogo = formData.get("mostrar_en_catalogo") === "true";
    const acumulable = formData.get("acumulable") === "true";
    const prioridad = Number(formData.get("prioridad") || 0);

    // Fechas de vigencia (opcionales)
    const fecha_inicio = formData.get("fecha_inicio") as string;
    const fecha_fin = formData.get("fecha_fin") as string;

    // Campos dinámicos
    const metodo_pago = formData.get("metodo_pago") as string;
    const categoria_nombre = formData.get("categoria_nombre") as string;
    const monto_minimo = Number(formData.get("monto_minimo") || 0);

    if (!nombre || !tipoReglaRaw || !tipo_descuento || isNaN(valor_descuento)) {
      return { error: "Faltan datos obligatorios.", success: false };
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "No autorizado.", success: false };

    // 1. Insertamos la cabecera de la promoción
    const { data: promo, error: promoError } = await supabase
      .from("promociones")
      .insert({
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
        creado_por: user.id,
        activa: true,
      })
      .select("id")
      .single();

    if (promoError || !promo) {
      console.error("Error creando promo:", promoError);
      return {
        error: promoError?.code === "23505" ? "Ya tenés una promoción con ese código" : "No se pudo guardar la regla principal.",
        success: false,
      };
    }

    // 2. Insertamos la condición específica según la regla elegida
    if (tipo_regla === "METODO_PAGO" && metodo_pago) {
      await supabase.from("promociones_metodos_pago").insert({
        promocion_id: promo.id,
        metodo_pago,
      });
    }

    if (tipo_regla === "CATEGORIA" && categoria_nombre) {
      await supabase.from("promociones_categorias").insert({
        promocion_id: promo.id,
        categoria_nombre,
      });
    }

    revalidatePath("/configuracion");
    return { error: null, success: true };
  } catch (err) {
    console.error("Error inesperado en promociones:", err);
    return { error: "Error interno del servidor.", success: false };
  }
}
