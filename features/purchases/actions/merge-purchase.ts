"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ItemResuelto, SugerenciaSimilitud } from "@/entities/compras/types";
import { traerTodo } from "@/shared/lib/traer-todo";
import {
  resolverAudienciaCategoria,
  type CategoriaReal,
} from "../lib/resolve-import-categoria";
import { parseAttributeSegment } from "@/entities/productos/lib/parse-variant-attributes";
import {
  construirCacheAtributos,
  canonicalizarValores,
  type AtributoCache,
} from "@/features/stock/lib/normalize-atributo";
import { cantidadEfectiva, entraAlStock } from "../lib/recepcion";
import { normalizarImei } from "@/entities/ventas/imei";
import { inferirMarca } from "../lib/inferir-marca";

type SupabaseDb = ReturnType<typeof createClient>;

const NOMBRES_VARIANTE_UNICA = new Set(["unico", "único"]);

/**
 * Convierte el string crudo de variante (ej. "TALLE: S / COLOR: NEGRO") en
 * un objeto estructurado { Talle: "S", Color: "Negro" } para guardar en
 * `producto_variantes.atributos`, en vez de dejarlo vacío ({}).
 */
function parseVarianteAtributos(variante: string): Record<string, string> {
  const normalizado = variante.trim().toLowerCase();
  if (!normalizado || NOMBRES_VARIANTE_UNICA.has(normalizado)) {
    return {};
  }

  const segmentos = variante.split(" / ");
  const atributos: Record<string, string> = {};

  for (const segmento of segmentos) {
    const parsed = parseAttributeSegment(segmento);
    if (parsed) {
      atributos[parsed.nombre] = parsed.valor;
    }
  }

  return atributos;
}

type SupabaseActionError = {
  message?: string;
  details?: string | null;
  code?: string | null;
};

function formatSupabaseError(error: SupabaseActionError | null | undefined) {
  if (!error) return "Error desconocido";
  return [error.message, error.details, error.code].filter(Boolean).join(" | ");
}

function throwIfSupabaseError(
  context: string,
  error: SupabaseActionError | null | undefined,
) {
  if (!error) return;

  console.error(`[PURCHASE MERGE] ${context}:`, JSON.stringify(error, null, 2));
  throw new Error(`${context}: ${formatSupabaseError(error)}`);
}

