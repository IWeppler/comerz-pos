"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import {
  Producto,
  ProductoIndice,
  ProductoPanel,
} from "@/entities/productos/types";
import { normalizarRubro, type Rubro } from "@/entities/config/types";
import {
  anotarStockDisponible,
  contarReservasActivasPorVariante,
} from "@/entities/productos/lib/stock-disponible";
import { traerTodo } from "@/shared/lib/traer-todo";

/**
 * El catálogo con detalle, para el panel, /reportes y Carga Rápida.
 *
 * Ya NO trae `producto_variante_valores`. Era la relación normalizada de
 * atributos, embebida a dos niveles más (atributos + atributo_valores): 474 kB
 * de los 2,70 MB de Evens, sobre 6.485 filas. La lee `resolverAtributosVariante`
 * y SOLO cuando `producto_variantes.atributos` viene vacío — y medido sobre los
 * seis negocios, de 5.747 variantes hay CERO en ese estado (72 tienen
 * `atributos` vacío y ninguna de esas tiene fila en la relación, así que caen
 * al parseo de `nombre_display`, que sigue igual). O sea que el bloque no era
 * un fallback poco usado: no se leía nunca. Además ninguno de los consumidores
 * de ESTA consulta lo toca, ni siquiera por el fallback.
 *
 * El que SÍ lo necesita es `getStockDetalleProductoAction`, y lo conserva: el
 * formulario de edición pasa por `parseLegacyVariant`, que tiene la precedencia
 * AL REVÉS (prefiere la relación sobre `atributos`). Es un producto por vez.
 *
 * `stock:productos_stock` —el espejo legacy— se QUEDA acá, y es la sorpresa de
 * esta limpieza. En el catálogo público se pudo sacar porque nadie lo leía,
 * pero el panel lee el stock EXCLUSIVAMENTE de ahí, en cinco lugares:
 * `get-dashboard-metrics` (unidades y stock valorizado), `detectar-quiebres`
 * (dos veces, y una usa `s.variante`), `detectar-riesgo-categoria` y
 * `detectar-estacionalidad`. Ninguno mira `producto_variantes.stock`, que es la
 * fuente canónica. Sacarlo pondría en cero el stock valorizado y apagaría las
 * alertas sin un error.
 *
 * Que esos cinco lean el espejo es deuda aparte y hay que arreglarla, pero no
 * de prepo: espejo y canónica NO dicen lo mismo hoy. De 1.987 productos
 * coinciden 1.967 y difieren 20 (3 en Evens, 17 en Estilo Bonito, donde los
 * totales igual cierran porque los desvíos se compensan). Cambiar la fuente
 * mueve números del panel, así que es su propio cambio con su propia
 * verificación.
 */
export async function getStockAction(): Promise<{
  data: Producto[] | null;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Paginado: sin esto PostgREST corta en 1000 y la pantalla de stock miente
    // por omisión — muestra parte del catálogo como si fuera todo. Ver
    // shared/lib/traer-todo.ts.
    const [{ data, error }, { data: reservasActivas }] = await Promise.all([
      traerTodo("stock (detalle)", (desde, hasta) =>
        supabase
          .from("productos")
          .select(
            `
        id, nombre, tipo, precio, precio_costo, imagen_url, thumbnail_url, slug, publicado, descripcion, categoria_id, creado_en,
        categoria:categorias(id, nombre, slug),
        producto_variantes(
          id, sku, nombre_display, precio, costo, stock, atributos
        ),
        stock:productos_stock(id, variante, cantidad)
        `,
            { count: "exact" },
          )
          .order("creado_en", { ascending: false })
          .range(desde, hasta),
      ),
      supabase.from("reservas").select("variante_id").eq("estado", "ACTIVA"),
    ]);

    if (error) return { data: null, error: "Error al cargar." };

    const reservasPorVariante =
      contarReservasActivasPorVariante(reservasActivas);
    const productos = (data as unknown as Producto[]).map((p) => ({
      ...p,
      producto_variantes: anotarStockDisponible(
        p.producto_variantes,
        reservasPorVariante,
      ),
    }));

    return { data: productos, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: "Ocurrió un error inesperado." };
  }
}

