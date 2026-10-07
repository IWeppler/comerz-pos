"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidarCatalogoDeSesion } from "@/shared/lib/cache-catalogo";

import {
  calcularAjuste, validarReglaPrecio, productosSinCostoParaRecargo,
  type ReglaPrecio, type AlcancePrecio, type OperacionPrecio,
  type CampoObjetivo, type TipoRedondeo,
} from "../lib/ajuste-precios";
import { agruparMarcas, normalizarMarca } from "../lib/marcas-del-catalogo";
import { leerCompleto, leerPorIds } from "../lib/lectura-ajuste-precios";
export type { AlcancePrecio, OperacionPrecio, CampoObjetivo, TipoRedondeo } from "../lib/ajuste-precios";

export interface PrevisualizacionItem {
  producto_id: string;
  nombre: string;
  categoria: string;
  costo_anterior: number;
  costo_nuevo: number;
  diferencia_costo: number;
  precio_anterior: number;
  precio_nuevo: number;
  diferencia_precio: number;
}

export interface AdvertenciasPrecio {
  productosPrecioCero: number;
  variantesPrecioCero: number;
  reduccionTotal: boolean;
  productosResultanCeroONegativo: number;
}

export interface AjustePrecioHistorialItem {
  id: string;
  nombre: string;
  tipo_alcance: AlcancePrecio;
  alcance_valor: string | null;
  tipo_operacion: OperacionPrecio;
  campo_objetivo: CampoObjetivo;
  valor: number;
  estado: string;
  creado_en: string;
  revertido_en: string | null;
  productosAfectados: number;
  variantesAfectadas: number;
  tieneAuditoriaVariantes: boolean;
}

export interface RevertirPreviewItem {
  producto_id: string;
  variante_id: string | null;
  nombre: string;
  /**
   * `null` en una fila de variante = no tenía valor propio, hereda del
   * producto. Distinto de 0, que es un precio de cero. Ver
   * 20260908210000: mostrar los dos como "$0" era prometer que revertir le
   * pone precio cero a algo que en realidad va a quedar siguiendo al producto.
   */
  precio_actual: number | null;
  precio_al_revertir: number | null;
  costo_actual: number | null;
  costo_al_revertir: number | null;
  cambia: boolean;
}

async function esUsuarioAdmin(
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // is_admin() resuelve el rol dentro del negocio activo. perfiles.rol quedó
  // deprecada: es NULL para todo usuario invitado, así que leerla acá dejaba a
  // una encargada nueva sin poder actualizar precios.
  const { data: esAdmin } = await supabase.rpc("is_admin");

  return esAdmin === true;
}

export async function listarMarcasAction() {
  const supabase = createClient(await cookies());
  if (!(await esUsuarioAdmin(supabase))) return { error: "Solo un administrador puede ver las marcas para ajustar precios." };
  const res = await leerCompleto("Marcas del catálogo", (desde, hasta) => supabase.from("productos")
    .select("marca", { count: "exact" }).order("id").range(desde, hasta));
  if (res.error) return { error: res.error };
  return { data: agruparMarcas(res.data) };
}

// La marca y la categoría comparten valorAlcance; SELECCION usa ids.
export async function simularPreciosAction(
  alcance: AlcancePrecio, valorAlcance: string, campo: CampoObjetivo,
  operacion: OperacionPrecio, valor: number, redondeo: TipoRedondeo, productIds?: string[],
) {
  const supabase = createClient(await cookies());
  if (!(await esUsuarioAdmin(supabase))) return { error: "Solo un administrador puede actualizar precios." };
  const regla = { alcance, valorAlcance, campo, operacion, valor, redondeo };
  const invalida = validarReglaPrecio(regla);
  if (invalida) return { error: invalida };
  if (alcance === "SELECCION" && !productIds?.length) return { error: "No hay productos seleccionados." };
  const pagina = (desde: number, hasta: number, ids?: string[]) => {
    let q = supabase.from("productos").select(
      "id, nombre, tipo, marca, categoria_id, precio, precio_costo, categoria:categorias(nombre)", { count: "exact" },
    ).order("id").range(desde, hasta);
    if (alcance === "CATEGORIA") q = q.eq("categoria_id", valorAlcance);
    if (ids) q = q.in("id", ids);
    return q;
  };
  const res = alcance === "SELECCION"
    ? await leerPorIds(productIds!, (ids, desde, hasta) => pagina(desde, hasta, ids))
    : await leerCompleto("Simular precios", (desde, hasta) => pagina(desde, hasta));
  if (res.error) return { error: res.error };
  const productos = alcance === "MARCA" ? res.data.filter((p) => normalizarMarca(p.marca) === normalizarMarca(valorAlcance)) : res.data;
  if (alcance === "SELECCION" && productos.length !== new Set(productIds).size) return { error: "Hay productos seleccionados que ya no están disponibles." };
  if (!productos.length) return { error: "No hay productos en este alcance." };
  const sinCosto = productosSinCostoParaRecargo(regla, productos);
  if (sinCosto) return { error: sinCosto };
  const variantes = await leerPorIds(productos.map((p) => p.id), (ids, desde, hasta) => supabase
    .from("producto_variantes").select("id, producto_id, precio", { count: "exact" })
    .in("producto_id", ids).order("id").range(desde, hasta));
  if (variantes.error) return { error: variantes.error };
  const porcentual = operacion !== "FIJAR_MARGEN" && campo !== "COSTO";
  const preview: PrevisualizacionItem[] = productos.map((p) => {
    const costo = p.precio_costo === null ? null : Number(p.precio_costo);
    const precio = Number(p.precio);
    const nuevo = calcularAjuste(costo, precio, regla);
    const categoria = Array.isArray(p.categoria) ? p.categoria[0] : p.categoria;
    return { producto_id: p.id, nombre: p.nombre || "Sin nombre", categoria: categoria?.nombre || p.tipo || "Sin categoría",
      costo_anterior: costo ?? 0, costo_nuevo: nuevo.costo ?? 0, diferencia_costo: (nuevo.costo ?? 0) - (costo ?? 0),
      precio_anterior: precio, precio_nuevo: nuevo.precio!, diferencia_precio: nuevo.precio! - precio };
  });
  return { preview, advertencias: {
    productosPrecioCero: porcentual ? productos.filter((p) => Number(p.precio) === 0).length : 0,
    variantesPrecioCero: porcentual ? variantes.data.filter((v) => v.precio !== null && Number(v.precio) === 0).length : 0,
    reduccionTotal: operacion === "REDUCIR_PORCENTAJE" && valor === 100,
    productosResultanCeroONegativo: campo !== "COSTO" ? preview.filter((p) => p.precio_nuevo <= 0).length : 0,
  } };
}

