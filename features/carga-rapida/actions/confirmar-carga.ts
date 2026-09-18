"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidarCatalogoDeSesion } from "@/shared/lib/cache-catalogo";
import { crearProductoAction } from "@/features/stock/actions/create-product";
import { buildVariantKey } from "@/features/stock/utils/parse-legacy-variant";
import type { Opcion, VarianteInput } from "@/features/stock/types";
import { normalizarUnidadMedida } from "@/shared/lib/fiscal-producto";
import { etiquetaDeAtributoInline } from "@/features/carga-rapida/lib/atributos-inline-por-rubro";
import { normalizarCantidadVendible } from "@/shared/lib/unidad-venta";
import {
  cantidadBase,
  normalizarCantidadEnForma,
} from "@/shared/lib/presentaciones";
import type {
  ConfirmarCargaResponse,
  LineaCarga,
  LineaCargaExistente,
  ResultadoLineaCarga,
} from "@/features/carga-rapida/types";

type SupabaseDb = ReturnType<typeof createClient>;

// La cantidad se valida contra la unidad de la línea con el MISMO criterio
// que la venta (`normalizarCantidadVendible`): por kilo admite 0,250, por
// unidad no. La unidad de una línea EXISTENTE viene del cliente y no se
// vuelve a leer del catálogo a propósito: es stock que ENTRA, no plata, y el
// peor caso es un decimal en un producto por unidad, que se muestra igual.
function cantidadInvalida(cantidad: unknown, unidad: unknown): string | null {
  return normalizarCantidadVendible(cantidad, unidad) === null
    ? "La cantidad tiene que ser mayor a 0 (y entera si se vende por unidad)."
    : null;
}

function validarLinea(linea: LineaCarga): string | null {
  if (linea.kind === "EXISTENTE") {
    // Con presentación la cantidad es entera; el factor real se lee de la
    // base al procesar, acá solo importa la forma.
    return normalizarCantidadEnForma(
      linea.cantidad,
      linea.unidadMedida,
      linea.presentacionId ? { factor: 1 } : null,
    ) === null
      ? "La cantidad tiene que ser mayor a 0 (y entera si se vende por unidad o por presentación)."
      : null;
  }

  if (!linea.nombre.trim()) return "Falta el nombre del producto.";
  // El costo es OPCIONAL: se puede cargar un producto para poder cobrarlo ya
  // y completarlo después. Sin costo el margen reportado de esa venta sale
  // 100% hasta que se cargue, y por eso la fila queda marcada en la lista.
  // Lo que no puede faltar es el precio de venta: sin eso no hay qué cobrar.
  if (!Number.isFinite(linea.precioCompra) || linea.precioCompra < 0) {
    return "El precio de compra no puede ser negativo.";
  }
  if (!Number.isFinite(linea.precioVenta) || linea.precioVenta <= 0) {
    return "El precio de venta tiene que ser mayor a 0.";
  }
  if (linea.tieneVariantes) {
    if (linea.opciones.length === 0 || linea.variantes.length === 0) {
      return "Las variantes no tienen propiedades o valores válidos.";
    }
  } else {
    return cantidadInvalida(linea.cantidad, linea.unidadMedida);
  }
  return null;
}