/**
 * El catálogo para las MÉTRICAS del panel (`/`). Ver `ProductoPanel`.
 *
 * Es `getStockAction` sin lo que el panel no lee: variantes (3.873 filas con
 * su JSON de atributos en Evens), fotos en tres tamaños, slug, publicado y
 * descripción. Medido en la base sobre Evens, 16/9/2026: 2.348 kB contra
 * 772 kB, y el panel es la pantalla de entrada del comercio — se carga en
 * cada visita a `/`, 157 veces por día entre los negocios.
 *
 * Conserva el espejo legacy `stock:productos_stock` a propósito: es de donde
 * `getDashboardMetrics`, `detectarQuiebresRotacion`, `detectarCategoriasEnRiesgo`
 * y `detectarFinDeTemporada` sacan el stock. La deuda de leer la canónica en
 * vez del espejo está descripta en `getStockAction` y no se paga acá.
 *
 * `/reportes` y Carga Rápida siguen con `getStockAction`: la pestaña de
 * inventario de Reportes rinde `productosSinMovimiento` con la foto del
 * producto, y Carga Rápida necesita las variantes.
 */
export async function getProductosPanelAction(): Promise<{
  data: ProductoPanel[] | null;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await traerTodo("productos (panel)", (desde, hasta) =>
      supabase
        .from("productos")
        .select(
          `
        id, nombre, tipo, precio, precio_costo, categoria_id, creado_en, unidad_medida,
        categoria:categorias(id, nombre, slug),
        stock:productos_stock(id, variante, cantidad)
        `,
          { count: "exact" },
        )
        .order("creado_en", { ascending: false })
        .range(desde, hasta),
    );

    if (error) return { data: null, error: "Error al cargar." };

    return { data: data as unknown as ProductoPanel[], error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: "Ocurrió un error inesperado." };
  }
}

/**
 * El índice de /stock. Perdió los dos bloques duplicados: 2,54 MB a 1,91 MB.
 *
 * `producto_variante_valores` por el mismo motivo que en `getStockAction` (ver
 * ahí la medición). Acá el consumidor es `stock-view.tsx`, que es el ÚNICO
 * lugar del repo que pasa `incluirFallbackRelacional: true` — o sea que era el
 * único que podía llegar a leerlo, y no llega nunca porque ninguna variante
 * tiene `atributos` vacío con relación cargada.
 *
 * `stock:productos_stock(cantidad)` porque acá SÍ está muerto, al revés que en
 * `getStockAction`. Los dos caminos que podrían leerlo no lo hacen:
 * `buildPropiedadesFiltro` solo lo mira bajo `incluirStockLegacy`, que en los
 * dos call sites del repo se pasa explícitamente en `false`; y `getTotalStock`
 * lo toma como fallback de `producto_variantes` con un `||`, que sobre un array
 * vacío no cae — y PostgREST devuelve `[]`, nunca `undefined`, porque el embed
 * de variantes está siempre. Por si el `||` llegara a caer alguna vez: hay 9
 * productos sin variantes en los seis negocios y NINGUNO tiene fila en el
 * espejo, así que el fallback devolvería 0 con el bloque y sin él.
 */
export async function getStockIndexAction(): Promise<{
  data: ProductoIndice[] | null;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Paginado por el mismo motivo que getStockAction: este índice es LA lista
    // de productos de la pantalla /stock, y truncada al kilo hace que un
    // producto que existe parezca borrado.
    const { data, error } = await traerTodo("stock (índice)", (desde, hasta) =>
      supabase
        .from("productos")
        .select(
          `
        id, nombre, tipo, precio, precio_costo, categoria_id, marca, modelo,
        imagen_url, thumbnail_url, grid_url, slug, publicado, unidad_medida, destacado_en,
        categoria:categorias(id, nombre, slug),
        producto_variantes(
          id, sku, nombre_display, precio, costo, stock, atributos
        )
        `,
          { count: "exact" },
        )
        .order("creado_en", { ascending: false })
        .range(desde, hasta),
    );

    if (error) {
      return { data: null, error: "Error al cargar el índice de productos." };
    }

    return { data: data as unknown as ProductoIndice[], error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: "Ocurrió un error inesperado." };
  }
}

