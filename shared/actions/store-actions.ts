"use server";

import { createPublicClient } from "@/shared/config/supabase/server";
import { Producto } from "@/entities/productos/types";
import { RUBRO_DEFAULT, type Rubro } from "@/entities/config/types";
import {
  anotarStockDisponible,
  contarReservasActivasPorVariante,
} from "@/entities/productos/lib/stock-disponible";
import {
  COLUMNAS_CATEGORIA_PUBLICA,
  COLUMNAS_PRODUCTO_LISTA,
  COLUMNAS_PRODUCTO_PUBLICO,
  COLUMNAS_VARIANTE_PUBLICA,
} from "@/shared/lib/columnas-publicas";
import { traerTodo } from "@/shared/lib/traer-todo";

/**
 * Catálogo de productos.
 *
 * `conCostos` parte en dos lo que antes era una sola consulta para dos
 * consumidores muy distintos: la vidriera pública (anon, cualquier visitante)
 * y la terminal VENDER (authenticated, gente del comercio). El costo y el
 * margen son del comercio: en la tienda no se piden — y desde
 * 20260811140000 anon tampoco los tiene concedidos en la base, así que
 * pedirlos sería un 403, no un dato de más.
 *
 * Que el POS los reciba es solo para mostrarlos: el costo que PERSISTE en la
 * venta lo resuelve create-sale.ts contra la base, nunca desde este payload.
 */
type ClienteSupabase = Awaited<ReturnType<typeof createPublicClient>>;

/**
 * El fetch en sí, con el cliente inyectado.
 *
 * Está separado de `getProductosAction` para que la versión CACHEADA del
 * catálogo público (shared/lib/cache-catalogo.ts) pueda reusar exactamente esta
 * consulta sin arrastrar el `createPublicClient()` de adentro, que lee
 * `headers()` — y adentro de `unstable_cache` eso no se puede.
 *
 * Dos caminos, una sola consulta: si divergen, el POS y la vidriera empiezan a
 * mostrar cosas distintas del mismo producto.
 */
export async function traerProductosPublicos(
  supabase: ClienteSupabase,
  { conCostos = false } = {},
) {
  // Las dos variantes van escritas enteras y se elige una: el parser de tipos
  // de supabase-js resuelve el select en compilación y necesita un literal.
  // Con las columnas concatenadas en una variable ve una unión y da ParserError.
  //
  // Ojo con lo que NO está: el embed `stock:productos_stock(...)`. Es el espejo
  // legacy, y `producto_variantes.stock` —que ya viene acá— es la fuente
  // canónica, así que era una segunda copia del mismo dato: 85 KB comprimidos
  // por carga de catálogo, el 28% del payload. Los consumidores lo leen con
  // `p.stock?.` como fallback para productos sin variantes, y no queda ninguno:
  // de 1.727 publicados hay 7 sin variantes y ninguno tiene filas en el espejo.
  // La vidriera pide MENOS columnas que la ficha: ver COLUMNAS_PRODUCTO_LISTA.
  // Este array se serializa entero al cliente, así que acá una columna de más
  // se paga 1.183 veces en el catálogo más grande.
  const SELECT_PUBLICO = `${COLUMNAS_PRODUCTO_LISTA}, producto_variantes(${COLUMNAS_VARIANTE_PUBLICA})`;
  const SELECT_CON_COSTOS = `${COLUMNAS_PRODUCTO_PUBLICO}, precio_costo, producto_variantes(${COLUMNAS_VARIANTE_PUBLICA}, costo)`;

  // Sin paginar, con 1.116 productos publicados PostgREST devolvía 1.000 y los
  // 116 más viejos desaparecían del catálogo Y del POS sin un error ni un log —
  // invendibles, porque tampoco salían en la búsqueda de la terminal. Ordenado
  // por `creado_en` desc, lo que se cae es siempre lo más viejo: el síntoma era
  // "faltan las camperas de invierno".
  const [{ data: filas, error, total }, { data: reservasActivas }] =
    await Promise.all([
      traerTodo("catálogo público", (desde, hasta) => {
        const consulta = conCostos
          ? supabase
              .from("productos")
              .select(SELECT_CON_COSTOS, { count: "exact" })
          : supabase
              .from("productos")
              .select(SELECT_PUBLICO, { count: "exact" });

        return consulta
          .eq("publicado", true)
          .eq("producto_variantes.activa", true)
          .order("creado_en", { ascending: false })
          .range(desde, hasta);
      }),
      supabase.from("reservas").select("variante_id").eq("estado", "ACTIVA"),
    ]);

  if (error) {
    return { data: null, error: "No se pudo cargar el catálogo.", total: 0 };
  }

  const reservasPorVariante = contarReservasActivasPorVariante(reservasActivas);
  const productos = (filas as Producto[]).map((p) => ({
    ...p,
    producto_variantes: anotarStockDisponible(
      p.producto_variantes,
      reservasPorVariante,
    ),
  }));

  return { data: productos, error: null, total };
}