// El espejo legacy productos_stock no tiene variante_id — se sincroniza
// por (producto_id, nombre de variante), mismo patrón que actualizarStock
// en features/purchases/actions/merge-purchase.ts. Un fallo acá es drift
// del espejo, no motivo para reportar la línea como fallida: el stock
// canónico (producto_variantes.stock) ya quedó bien vía la RPC atómica.
async function sincronizarStockLegacy(
  supabase: SupabaseDb,
  linea: LineaCargaExistente,
  delta: number,
) {
  try {
    const { data: stockExistente, error: stockSelectError } = await supabase
      .from("productos_stock")
      .select("id, cantidad")
      .eq("producto_id", linea.productoId)
      .eq("variante", linea.nombreDisplay)
      .maybeSingle();

    if (stockSelectError) throw stockSelectError;

    if (stockExistente) {
      const { error } = await supabase
        .from("productos_stock")
        .update({
          cantidad: Number(stockExistente.cantidad || 0) + delta,
        })
        .eq("id", stockExistente.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("productos_stock").insert({
        producto_id: linea.productoId,
        variante: linea.nombreDisplay,
        cantidad: delta,
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error(
      `[CARGA RAPIDA] No se pudo sincronizar productos_stock para "${linea.nombreDisplay}":`,
      err,
    );
  }
}

async function procesarLineaExistente(
  supabase: SupabaseDb,
  linea: LineaCargaExistente,
): Promise<ResultadoLineaCarga> {
  // Cuánto stock entra. Con presentación ("3 baldes") es cantidad × factor, y
  // el factor se lee de la BASE por id, nunca del cliente: mismo criterio que
  // el precio en la venta. La RLS filtra por negocio, así que un id ajeno o
  // borrado vuelve vacío y la línea falla con nombre en vez de cargar 3 kg
  // donde iban 14,1.
  let delta = linea.cantidad;
  if (linea.presentacionId) {
    const { data: presentacion, error } = await supabase
      .from("producto_presentaciones")
      .select("id, factor, activa")
      .eq("id", linea.presentacionId)
      .eq("producto_id", linea.productoId)
      .maybeSingle();
    if (error || !presentacion || !presentacion.activa) {
      return {
        clienteLineaId: linea.clienteLineaId,
        ok: false,
        error: "Esa presentación ya no existe: cargá la cantidad en la unidad base.",
      };
    }
    delta = cantidadBase(linea.cantidad, Number(presentacion.factor));
    if (delta <= 0) {
      return {
        clienteLineaId: linea.clienteLineaId,
        ok: false,
        error: "La cantidad de presentaciones tiene que ser mayor a 0.",
      };
    }
  }

  const { data: ajustado, error: ajusteError } = await supabase.rpc(
    "ajustar_stock_variante",
    {
      p_variante_id: linea.varianteId,
      p_delta: delta,
      p_origen: "CARGA_RAPIDA",
    },
  );

  if (ajusteError || !ajustado || ajustado.length === 0) {
    return {
      clienteLineaId: linea.clienteLineaId,
      ok: false,
      error: "La variante ya no existe en el catálogo.",
    };
  }

  await sincronizarStockLegacy(supabase, linea, delta);

  return {
    clienteLineaId: linea.clienteLineaId,
    ok: true,
    // El stock sale de lo que devolvió la RPC (el valor YA ajustado), no de
    // sumar en el cliente: es el único número que refleja lo que quedó en la
    // base si otra caja tocó la misma variante en el medio.
    cargado: {
      id: linea.productoId,
      nombre: linea.nombreProducto,
      tipo: "",
      precio: linea.precioVenta,
      unidad_medida: linea.unidadMedida,
      variantes: [
        {
          id: linea.varianteId,
          nombre_display: linea.nombreDisplay,
          precio: linea.precioVenta,
          stock: Number(ajustado[0]?.stock ?? delta),
        },
      ],
      presentaciones: linea.presentaciones,
    },
  };
}

/**
 * Atributos cargados inline en una línea simple (talle y color en
 * indumentaria, peso en un kiosco…): se convierten en UNA combinación
 * (opciones + una variante), que es la misma forma que manda el modal de alta
 * y el prefill del maestro.
 *
 * Se hace acá y no en el cliente para que exista UN solo lugar que decida
 * cómo se escribe un atributo tipeado al vuelo. El nombre del atributo sale
 * de la clave de planilla (`etiquetaDeAtributoInline`), y la canonicalización
 * de ese nombre y de sus valores la sigue haciendo crearProductoAction
 * (construirCacheAtributos), igual que en el alta completa: acá solo se arma
 * el payload.
 *
 * Devuelve null cuando la línea no trae ninguno — ahí sigue siendo un
 * producto "Único" con stock a nivel línea, exactamente como antes.
 */
function variantesDesdeAtributosInline(
  linea: Extract<LineaCarga, { kind: "NUEVA"; tieneVariantes: false }>,
): { opciones: Opcion[]; variantes: VarianteInput[] } | null {
  const entradas: [string, string][] = Object.entries(linea.atributos ?? {})
    .filter(([, valor]) => valor?.trim())
    .map(([clave, valor]) => [etiquetaDeAtributoInline(clave), valor.trim()]);
  if (entradas.length === 0) return null;

  const valores = Object.fromEntries(entradas);

  return {
    opciones: entradas.map(([nombre, valor]) => ({
      id: crypto.randomUUID(),
      nombre,
      valores: [valor],
    })),
    variantes: [
      {
        key: buildVariantKey(valores),
        valores,
        // Vacíos: la variante hereda el precio y el costo del producto, que
        // son los que se cargaron inline en la fila.
        precio: "",
        precio_costo: "",
        stock: String(linea.cantidad),
        sku: linea.codigo ?? "",
      },
    ],
  };
}

async function procesarLineaNueva(
  linea: Extract<LineaCarga, { kind: "NUEVA" }>,
): Promise<ResultadoLineaCarga> {
  const formData = new FormData();
  formData.set("nombre", linea.nombre);
  formData.set("sku", linea.codigo ?? "");
  formData.set("marca", linea.marca ?? "");
  formData.set("modelo", linea.modelo ?? "");
  // Referencia al Catálogo Maestro. Los datos ya viajan copiados en los
  // campos de arriba — esto es solo trazabilidad.
  formData.set("id_master", linea.idMaster ?? "");
  formData.set("categoria_id", linea.categoriaId ?? "");
  formData.set("descripcion", "");
  // Sin esto `crearProductoAction` cae al default del rubro (UNIDAD) y la
  // crema queda para venderse de a una, no de a 0,250 kg.
  formData.set("unidad_medida", normalizarUnidadMedida(linea.unidadMedida));
  formData.set("precio", String(linea.precioVenta));
  formData.set("precio_costo", String(linea.precioCompra));
  // Una línea simple con talle o color deja de ser simple: se manda como
  // combinación única, con el mismo payload que el alta completa.
  const desdeAtributos = linea.tieneVariantes
    ? null
    : variantesDesdeAtributosInline(linea);

  if (linea.tieneVariantes || desdeAtributos) {
    const { opciones, variantes } = linea.tieneVariantes
      ? linea
      : desdeAtributos!;
    formData.set("tieneVariantes", "true");
    formData.set("opciones", JSON.stringify(opciones));
    formData.set("variantes", JSON.stringify(variantes));
  } else {
    formData.set("tieneVariantes", "false");
    formData.set("stockBase", String(linea.cantidad));
  }

  const res = await crearProductoAction(
    { error: null, success: false },
    formData,
  );

  if (!res.success) {
    return {
      clienteLineaId: linea.clienteLineaId,
      ok: false,
      error: res.error || "No se pudo crear el producto.",
    };
  }

  return {
    clienteLineaId: linea.clienteLineaId,
    ok: true,
    cargado: res.producto,
  };
}

// Confirma toda la carga de Carga Rápida. Cada línea es independiente a
// propósito: si una falla (ej. la variante fue borrada en el medio por
// otra pestaña), las demás NO se revierten — diverge del patrón de
// rollback global de create-sale.ts por pedido explícito.
export async function confirmarCargaAction(
  lineas: LineaCarga[],
): Promise<ConfirmarCargaResponse & { error: string | null }> {
  if (!lineas.length) {
    return {
      error: "No hay líneas para confirmar.",
      resultados: [],
      totalOk: 0,
      totalError: 0,
    };
  }

  for (const linea of lineas) {
    const motivo = validarLinea(linea);
    if (motivo) {
      return { error: motivo, resultados: [], totalOk: 0, totalError: 0 };
    }
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const resultados: ResultadoLineaCarga[] = [];

  for (const linea of lineas) {
    try {
      const resultado =
        linea.kind === "EXISTENTE"
          ? await procesarLineaExistente(supabase, linea)
          : await procesarLineaNueva(linea);
      resultados.push(resultado);
    } catch (err) {
      console.error("[CARGA RAPIDA] Error procesando línea:", err);
      resultados.push({
        clienteLineaId: linea.clienteLineaId,
        ok: false,
        error: "Error inesperado al procesar esta línea.",
      });
    }
  }

  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  await invalidarCatalogoDeSesion(supabase);

  const totalOk = resultados.filter((r) => r.ok).length;
  const totalError = resultados.length - totalOk;

  return { error: null, resultados, totalOk, totalError };
}
