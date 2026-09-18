"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidarCatalogo } from "@/shared/lib/cache-catalogo";
import { slugify } from "@/shared/utils/slugify";
import {
  canonicalizarValores,
  construirCacheAtributos,
} from "@/features/stock/lib/normalize-atributo";
import { canonicalizarMarcaContraCatalogo } from "../lib/canonicalizar-marca-server";
import { obtenerAtributosRequeridosFaltantes } from "@/features/stock/lib/validate-required-atributos";
import {
  leerUrlsDeImagenes,
  subirImagenesProducto,
} from "@/features/stock/lib/subir-imagenes-producto";
import {
  defaultsFiscalesPorRubro,
  normalizarTratamientoIva,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { parsearCantidadDeEntrada } from "@/shared/lib/unidad-venta";

export async function crearProductoAction(
  prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      error: "No se pudo verificar la sesión del usuario.",
      success: false,
    };
  }

  // El negocio sale del negocio ACTIVO de la sesión, no de perfiles.negocio_id:
  // esa columna quedó deprecada, es NULL para todo usuario invitado y apunta al
  // negocio viejo de quien trabaja en dos.
  const { data: negocioId, error: negocioError } =
    await supabase.rpc("negocio_actual");

  if (negocioError || !negocioId) {
    return {
      error: "No hay un negocio activo en esta sesión.",
      success: false,
    };
  }

  const nombre = formData.get("nombre") as string;
  const categoria_id = formData.get("categoria_id") as string;
  const descripcion = formData.get("descripcion") as string;
  // Misma canonicalización que la edición: el alta es el otro camino por el
  // que puede entrar "Popys" a un catálogo que ya tiene "popys".
  const marca = await canonicalizarMarcaContraCatalogo(
    supabase,
    formData.get("marca") as string | null,
  );
  const modelo = (formData.get("modelo") as string | null)?.trim() || null;
  // En MAYÚSCULAS, que es como el formulario lo muestra: el input tiene
  // `uppercase` por CSS pero eso no toca el valor, así que lo escrito en
  // minúscula se guardaba distinto de lo que la vendedora veía en pantalla.
  // La búsqueda no se veía afectada (compara normalizado), pero el dato sí:
  // el mismo código escrito de dos formas es un código que no cruza con el
  // remito ni con la planilla del proveedor.
  const sku =
    (formData.get("sku") as string | null)?.trim().toUpperCase() || null;
  // Referencia opcional al Catálogo Maestro (T5). Se valida como UUID antes
  // de tocar la base: un valor basura acá rompería el INSERT entero del
  // producto por un campo que es meramente informativo.
  const idMasterRaw = (formData.get("id_master") as string | null)?.trim();
  const id_master =
    idMasterRaw &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idMasterRaw,
    )
      ? idMasterRaw
      : null;
  const genero = (formData.get("genero") as string | null)?.trim() || null;
  const precio = Number.parseFloat(formData.get("precio") as string);
  const precio_costo = Number.parseFloat(
    formData.get("precio_costo") as string,
  );

  // Datos fiscales. La abrumadora mayoría de las altas NO los manda: el form
  // los tiene escondidos detrás de "Datos fiscales" justamente para que una
  // vendedora cargue nombre y precio y listo. Cuando no vienen, se toman los
  // defaults del rubro del comercio.
  //
  // Se RESUELVEN acá y se guardan en el producto: son un punto de partida, no
  // una regla viva. Si mañana el comercio cambia de rubro, lo ya cargado no se
  // recalcula — el tratamiento fiscal de un producto no puede cambiar solo
  // porque alguien tocó una configuración.
  const { data: configRubro } = await supabase
    .from("configuracion_pos")
    .select("rubro")
    .single();

  const defaults = defaultsFiscalesPorRubro(configRubro?.rubro);

  const tratamiento_iva = formData.has("tratamiento_iva")
    ? normalizarTratamientoIva(formData.get("tratamiento_iva"))
    : defaults.tratamiento_iva;
  const unidad_medida = formData.has("unidad_medida")
    ? normalizarUnidadMedida(formData.get("unidad_medida"))
    : defaults.unidad_medida;

  const tieneVariantes = formData.get("tieneVariantes") === "true";
  const stockBase = parsearCantidadDeEntrada(formData.get("stockBase"));

  const archivos = formData.getAll("imagenes") as File[];
  const thumbnails = formData.getAll("thumbnails") as File[];
  const grids = formData.getAll("grids") as File[];
  const masters = formData.getAll("masters") as File[];

  if (!nombre || Number.isNaN(precio) || Number.isNaN(precio_costo)) {
    return {
      error: "Por favor completa los campos básicos obligatorios.",
      success: false,
    };
  }

  // Fallback temporal para la columna "tipo" vieja
  let tipo = "Categoria desconocida";
  if (categoria_id) {
    const { data: cat } = await supabase
      .from("categorias")
      .select("nombre")
      .eq("id", categoria_id)
      .single();
    if (cat) tipo = cat.nombre;
  }

  // 1. Subir imágenes (main + thumbnail + grid, alineadas por índice — ver
  // subirImagenesProducto para por qué el bucle que estaba acá desalineaba
  // las tres listas).
  let imagen_url = null;
  let thumbnail_url = null;
  let grid_url = null;
  let master_url = null;

  // Camino nuevo: el navegador ya subió a Storage y solo mandó URLs. Camino
  // viejo (cliente cacheado por el service worker): llegan los binarios y se
  // suben acá, como siempre.
  const urlsDelCliente = leerUrlsDeImagenes(formData, negocioId, "CREATE PRODUCT");

  if (urlsDelCliente || archivos.some((f) => f.size > 0)) {
    const {
      mains,
      thumbs,
      grids: gridUrls,
      masters: masterUrls,
    } =
      urlsDelCliente ??
      (await subirImagenesProducto(
        supabase,
        negocioId,
        archivos,
        thumbnails,
        grids,
        "CREATE PRODUCT",
        undefined,
        masters,
      ));

    if (mains.length > 0) {
      imagen_url = JSON.stringify(mains);
      thumbnail_url = JSON.stringify(thumbs);
      grid_url = JSON.stringify(gridUrls);
      // Si NINGUNA imagen dejó master, se guarda null en vez de un array de
      // nulls: es la misma información y distingue "cliente viejo que no manda
      // masters" de "subieron pero fallaron".
      master_url = masterUrls.some(Boolean) ? JSON.stringify(masterUrls) : null;
    }
  }

  let slug = slugify(`${nombre}-${tipo}`);
  const sufijo = Math.random().toString(36).substring(2, 6);
  slug = `${slug}-${sufijo}`;

  // 2. Insertar Cabecera de Producto
  const { data: nuevoProducto, error: errorProducto } = await supabase
    .from("productos")
    .insert({
      negocio_id: negocioId,
      nombre,
      tipo,
      categoria_id: categoria_id || null,
      descripcion,
      marca,
      genero,
      ...(modelo ? { modelo } : {}),
      ...(id_master ? { id_master } : {}),
      precio,
      precio_costo,
      tratamiento_iva,
      unidad_medida,
      imagen_url,
      thumbnail_url,
      grid_url,
      master_url,
      slug,
      publicado: true,
      atributos_globales: {},
    })
    .select("id")
    .single();

  if (errorProducto || !nuevoProducto) {
    console.error(errorProducto);
    return {
      error: "Hubo un error al crear el producto base.",
      success: false,
    };
  }

  // 3. Procesar Opciones y Variantes
  if (!tieneVariantes) {
    const { data: varianteUnica } = await supabase
      .from("producto_variantes")
      .insert({
        negocio_id: negocioId,
        producto_id: nuevoProducto.id,
        nombre_display: "Único",
        atributos: {},
        precio: null, // Hereda del padre
        costo: null, // Hereda del padre
        stock: stockBase,
        sku,
      })
      .select("id, nombre_display, precio, stock")
      .single();

    // Mantenemos legacy stock table para no romper la app vieja
    await supabase.from("productos_stock").insert({
      negocio_id: negocioId,
      producto_id: nuevoProducto.id,
      variante: "Único",
      cantidad: stockBase,
    });

    revalidatePath("/stock");
    revalidatePath("/store", "layout");
    invalidarCatalogo(negocioId);
    return {
      error: null,
      success: true,
      producto: {
        id: nuevoProducto.id,
        nombre,
        tipo,
        precio,
        unidad_medida,
        variantes: varianteUnica
          ? [
              {
                id: varianteUnica.id,
                nombre_display: varianteUnica.nombre_display,
                precio: varianteUnica.precio,
                stock: varianteUnica.stock,
              },
            ]
          : [],
      },
    };
  }

  // Producto con opciones dinámicas
  let variantesCreadas: {
    id: string;
    nombre_display: string;
    precio: number | null;
    stock: number;
  }[] = [];
  try {
    const opcionesStr = formData.get("opciones") as string;
    const variantesStr = formData.get("variantes") as string;

    if (!opcionesStr || !variantesStr) {
      await supabase.from("productos").delete().eq("id", nuevoProducto.id);
      return {
        error:
          "Marcaste que el producto tiene variantes pero no cargaste ninguna. Completá la grilla de variantes o desmarcá la opción antes de guardar.",
        success: false,
      };
    }

    const opcionesRaw = JSON.parse(opcionesStr) as {
      nombre: string;
      valores: string[];
    }[];
    const variantesRaw = JSON.parse(variantesStr) as {
      valores: Record<string, string>;
      precio?: string;
      precio_costo?: string;
      stock?: string;
      sku?: string;
    }[];

    // Mismo saneamiento que editarProductoAction: descartamos propiedades
    // o valores vacíos antes de tocar la base.
    const opciones = opcionesRaw
      .map((op) => ({
        nombre: op.nombre?.trim(),
        valores: (op.valores ?? [])
          .map((v) => v?.trim())
          .filter((v): v is string => Boolean(v)),
      }))
      .filter(
        (op): op is { nombre: string; valores: string[] } =>
          Boolean(op.nombre) && op.valores.length > 0,
      );

    const nombreGenerico = opciones.find((op) =>
      /^(propiedad|opci[oó]n)\s*\d*$/i.test(op.nombre),
    );
    if (nombreGenerico) {
      // La cabecera del producto ya está insertada en este punto: sin este
      // delete quedaba un producto sin ninguna variante en la base, invisible
      // para quien lo creó (el form muestra el error y no se cierra) pero
      // presente en el listado de stock.
      await supabase.from("productos").delete().eq("id", nuevoProducto.id);
      return {
        error: `La propiedad "${nombreGenerico.nombre}" es un nombre genérico auto-generado. Renombrala (ej. "Color", "Talle", "Material") antes de guardar.`,
        success: false,
      };
    }

    const variantes = variantesRaw.filter(
      (v) =>
        v.valores &&
        Object.entries(v.valores).some(([k, val]) => k.trim() && val?.trim()),
    );

    if (opciones.length === 0 || variantes.length === 0) {
      // Mismo motivo que arriba: producto ya insertado, sin variantes.
      await supabase.from("productos").delete().eq("id", nuevoProducto.id);
      return {
        error:
          "Las variantes no tienen propiedades o valores válidos. Revisa la grilla antes de guardar.",
        success: false,
      };
    }

    // Espejo server-side de useVariantSelection: si la categoría exige
    // atributos (categoria_atributos) que no tienen valor cargado acá, no
    // confiamos en que el cliente ya lo haya validado.
    const atributosFaltantes = await obtenerAtributosRequeridosFaltantes(
      supabase,
      categoria_id,
      opciones,
    );
    if (atributosFaltantes.length > 0) {
      await supabase.from("productos").delete().eq("id", nuevoProducto.id);
      return {
        error: `Esta categoría exige el/los atributo(s) "${atributosFaltantes.join('", "')}" — completalos antes de guardar.`,
        success: false,
      };
    }

    // Mismo camino que editarProductoAction: normalizamos cada
    // (propiedad, valor) contra lo que ya existe en
    // atributos/atributo_valores antes de escribir el JSONB, para que un
    // producto nuevo no introduzca otra variante de casing de una
    // propiedad que ya existe (ej. "color" cuando ya existe "Color").
    const atributoCache = await construirCacheAtributos(supabase, opciones);

    const variantesToInsert = [];
    const stockLegacyToInsert = [];
    const relacionesPorIndice: {
      valoresOriginales: Record<string, string>;
    }[] = [];

    for (const v of variantes) {
      const valoresCanonicos = canonicalizarValores(v.valores, atributoCache);

      const nombreDisplay = opciones
        .map(
          (op) =>
            valoresCanonicos[
              atributoCache[op.nombre]?.nombreCanonico ?? op.nombre
            ],
        )
        .filter(Boolean)
        .join(" / ");

      const vPrecio = v.precio ? Number.parseFloat(v.precio) : null;
      const vCosto = v.precio_costo ? Number.parseFloat(v.precio_costo) : null;
      const vStock = parsearCantidadDeEntrada(v.stock);

      variantesToInsert.push({
        negocio_id: negocioId,
        producto_id: nuevoProducto.id,
        nombre_display: nombreDisplay,
        atributos: valoresCanonicos,
        precio: vPrecio,
        costo: vCosto,
        stock: vStock,
        sku: v.sku || null,
      });

      stockLegacyToInsert.push({
        negocio_id: negocioId,
        producto_id: nuevoProducto.id,
        variante: nombreDisplay,
        cantidad: vStock,
      });

      relacionesPorIndice.push({ valoresOriginales: v.valores });
    }

    const { data: variantesInsertadas, error: varInsertError } = await supabase
      .from("producto_variantes")
      .insert(variantesToInsert)
      // nombre_display/precio/stock además del id: el alta desde el POS mete
      // el producto al carrito sin volver a leerlo de la base.
      .select("id, nombre_display, precio, stock");
    if (varInsertError) throw varInsertError;
    variantesCreadas = variantesInsertadas ?? [];

    const { error: stockInsertError } = await supabase
      .from("productos_stock")
      .insert(stockLegacyToInsert);
    if (stockInsertError) throw stockInsertError;

    const varValores = (variantesInsertadas ?? []).flatMap((varData, idx) => {
      const { valoresOriginales } = relacionesPorIndice[idx];
      return Object.entries(valoresOriginales).flatMap(
        ([opNombre, opValor]) => {
          const entry = atributoCache[opNombre];
          const valorEntry = entry?.valores[opValor];
          if (!entry || !valorEntry) return [];
          return [
            {
              variante_id: varData.id,
              atributo_id: entry.atributoId,
              atributo_valor_id: valorEntry.valorId,
            },
          ];
        },
      );
    });

    if (varValores.length > 0) {
      const { error: varValoresError } = await supabase
        .from("producto_variante_valores")
        .insert(varValores);
      if (varValoresError) throw varValoresError;
    }
  } catch (error) {
    console.error("[CREATE PRODUCT ERROR]", error);

    const pgError = error as { code?: string; message?: string };

    if (pgError?.code === "42501") {
      return {
        error:
          "No tenés permisos para guardar estos cambios (política de seguridad RLS).",
        success: false,
      };
    }
    if (pgError?.code === "23503") {
      return {
        error:
          "Alguno de los datos hace referencia a un registro que ya no existe (violación de clave foránea).",
        success: false,
      };
    }

    return {
      error: "Hubo un error al guardar las variantes del producto.",
      success: false,
    };
  }

  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  invalidarCatalogo(negocioId);

  return {
    error: null,
    success: true,
    producto: {
      id: nuevoProducto.id,
      nombre,
      tipo,
      precio,
      unidad_medida,
      variantes: variantesCreadas,
    },
  };
}