// 1. Obtener los datos para la pantalla de Merge
export async function getOrdenParaMergeAction(ordenId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [ordenRes, itemsRes, productosRes, categoriasRes] = await Promise.all([
    supabase.from("ordenes_compra").select("*").eq("id", ordenId).single(),
    supabase.from("ordenes_items").select("*").eq("orden_id", ordenId),
    // Paginado: es el catálogo contra el que se sugieren los matches del
    // remito. Truncado al tope de PostgREST, lo que quedó afuera se ofrece como
    // "producto nuevo" y termina duplicado.
    // Se lee la VISTA y no la tabla: `productos.precio` es el de cabecera, y
    // en 30 productos de los cuatro negocios no es el que se cobra — gana el
    // de la variante. Calcular el markup anterior contra la cabecera hacía
    // "conservar" un margen sacado de un precio que no existe. Ver
    // 20260908180000. Mismas columnas más tres; misma cantidad de filas.
    traerTodo("merge: productos", (desde, hasta) =>
      supabase
        .from("productos_precio_efectivo")
        .select(
          "id, nombre, precio, precio_costo, tipo, precio_efectivo, costo_efectivo, precios_dispares",
          { count: "exact" },
        )
        .eq("publicado", true)
        .range(desde, hasta),
    ),
    traerTodo("merge: categorías", (desde, hasta) =>
      supabase
        .from("categorias")
        .select("id, nombre, slug, parent_id", { count: "exact" })
        .range(desde, hasta),
    ),
  ]);

  if (ordenRes.error || !ordenRes.data) {
    return {
      error: ordenRes.error
        ? `Orden no encontrada: ${formatSupabaseError(ordenRes.error)}`
        : "Orden no encontrada.",
      orden: null,
      items: [],
      productos: [],
      sugerenciasSimilitud: [],
      categorias: [],
      borrador: null,
      serie: { categorias: [] as string[], productos: [] as string[] },
    };
  }

  if (itemsRes.error) {
    return {
      error: `No se pudieron leer los items del remito: ${formatSupabaseError(itemsRes.error)}`,
      orden: null,
      items: [],
      productos: [],
      sugerenciasSimilitud: [],
      categorias: [],
      borrador: null,
      serie: { categorias: [] as string[], productos: [] as string[] },
    };
  }

  if (productosRes.error) {
    return {
      error: `No se pudieron leer los productos para conciliar: ${productosRes.error}`,
      orden: null,
      items: [],
      productos: [],
      sugerenciasSimilitud: [],
      categorias: [],
      borrador: null,
      serie: { categorias: [] as string[], productos: [] as string[] },
    };
  }

  // Candidatos de "posible match" (similitud de texto) para los ítems sin
  // match exacto — batched en un solo RPC, no uno por fila. No es
  // bloqueante: si falla (extensión no disponible, timeout), la pantalla
  // sigue funcionando en modo "sin sugerencias" (todo queda Ambiguo) en vez
  // de romper toda la conciliación.
  const rawNombresDesconocidos = Array.from(
    new Set(
      (itemsRes.data || [])
        .filter((item) => item.estado_match === "DESCONOCIDO")
        .map((item) => item.raw_nombre),
    ),
  );

  let sugerenciasSimilitud: SugerenciaSimilitud[] = [];
  if (rawNombresDesconocidos.length > 0) {
    const { data: similaresData, error: similaresError } = await supabase.rpc(
      "sugerir_productos_similares",
      { p_raw_nombres: rawNombresDesconocidos },
    );

    if (similaresError) {
      console.error(
        "[PURCHASE MERGE] Error obteniendo sugerencias de similitud:",
        JSON.stringify(similaresError, null, 2),
      );
    } else {
      sugerenciasSimilitud = (similaresData as SugerenciaSimilitud[]) || [];
    }
  }

  // Filtro de audiencia/marca: la similitud de texto sola no distingue
  // "Remera Nene" de "Remera Beba" ni una marca de otra si comparten
  // palabras genéricas ("remera", "estampada"). Si la fila importada ya
  // resolvió categoría (raw_categoria_id) o trae marca, un candidato con
  // audiencia o marca CONOCIDA y DISTINTA se descarta directo — no
  // debería competir como "posible match". No bloqueante: si no hay
  // árbol de categorías disponible, sigue sin filtrar en vez de romper.
  if (sugerenciasSimilitud.length > 0 && !categoriasRes.error) {
    const categoriasReales: CategoriaReal[] = categoriasRes.data || [];
    const baselinePorRawNombre = new Map<
      string,
      { categoriaId: string | null; marca: string | null }
    >();
    for (const item of itemsRes.data || []) {
      if (baselinePorRawNombre.has(item.raw_nombre)) continue;
      baselinePorRawNombre.set(item.raw_nombre, {
        categoriaId: item.raw_categoria_id ?? null,
        marca: item.raw_marca ?? null,
      });
    }

    sugerenciasSimilitud = sugerenciasSimilitud.filter((s) => {
      const baseline = baselinePorRawNombre.get(s.raw_nombre);
      if (!baseline) return true;

      if (baseline.categoriaId && s.categoria_id) {
        const audienciaFila = resolverAudienciaCategoria(
          baseline.categoriaId,
          categoriasReales,
        );
        const audienciaCandidato = resolverAudienciaCategoria(
          s.categoria_id,
          categoriasReales,
        );
        if (
          audienciaFila &&
          audienciaCandidato &&
          audienciaFila !== audienciaCandidato
        ) {
          return false;
        }
      }

      if (baseline.marca && s.marca) {
        if (
          baseline.marca.trim().toLowerCase() !== s.marca.trim().toLowerCase()
        ) {
          return false;
        }
      }

      return true;
    });
  } else if (categoriasRes.error) {
    console.error(
      "[PURCHASE MERGE] Error obteniendo categorías para filtrar sugerencias:",
      JSON.stringify(categoriasRes.error, null, 2),
    );
  }

  // El borrador del modo carga inicial vive en la base, no en el navegador
  // (ver 20260904120000). Se lee acá y no en un round-trip aparte del cliente:
  // la pantalla no puede pintar filas vacías y después reemplazarlas.
  //
  // En el mismo viaje: qué lleva IMEI (para pedir los que faltan) y cómo
  // escribe el comercio las marcas que se van a deducir del nombre.
  const items: ItemResuelto[] = itemsRes.data || [];
  const marcasADeducir = new Set<string>();
  for (const item of items) {
    if (item.raw_marca?.trim()) continue;
    const marca = inferirMarca(item.raw_nombre);
    if (marca) marcasADeducir.add(marca);
  }
  const productoIds = (productosRes.data || []).map((p) => p.id as string);

  const [borradorRes, categoriasSerieRes, productosSerieRes, marcasRes] =
    await Promise.all([
      supabase
        .from("ordenes_borradores")
        .select("payload, actualizado_en")
        .eq("orden_id", ordenId)
        .maybeSingle(),
      supabase.rpc("categorias_llevan_serie"),
      productoIds.length > 0
        ? supabase.rpc("productos_llevan_serie", { p_producto_ids: productoIds })
        : Promise.resolve({ data: [], error: null }),
      marcasADeducir.size > 0
        ? supabase
            .from("productos")
            .select("marca")
            // ilike sin comodines = igual sin importar mayúsculas.
            .or(
              Array.from(marcasADeducir)
                .map((m) => `marca.ilike.${m}`)
                .join(","),
            )
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);

  // Lo de IMEI no bloquea la pantalla: sin esto no se piden en la
  // conciliación, pero el POS los sigue pidiendo al vender.
  if (categoriasSerieRes.error || productosSerieRes.error) {
    console.error(
      "[PURCHASE MERGE] Error leyendo qué lleva IMEI:",
      categoriasSerieRes.error ?? productosSerieRes.error,
    );
  }
  const serie = {
    categorias: ((categoriasSerieRes.data ?? []) as { categoria_id: string }[]).map(
      (r) => r.categoria_id,
    ),
    productos: ((productosSerieRes.data ?? []) as { producto_id: string }[]).map(
      (r) => r.producto_id,
    ),
  };

  const marcasExistentes = Array.from(
    new Set(
      ((marcasRes.data ?? []) as { marca: string | null }[])
        .map((r) => r.marca?.trim())
        .filter((m): m is string => Boolean(m)),
    ),
  );
  const itemsConMarca = items.map((item) =>
    item.raw_marca?.trim()
      ? item
      : { ...item, marca_inferida: inferirMarca(item.raw_nombre, marcasExistentes) },
  );

  return {
    error: null,
    orden: ordenRes.data,
    items: itemsConMarca,
    serie,
    productos: productosRes.data || [],
    sugerenciasSimilitud,
    // Las categorías del comercio ya se leyeron acá arriba para filtrar las
    // sugerencias por audiencia; el modo carga inicial las necesita para el
    // select de cada fila. Sin esto llegaban vacías y el desplegable se abría
    // sin una sola opción — se veía como un select que no responde.
    categorias: categoriasRes.data || [],
    borrador: borradorRes.data ?? null,
  };
}

// `crearProductoAlVueloAction` se eliminó el 6/10/2026: creaba productos sin
// idempotencia y la pantalla lo envolvía en un timeout que fabricaba
// duplicados. La conciliación crea con `crearProductosDesdeRemitoAction`.

/**
 * Los guards de `aprobar_orden_compra` (20261006130000) traducidos para el
 * dueño. null = no es uno de estos, se muestra el error crudo.
 */
function mensajeGuardRemito(mensaje: string | undefined): string | null {
  if (!mensaje) return null;
  if (mensaje.includes("REMITO_LINEAS_FALTANTES")) {
    return "Faltan renglones del remito en esta pantalla, y no entrarían al stock. Recargá la página y volvé a aprobar.";
  }
  if (mensaje.includes("REMITO_LINEAS_INVALIDAS")) {
    return "La lista de renglones no coincide con el remito (hay repetidos o de otro remito). Recargá la página y volvé a aprobar.";
  }
  if (mensaje.includes("SIN_PERMISO")) {
    return "Tu usuario no tiene permiso para ingresar mercadería. Pedíselo al dueño del comercio.";
  }
  if (mensaje.includes("REMITO_CANTIDAD_INVALIDA")) {
    return "Hay renglones sin cantidad o con cantidad negativa. Corregilos y volvé a aprobar.";
  }
  if (mensaje.includes("REMITO_IMEIS_DE_MAS")) {
    const detalle = mensaje.split("unidades:")[1]?.trim();
    return `Hay renglones con más IMEI que unidades${detalle ? `: ${detalle}` : ""}. Sacá los que sobran y volvé a aprobar.`;
  }
  return null;
}

// 2. Aprobar e Impactar la Orden en la BD (Agrupada y Optimizada)
export async function aprobarOrdenAction(
  ordenId: string,
  proveedor: string,
  itemsResueltos: ItemResuelto[],
) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  try {
    // Un solo barrido para juntar todos los valores de atributo del remito y
    // resolver el cache de canonicalización de una sola vez.
    const valoresPorPropiedad: Record<string, Set<string>> = {};
    for (const item of itemsResueltos) {
      if (!item.producto_id || !entraAlStock(item)) continue;
      const variante = item.variante_match || item.raw_variante || "Unico";
      const atributosRaw = parseVarianteAtributos(variante);
      Object.entries(atributosRaw).forEach(([nombre, valor]) => {
        if (!valoresPorPropiedad[nombre])
          valoresPorPropiedad[nombre] = new Set();
        valoresPorPropiedad[nombre].add(valor);
      });
    }
    const opcionesAtributos = Object.entries(valoresPorPropiedad).map(
      ([nombre, valores]) => ({ nombre, valores: Array.from(valores) }),
    );
    const atributoCache = await construirCacheAtributos(
      supabase,
      opcionesAtributos,
    );

    // El ciclo completo (precios + stock + alias + estado de la orden) corre
    // dentro de la RPC `aprobar_orden_compra`, en UNA transacción. Antes esto
    // era un for con await adentro: 4 round-trips por línea, ~1500 en el
    // remito más grande real (347 líneas) — de ahí el timeout de 300s.
    //
    // La canonicalización de atributos se queda acá a propósito: es la misma
    // que usa la creación manual de productos, y no se duplica en SQL. La
    // RPC recibe `atributos` ya canonicalizado.
    // El filtro de abajo descarta las líneas sin producto, y hacerlo en
    // silencio es lo que perdió 213 líneas / 416 unidades entre julio y agosto
    // de 2026: la orden quedaba APROBADA, la RPC nunca veía esas líneas y esa
    // mercadería no existía en el sistema — sin un solo error. Desde
    // `20260908130000` la RPC lo rechaza mirando `ordenes_items` (que es el
    // freno que cuenta, porque un server action es un endpoint), pero eso
    // llega como una excepción de Postgres arriba de todo. Acá se corta antes
    // y con los nombres puestos.
    // Solo cuenta lo que entra: un renglón marcado "no vino" (cantidad 0) no
    // necesita producto, y se manda igual para que quede registrado.
    const sinProducto = itemsResueltos.filter(
      (item) => !item.producto_id && entraAlStock(item),
    );
    if (sinProducto.length > 0) {
      const nombres = Array.from(
        new Set(sinProducto.map((item) => item.raw_nombre)),
      );
      const muestra = nombres.slice(0, 3).join(", ");
      return {
        error:
          `No se puede impactar: ${sinProducto.length} renglón(es) no están vinculados a ningún producto ` +
          `(${muestra}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ""}). ` +
          "Esa mercadería no entraría al stock. Vinculalos o creá el producto antes de aprobar.",
      };
    }

    // TODOS los renglones, también los que no vinieron: la RPC exige que la
    // orden viaje entera (`REMITO_LINEAS_FALTANTES`). Antes se filtraban los
    // sin producto, y un renglón que se caía de la lista no entraba al stock
    // sin un solo error.
    const itemsPayload = itemsResueltos.map((item) => {
        const variante = item.variante_match || item.raw_variante || "Unico";
        return {
          // Con esto la RPC puede escribir en la línea del remito a qué
          // producto fue. Sin `item_id`, `ordenes_items.producto_id` quedaba
          // null aunque el stock hubiera entrado, y el ingreso desaparecía del
          // historial de Movimientos de Stock.
          item_id: item.id ?? null,
          producto_id: item.producto_id,
          raw_nombre: item.raw_nombre,
          estado_match: item.estado_match,
          variante,
          atributos: canonicalizarValores(
            parseVarianteAtributos(variante),
            atributoCache,
          ),
          sku: item.raw_sku?.trim() || null,
          // Si la línea trae número de serie, la RPC crea la unidad en
          // `unidades_serie`. Es lo que permite que una planilla de electro
          // entre por conciliación sin perder los IMEI.
          imei: item.raw_imei?.trim() || null,
          // Los completados en pantalla para los aparatos que vinieron sin
          // número. La RPC crea una unidad por cada uno y frena si hay más
          // que unidades (`REMITO_IMEIS_DE_MAS`).
          imeis: (item.imeis_completados ?? [])
            .map((imei) => normalizarImei(imei))
            .filter(Boolean),
          // Lo que de verdad entró (corregido o "no vino"); la RPC lo compara
          // con lo del remito y guarda la diferencia con su motivo.
          cantidad: cantidadEfectiva(item),
          motivo_ajuste: item.motivo_ajuste ?? null,
          precio_costo: item.precio_costo ?? null,
          precio_venta_actualizado: item.precio_venta_actualizado ?? null,
        };
      });

    const { data: resultado, error: aprobarError } = await supabase.rpc(
      "aprobar_orden_compra",
      {
        p_orden_id: ordenId,
        p_proveedor: proveedor,
        p_items: itemsPayload,
      },
    );

    if (aprobarError) {
      const amigable = mensajeGuardRemito(aprobarError.message);
      if (amigable) return { error: amigable };
    }
    throwIfSupabaseError("Error impactando la orden", aprobarError);

    // La RPC es idempotente: si la orden ya estaba aprobada no tocó nada y
    // avisa por acá. NO es un error — es el resultado correcto de una
    // segunda aprobación (doble click, pestaña vieja, reintento después de
    // un timeout que en realidad había impactado). El cliente lo usa para
    // no ofrecer "Reintentar" sobre algo que ya está hecho.
    const impacto = resultado as {
      ya_aprobada?: boolean;
      variantes_conservadas?: number;
    } | null;

    const yaAprobada = impacto?.ya_aprobada === true;

    // Cuántas variantes se quedaron con SU precio en vez de tomar el del
    // remito. Desde 20260908190000 la RPC baja el precio nuevo a las variantes
    // cuyo precio propio era una copia del vigente; la que decía otra cosa se
    // respeta, y eso hay que decirlo. Sin este número, el producto queda con
    // un precio en /stock y otro en la caja y nadie se entera hasta la venta
    // —que es exactamente lo que reportó Evelyn el 8/9/2026—.
    const variantesConservadas = Number(impacto?.variantes_conservadas) || 0;

    revalidatePath("/stock");
    revalidatePath("/compras");

    return { success: true, yaAprobada, variantesConservadas };
  } catch (error) {
    console.error("Error al aprobar orden:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Hubo un error al impactar los datos en el sistema.",
    };
  }
}