// Solo viajan ids y la regla. Los importes de la preview no se usan para escribir.
export async function aplicarPreciosAction(nombreLote: string, previewData: PrevisualizacionItem[], config: ReglaPrecio, solicitudId: string) {
  const supabase = createClient(await cookies());
  if (!(await esUsuarioAdmin(supabase))) return { error: "Solo un administrador puede actualizar precios." };
  const invalida = validarReglaPrecio(config);
  if (invalida) return { error: invalida };
  if (!previewData.length) return { error: "No hay productos para actualizar." };
  const { error } = await supabase.rpc("aplicar_ajuste_precios", {
    p_solicitud_id: solicitudId, p_nombre: nombreLote,
    p_alcance: config.alcance, p_valor_alcance: config.valorAlcance ?? null,
    p_campo: config.campo, p_operacion: config.operacion, p_valor: config.valor,
    p_redondeo: config.redondeo, p_producto_ids: previewData.map((p) => p.producto_id),
    p_prevision: previewData.map((p) => ({ producto_id: p.producto_id, precio_anterior: p.precio_anterior, costo_anterior: p.costo_anterior })),
  });
  if (error) {
    // El mensaje de la base ya está escrito para la persona; se le saca el
    // código interno del guard.
    return { error: error.message.replace(/^SIN_COSTO_PARA_RECARGO:\s*/, "") };
  }
  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  await invalidarCatalogoDeSesion(supabase);
  return { success: true };
}

// 3. LISTAR HISTORIAL DE AJUSTES
export async function listarHistorialPreciosAction(): Promise<
  { data: AjustePrecioHistorialItem[]; error?: undefined } | { error: string }
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!(await esUsuarioAdmin(supabase))) {
    return {
      error:
        "Solo un administrador puede ver el historial de ajustes de precio.",
    };
  }

  const { data: lotes, error: lotesError } = await leerCompleto("Historial de precios", (desde, hasta) => supabase
    .from("actualizaciones_precio")
    .select("id, nombre, tipo_alcance, alcance_valor, tipo_operacion, campo_objetivo, valor, estado, creado_en, revertido_en, cantidad_afectada", { count: "exact" })
    .order("creado_en", { ascending: false }).order("id").range(desde, hasta));

  if (lotesError || !lotes) {
    return { error: "No se pudo cargar el historial de ajustes." };
  }

  if (lotes.length === 0) return { data: [] };

  const loteIds = lotes.map((l) => l.id);
  const { data: filasVariante, error: variantesError } = await leerPorIds(loteIds, (ids, desde, hasta) => supabase
    .from("actualizaciones_precio_items").select("lote_id", { count: "exact" })
    .in("lote_id", ids).not("variante_id", "is", null).order("id").range(desde, hasta));
  if (variantesError) return { error: variantesError };

  const variantesPorLote = new Map<string, number>();
  (filasVariante || []).forEach((f) => {
    variantesPorLote.set(f.lote_id, (variantesPorLote.get(f.lote_id) || 0) + 1);
  });

  const data: AjustePrecioHistorialItem[] = lotes.map((lote) => {
    const variantesAfectadas = variantesPorLote.get(lote.id) || 0;
    return {
      id: lote.id,
      nombre: lote.nombre,
      tipo_alcance: lote.tipo_alcance as AlcancePrecio,
      alcance_valor: lote.alcance_valor,
      tipo_operacion: lote.tipo_operacion as OperacionPrecio,
      campo_objetivo: lote.campo_objetivo as CampoObjetivo,
      valor: Number(lote.valor),
      estado: lote.estado,
      creado_en: lote.creado_en,
      revertido_en: lote.revertido_en,
      productosAfectados: lote.cantidad_afectada ?? 0,
      variantesAfectadas,
      tieneAuditoriaVariantes: variantesAfectadas > 0,
    };
  });

  return { data };
}

