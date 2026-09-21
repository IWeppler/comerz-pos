"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * Categorías de gastos (`categorias_egreso`, `20260921190000`).
 *
 * Eje DESCRIPTIVO debajo de `egresos.tipo = OPERATIVO`: no decide nada de
 * plata, y por eso es opcional y sin default. Un retiro, una compra de
 * mercadería o una devolución no llevan categoría — el tipo ya lo dice todo y
 * la base lo impide con un CHECK.
 */

export type CategoriaEgreso = {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  es_sistema: boolean;
};

export async function getCategoriasEgresoAction(opts?: {
  incluirInactivas?: boolean;
}): Promise<CategoriaEgreso[]> {
  const supabase = createClient(await cookies());
  let query = supabase
    .from("categorias_egreso")
    .select("id, nombre, orden, activa, es_sistema")
    .order("orden")
    .order("nombre");
  if (!opts?.incluirInactivas) query = query.eq("activa", true);

  const { data, error } = await query;
  if (error) {
    console.error("Error cargando categorías de gasto:", error);
    return [];
  }
  return (data ?? []) as CategoriaEgreso[];
}

/**
 * Alta desde el mismo selector del gasto (mismo patrón que la cuenta destino
 * del método de pago): si solo se listara lo que existe, la primera vez que
 * falte una habría que salir a otra pantalla, y quien no sale registra el
 * gasto sin categoría o en la primera que encuentra.
 *
 * La RLS ya pide `caja.registrar_egreso`; el chequeo acá es el mensaje
 * amable. Devuelve la categoría creada para que el selector la elija en el
 * acto sin volver a pedir la lista.
 */
export async function crearCategoriaEgresoAction(
  nombre: string,
): Promise<{ categoria: CategoriaEgreso | null; error: string | null }> {
  const limpio = nombre.trim();
  if (!limpio) return { categoria: null, error: "Poné un nombre." };
  if (limpio.length > 60) {
    return { categoria: null, error: "El nombre es demasiado largo (máximo 60)." };
  }

  const supabase = createClient(await cookies());
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_REGISTRAR_EGRESO))) {
    return { categoria: null, error: "No tenés permiso para crear categorías." };
  }

  const { data, error } = await supabase
    .from("categorias_egreso")
    .insert({ nombre: limpio })
    .select("id, nombre, orden, activa, es_sistema")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Ya existe con ese nombre (quizás inactiva): devolverla en vez de
      // fallar, que es lo que la persona quería de todas formas.
      const { data: existente } = await supabase
        .from("categorias_egreso")
        .select("id, nombre, orden, activa, es_sistema")
        .ilike("nombre", limpio)
        .maybeSingle();
      if (existente) return { categoria: existente as CategoriaEgreso, error: null };
    }
    console.error("Error creando categoría de gasto:", error);
    return { categoria: null, error: "No se pudo crear la categoría." };
  }

  revalidatePath("/caja");
  revalidatePath("/configuracion");
  return { categoria: data as CategoriaEgreso, error: null };
}

/** Renombrar, reordenar o desactivar. Solo ADMIN (RLS). Desactivar en vez
 * de borrar: el historial conserva el nombre. */
export async function actualizarCategoriaEgresoAction(
  id: string,
  cambios: Partial<Pick<CategoriaEgreso, "nombre" | "orden" | "activa">>,
): Promise<{ error: string | null }> {
  const payload: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) {
    const limpio = cambios.nombre.trim();
    if (!limpio) return { error: "Poné un nombre." };
    payload.nombre = limpio;
  }
  if (cambios.orden !== undefined) payload.orden = cambios.orden;
  if (cambios.activa !== undefined) payload.activa = cambios.activa;
  if (Object.keys(payload).length === 0) return { error: null };

  const supabase = createClient(await cookies());
  // `.select("id")` + chequeo de filas: un UPDATE filtrado por RLS vuelve con
  // 0 filas y `error: null`, y eso no es "guardado".
  const { data, error } = await supabase
    .from("categorias_egreso")
    .update(payload)
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === "23505") return { error: "Ya hay una categoría con ese nombre." };
    console.error("Error actualizando categoría de gasto:", error);
    return { error: "No se pudo guardar la categoría." };
  }
  if (!data?.length) return { error: "No tenés permiso para editar categorías." };

  revalidatePath("/caja");
  revalidatePath("/configuracion");
  return { error: null };
}

/**
 * Recategorizar un gasto ya registrado. Es la única edición que `egresos`
 * admite (junto con el concepto): el trigger
 * `egresos_solo_descriptivo_editable` rechaza tocar monto, tipo o cuenta,
 * porque eso es plata y plata se anula y se vuelve a registrar.
 *
 * `null` = sacarle la categoría. No pasa por la bitácora financiera a
 * propósito: no se movió un peso.
 */
export async function recategorizarEgresoAction(
  egresoId: string,
  categoriaId: string | null,
): Promise<{ error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("egresos")
    .update({ categoria_id: categoriaId })
    .eq("id", egresoId)
    .select("id");

  if (error) {
    // CHECK egresos_categoria_solo_operativo: un retiro o una compra no
    // llevan categoría.
    if (error.code === "23514") {
      return { error: "Solo un gasto operativo puede tener categoría." };
    }
    console.error("Error recategorizando egreso:", error);
    return { error: "No se pudo cambiar la categoría." };
  }
  if (!data?.length) {
    return { error: "No tenés permiso para editar este gasto." };
  }

  revalidatePath("/caja");
  return { error: null };
}