// Combina el índice de stock + config para la pantalla de Stock en un solo
// fetch client-side (React Query cachea esto con staleTime de 3 min).
export async function getStockPageDataAction(): Promise<{
  data: {
    productosIndice: ProductoIndice[];
    nombreComercio: string;
    mostrarSinStock: boolean;
    rubro: Rubro;
  } | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [result, configRes] = await Promise.all([
    getStockIndexAction(),
    supabase
      .from("configuracion_pos")
      .select("posName, mostrar_sin_stock, rubro")
      .single(),
  ]);

  if (result.error) {
    return { data: null, error: result.error };
  }

  // No aborta la pantalla —el inventario se puede seguir usando sin la
  // config— pero tampoco se traga el error: si esta consulta falla, los tres
  // valores de abajo caen al default a la vez y el síntoma que ve la dueña es
  // "mi comercio se llama Tienda Online y volvieron a aparecer los productos
  // sin stock", sin ninguna pista de por qué.
  if (configRes.error) {
    console.error(
      "[getStockPageDataAction] No se pudo leer configuracion_pos; se usan defaults:",
      configRes.error,
    );
  }

  return {
    data: {
      productosIndice: result.data ?? [],
      nombreComercio: configRes.data?.posName || "Tienda Online",
      mostrarSinStock: configRes.data?.mostrar_sin_stock ?? true,
      // normalizarRubro es fail-closed: si la config no cargó o trae un valor
      // desconocido, Inventario se comporta como indumentaria (lo de antes).
      rubro: normalizarRubro(configRes.data?.rubro),
    },
    error: null,
  };
}

// Detalle completo de UN producto — lo pide el sheet de edición al abrirse
// (ver ProductEditDetailSheet), nunca la lista: la tabla/grid de /stock
// rendeiza directo desde ProductoIndice, sin este fetch de por medio.
export async function getStockDetalleProductoAction(id: string): Promise<{
  data: Producto | null;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // OJO: adentro del string del `select` NO van comentarios, ni `--` ni
    // `/* */`. PostgREST no los parsea y supabase-js además le saca los saltos
    // de línea, así que un comentario se fusiona con la lista de campos y la
    // consulta entera vuelve PGRST100 ("failed to parse select parameter").
    // Cualquier explicación sobre estas columnas va ACÁ afuera.
    //
    // `marca, modelo, unidad_medida, tratamiento_iva, genero` son identidad y
    // datos fiscales: los pide el FORMULARIO de edición, que es el único
    // consumidor de esta consulta. Sin ellos el form los leía como undefined y
    // los mostraba con el default ("Unidad", 21%, marca vacía): el producto se
    // veía mal cargado aunque en la base estuviera bien, y guardar desde ahí
    // PISABA el valor real con el default. Así se perdía un producto que se
    // vendía por kilo cada vez que alguien le tocaba el precio.
    const { data, error } = await supabase
      .from("productos")
      .select(
        `
        id, nombre, tipo, precio, precio_costo, imagen_url, thumbnail_url, grid_url, slug, publicado, descripcion, categoria_id, creado_en,
        marca, modelo, unidad_medida, tratamiento_iva, genero,
        categoria:categorias(id, nombre, slug),
        producto_variantes(
          id, sku, nombre_display, precio, costo, stock, atributos,
          producto_variante_valores(
            atributo:atributos(nombre),
            atributo_valor:atributo_valores(valor)
          )
        ),
        stock:productos_stock(id, variante, cantidad)
        `,
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[getStockDetalleProductoAction] Error:", error);
      return {
        data: null,
        error: "Error al cargar el detalle del producto.",
      };
    }

    return { data: data as unknown as Producto, error: null };
  } catch (err) {
    console.error(err);
    return { data: null, error: "Ocurrió un error inesperado." };
  }
}