// 4. PREVISUALIZAR REVERSIÓN DE UN LOTE
export async function previsualizarRevertirPreciosAction(
  loteId: string,
): Promise<
  { preview: RevertirPreviewItem[]; error?: undefined } | { error: string }
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!(await esUsuarioAdmin(supabase))) {
    return {
      error: "Solo un administrador puede revertir un ajuste de precios.",
    };
  }

  const { data: items, error: fetchError } = await leerCompleto("Revertir precios", (desde, hasta) => supabase
    .from("actualizaciones_precio_items")
    .select("producto_id, variante_id, costo_anterior, precio_anterior", { count: "exact" })
    .eq("lote_id", loteId).order("id").range(desde, hasta));

  if (fetchError || !items || items.length === 0)
    return {
      error: "No se encontraron los datos de este ajuste para previsualizar.",
    };

  const productoIds = [...new Set(items.map((i) => i.producto_id))];
  const varianteIds = items
    .filter((i) => i.variante_id)
    .map((i) => i.variante_id as string);

  const { data: productos, error: productosError } = await leerPorIds(productoIds, (ids, desde, hasta) => supabase
    .from("productos").select("id, nombre, precio, precio_costo", { count: "exact" })
    .in("id", ids).order("id").range(desde, hasta));
  const { data: variantes, error: variantesError } = await leerPorIds(varianteIds, (ids, desde, hasta) => supabase
    .from("producto_variantes").select("id, nombre_display, precio, costo", { count: "exact" })
    .in("id", ids).order("id").range(desde, hasta));
  if (productosError || variantesError) return { error: productosError || variantesError || "No se pudieron leer los precios." };

  const productosMap = new Map((productos || []).map((p) => [p.id, p]));
  const variantesMap = new Map((variantes || []).map((v) => [v.id, v]));

  // `null` se conserva como null en toda la cadena: es "hereda del producto",
  // y aplastarlo contra 0 le haría prometer a la pantalla de confirmación que
  // el precio va a quedar en cero.
  const aNumero = (valor: unknown): number | null =>
    valor === null || valor === undefined ? null : Number(valor);

  const preview: RevertirPreviewItem[] = items.map((item) => {
    const producto = productosMap.get(item.producto_id);
    const precioAlRevertir = aNumero(item.precio_anterior);
    const costoAlRevertir = aNumero(item.costo_anterior);

    if (item.variante_id) {
      const variante = variantesMap.get(item.variante_id);
      const precioActual = aNumero(variante?.precio);
      const costoActual = aNumero(variante?.costo);
      return {
        producto_id: item.producto_id,
        variante_id: item.variante_id,
        nombre: `${producto?.nombre ?? "Producto eliminado"} — ${variante?.nombre_display ?? "variante eliminada"}`,
        precio_actual: precioActual,
        precio_al_revertir: precioAlRevertir,
        costo_actual: costoActual,
        costo_al_revertir: costoAlRevertir,
        cambia:
          precioActual !== precioAlRevertir || costoActual !== costoAlRevertir,
      };
    }

    // Un PRODUCTO siempre tiene precio propio: acá el 0 sí es un 0.
    const precioActual = Number(producto?.precio) || 0;
    const costoActual = Number(producto?.precio_costo) || 0;
    return {
      producto_id: item.producto_id,
      variante_id: null,
      nombre: producto?.nombre ?? "Producto eliminado",
      precio_actual: precioActual,
      precio_al_revertir: precioAlRevertir,
      costo_actual: costoActual,
      costo_al_revertir: costoAlRevertir,
      cambia:
        precioActual !== precioAlRevertir || costoActual !== costoAlRevertir,
    };
  });

  return { preview };
}

// 5. DESHACER LOTE (ROLLBACK)
export async function revertirPreciosAction(loteId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!(await esUsuarioAdmin(supabase))) {
    return {
      error: "Solo un administrador puede revertir un ajuste de precios.",
    };
  }

  const { error } = await supabase.rpc("revertir_ajuste_precios", { p_lote_id: loteId });
  if (error) return { error: error.message };

  revalidatePath("/stock");
  // Revertir devuelve los precios anteriores, así que la vidriera también
  // tiene que volver atrás. Mismo motivo que en aplicarPreciosAction.
  revalidatePath("/store", "layout");
  await invalidarCatalogoDeSesion(supabase);
  return { success: true };
}