export async function getProductosAction({ conCostos = false } = {}) {
  const supabase = await createPublicClient();
  return traerProductosPublicos(supabase, { conCostos });
}

/**
 * Los "también te puede gustar" de una ficha.
 *
 * Antes esto se resolvía trayendo TODO el catálogo y quedándose con 4:
 * `getProductosAction()` completo, con sus variantes, serializado en el HTML
 * de cada ficha de producto para mostrar cuatro tarjetas. La consulta acotada
 * hace exactamente lo mismo —mismo criterio, mismo orden de llegada— pidiendo
 * 4 filas.
 *
 * `tipo` es la categoría legacy de texto libre; se mantiene ese criterio a
 * propósito para no cambiar QUÉ se recomienda mientras se cambia CÓMO se
 * consigue.
 */
export async function getProductosSimilaresAction(
  tipo: string | null | undefined,
  excluirId: string,
  limite = 4,
) {
  if (!tipo) return { data: [], error: null };

  const supabase = await createPublicClient();
  const { data, error } = await supabase
    .from("productos")
    .select(`${COLUMNAS_PRODUCTO_LISTA}, producto_variantes(${COLUMNAS_VARIANTE_PUBLICA})`)
    .eq("publicado", true)
    .eq("tipo", tipo)
    .neq("id", excluirId)
    .order("creado_en", { ascending: false })
    .limit(limite);

  if (error) {
    console.error("[CATALOGO] No se pudieron traer los similares:", error);
    return { data: [], error: "No se pudieron cargar los productos similares." };
  }

  return { data: (data ?? []) as unknown as Producto[], error: null };
}

// El índice del catálogo para filtrar en el navegador vive en
// `shared/actions/indice-catalogo-publico.ts`: lee del MISMO cache por
// negocio que el render del server. Acá estaba antes, sin cache, y cada
// visitante bajaba el catálogo entero de Supabase otra vez.

// Combina productos + categorías + config para la terminal VENDER en un
// solo fetch client-side (React Query cachea esto con staleTime de 3 min).
export async function getPosCatalogDataAction() {
  const supabase = await createPublicClient();

  const [productosRes, categoriasRes, configRes] = await Promise.all([
    // Con costos: esto es la terminal del comercio, no la vidriera.
    getProductosAction({ conCostos: true }),
    supabase
      .from("categorias")
      .select(COLUMNAS_CATEGORIA_PUBLICA)
      .eq("activa", true)
      .order("orden", { ascending: true }),
    supabase
      .from("configuracion_pos")
      .select("permitir_venta_sin_stock, posName, mostrar_sin_stock, rubro")
      .single(),
  ]);

  if (productosRes.error) {
    return { data: null, error: productosRes.error };
  }

  return {
    data: {
      productos: productosRes.data ?? [],
      categorias: categoriasRes.data ?? [],
      permitirVentaSinStock: configRes.data?.permitir_venta_sin_stock ?? false,
      nombreComercio: configRes.data?.posName || "Tienda Online",
      mostrarSinStock: configRes.data?.mostrar_sin_stock ?? true,
      // Lo consume la Carga rápida invocada desde el POS.
      rubro: (configRes.data?.rubro as Rubro) ?? RUBRO_DEFAULT,
    },
    error: null,
  };
}

// 2. Obtener un producto usando su URL amigable (slug)
export async function getProductoBySlugAction(slug: string) {
  const supabase = await createPublicClient();

  const { data, error } = await supabase
    .from("productos")
    .select(
      `${COLUMNAS_PRODUCTO_PUBLICO}, stock:productos_stock(id, variante, cantidad), producto_variantes(${COLUMNAS_VARIANTE_PUBLICA})`,
    )
    .eq("slug", slug)
    .eq("publicado", true)
    .eq("producto_variantes.activa", true)
    .single();

  if (error) {
    console.error(`Error fetching producto by slug (${slug}):`, error);
    return { data: null, error: "No se encontró el producto solicitado." };
  }

  const varianteIds = (data.producto_variantes ?? []).map(
    (v: { id: string }) => v.id,
  );
  const { data: reservasActivas } =
    varianteIds.length > 0
      ? await supabase
          .from("reservas")
          .select("variante_id")
          .eq("estado", "ACTIVA")
          .in("variante_id", varianteIds)
      : { data: [] };

  const reservasPorVariante = contarReservasActivasPorVariante(reservasActivas);
  const producto: Producto = {
    ...(data as Producto),
    producto_variantes: anotarStockDisponible(
      data.producto_variantes,
      reservasPorVariante,
    ),
  };

  return { data: producto, error: null };
}
