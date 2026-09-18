"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidarCatalogo } from "@/shared/lib/cache-catalogo";
import {
  canonicalizarValores,
  construirCacheAtributos,
} from "@/features/stock/lib/normalize-atributo";
import { parseProductImages } from "@/features/stock/lib/stock-product-utils";
import { canonicalizarMarcaContraCatalogo } from "../lib/canonicalizar-marca-server";
import { obtenerAtributosRequeridosFaltantes } from "@/features/stock/lib/validate-required-atributos";
import {
  leerUrlsDeImagenes,
  subirImagenesProducto,
} from "@/features/stock/lib/subir-imagenes-producto";
import { MAX_IMAGENES_PRODUCTO } from "@/shared/utils/limites-imagen";
import {
  normalizarTratamientoIva,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { parsearCantidadDeEntrada } from "@/shared/lib/unidad-venta";
import {
  MENSAJE_ERROR_PRESENTACION,
  normalizarReglaPrecio,
  validarPresentaciones,
  type PresentacionInput,
} from "@/shared/lib/presentaciones";

type SupabaseServerClient = ReturnType<typeof createClient>;

// Acá vivía `AuditoriaVarianteRow`, el tipo de la fila que este archivo
// insertaba a mano en `producto_variantes_auditoria` para el producto sin
// variantes. Ya no hace falta: ese camino pasa por
// `guardar_variantes_producto`, que escribe su propia auditoría con el mismo
// criterio que el resto. Un tipo menos que mantener sincronizado a mano con
// una tabla.

export type ImagenesResult = {
  success: boolean;
  error?: string;
  // Presente solo si de verdad se recalcularon (hubo archivos nuevos o
  // borrados) — el cliente lo usa para sincronizar su estado local y no
  // volver a subir los mismos binarios en un reintento (ver EditProductForm).
  urls?: {
    imagen_url?: string;
    thumbnail_url?: string;
    grid_url?: string;
  };
};

export type VariantesResult = {
  success: boolean;
  error?: string;
};

export type EditarProductoResult = {
  imagenes: ImagenesResult;
  variantes: VariantesResult;
  /**
   * Qué pasó con los precios fijos por lista: `null` si salió bien o si el
   * formulario ni los traía, el mensaje a mostrar si no se pudieron guardar.
   *
   * Es una TERCERA preocupación independiente, por el mismo criterio que
   * separa fotos de variantes: que no se puedan escribir los precios por lista
   * —lo pide ADMIN por RLS— no tiene que voltear una edición de producto que
   * ya se guardó bien, pero tampoco puede pasar en silencio.
   */
  preciosLista?: string | null;
  /** Lo mismo para las presentaciones comerciales (Balde, Pack x10). */
  presentaciones?: string | null;
};

// Fotos y variantes son preocupaciones independientes: el guard de
// variantes (paso 2) nunca debe poder bloquear un cambio de imágenes
// (paso 1), y viceversa. Cada una corre y responde por su cuenta — no hay
// un booleano combinado que esconda un éxito parcial.
export async function editarProductoAction(
  prevState: EditarProductoResult,
  formData: FormData,
): Promise<EditarProductoResult> {
  const id = formData.get("id") as string;
  const nombre = formData.get("nombre") as string;
  const categoria_id = formData.get("categoria_id") as string;
  const descripcion = formData.get("descripcion") as string;
  const precio = Number.parseFloat(formData.get("precio") as string);
  const precio_costo = Number.parseFloat(
    formData.get("precio_costo") as string,
  );
  const publicado = formData.get("publicado") === "true";

  const tieneVariantes = formData.get("tieneVariantes") === "true";
  const stockBase = parsearCantidadDeEntrada(formData.get("stockBase"));

  const archivos = formData.getAll("imagenes") as File[];
  const thumbnails = formData.getAll("thumbnails") as File[];
  const grids = formData.getAll("grids") as File[];
  const masters = formData.getAll("masters") as File[];
  const imagenesAEliminarStr = formData.get("imagenesAEliminar") as
    string | null;
  const imagenesAEliminar: string[] = imagenesAEliminarStr
    ? (JSON.parse(imagenesAEliminarStr) as string[])
    : [];

  if (!id || !nombre || Number.isNaN(precio) || Number.isNaN(precio_costo)) {
    const error = "Por favor completa todos los campos obligatorios.";
    return {
      imagenes: { success: false, error },
      variantes: { success: false, error },
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const error = "No se pudo verificar la sesión del usuario.";
    return {
      imagenes: { success: false, error },
      variantes: { success: false, error },
    };
  }

  // MULTI-TENANT: NEGOCIO ACTIVO DE LA SESIÓN
  // No sale de perfiles.negocio_id: esa columna quedó deprecada, es NULL para
  // todo usuario invitado y apunta al negocio viejo de quien trabaja en dos.
  // =========================================================================
  const { data: negocioId, error: negocioError } =
    await supabase.rpc("negocio_actual");

  if (negocioError || !negocioId) {
    const error = "No hay un negocio activo en esta sesión.";
    return {
      imagenes: { success: false, error },
      variantes: { success: false, error },
    };
  }

  // Identidad y datos fiscales: SOLO se pisan los que el formulario mandó.
  // `has()` y no `get()` porque un campo ausente y uno vacío son cosas
  // distintas — el bloque fiscal va colapsado y cuando está cerrado no monta
  // sus inputs. Con `get()`, un producto al 10,5% volvería al default 21%
  // cada vez que alguien le corrige el precio. Es el mismo error que borraba
  // los datos fiscales de un cliente al guardar sin tocar el toggle.
  const camposOpcionales: Record<string, string | null> = {};
  if (formData.has("marca")) {
    // Contra el catálogo, no tal cual viene: tipear "Popys" donde ya hay
    // "popys" tiene que guardar "popys". Sin esto el combobox sugiere bien y
    // el duplicado entra igual.
    camposOpcionales.marca = await canonicalizarMarcaContraCatalogo(
      supabase,
      formData.get("marca") as string | null,
    );
  }
  if (formData.has("genero")) {
    camposOpcionales.genero =
      (formData.get("genero") as string)?.trim() || null;
  }
  if (formData.has("tratamiento_iva")) {
    camposOpcionales.tratamiento_iva = normalizarTratamientoIva(
      formData.get("tratamiento_iva"),
    );
  }
  if (formData.has("unidad_medida")) {
    camposOpcionales.unidad_medida = normalizarUnidadMedida(
      formData.get("unidad_medida"),
    );
  }

  // (a) Imágenes + cabecera del producto — corre siempre, sin importar lo
  // que pase con las variantes.
  const imagenes = await actualizarImagenesYCabecera(supabase, {
    id,
    negocioId,
    camposOpcionales,
    nombre,
    categoria_id,
    descripcion,
    precio,
    precio_costo,
    publicado,
    archivos,
    thumbnails,
    grids,
    masters,
    imagenesAEliminar,
    formData,
  });

  // (b) Variantes, con su guard intacto — corre después, y su resultado
  // no revierte ni condiciona lo que (a) ya haya guardado.
  const variantes = await procesarVariantes(supabase, {
    id,
    negocioId,
    categoria_id: categoria_id || null,
    tieneVariantes,
    stockBase,
    formData,
    userId: user?.id ?? null,
  });

  // (c) Precios fijos por lista. Va DESPUÉS y aparte, por el mismo criterio
  // que (b): su resultado no revierte ni condiciona lo que la cabecera ya
  // guardó. Un comercio sin listas no ejecuta ni una consulta acá.
  const preciosLista = await guardarPreciosPorLista(supabase, {
    id,
    negocioId,
    formData,
  });

  // (d) Presentaciones comerciales. Mismo criterio que (c): parte de la
  // ficha, guardada aparte y con su propio aviso.
  const presentaciones = await guardarPresentaciones(supabase, {
    id,
    negocioId,
    formData,
    unidadMedida: camposOpcionales.unidad_medida ?? null,
  });

  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  invalidarCatalogo(negocioId);

  return { imagenes, variantes, preciosLista, presentaciones };
}

/**
 * Los precios FIJOS de un producto en cada lista: la excepción a la regla.
 *
 * Solo corre si el formulario trae el centinela `precios_lista_editables`,
 * o sea si la sección estuvo ABIERTA. Cerrada no monta sus inputs, así que
 * corregir el precio de un producto desde la edición rápida no puede
 * borrarle sus precios fijos — mismo mecanismo que protege el tratamiento de
 * IVA.
 *
 * Un campo vacío significa "seguí la regla de la lista", y por eso BORRA la
 * fila en vez de guardar un cero. Cero no es un precio: `producto_precios`
 * tiene un CHECK que lo rechaza, y con razón.
 *
 * Escribir `producto_precios` pide ADMIN por RLS, mientras que editar un
 * producto lo puede hacer también un ENCARGADO. Esa diferencia es a
 * propósito, así que un fallo acá NO voltea el guardado: la cabecera del
 * producto ya se guardó bien y hacer fallar la edición entera sería peor.
 *
 * Pero tampoco se calla: devuelve el error para que la pantalla lo diga.
 * Escribir un precio, ver "Producto actualizado" y que el precio no esté es
 * el mismo éxito silencioso que costó 35 fotos el 5/9/2026. Y acá la RLS ni
 * siquiera devuelve error —un upsert filtrado escribe 0 filas y sale bien—,
 * así que se cuenta lo que volvió.
 */
async function guardarPreciosPorLista(
  supabase: SupabaseServerClient,
  { id, negocioId, formData }: { id: string; negocioId: string; formData: FormData },
): Promise<string | null> {
  if (!formData.has("precios_lista_editables")) return null;

  const aGuardar: { negocio_id: string; lista_id: string; producto_id: string; precio: number }[] = [];
  const aBorrar: string[] = [];

  for (const [clave, valor] of formData.entries()) {
    if (!clave.startsWith("precio_lista_")) continue;
    const listaId = clave.slice("precio_lista_".length);
    if (!listaId) continue;

    const precio = Number(String(valor).replace(",", "."));

    if (!Number.isFinite(precio) || precio <= 0) {
      aBorrar.push(listaId);
    } else {
      aGuardar.push({
        negocio_id: negocioId,
        lista_id: listaId,
        producto_id: id,
        precio: Math.round(precio),
      });
    }
  }

  if (aGuardar.length > 0) {
    // Upsert por la PK (lista_id, producto_id): corregir un precio fijo es
    // el caso normal y no tiene por qué ser un borrado más un alta.
    const { data, error } = await supabase
      .from("producto_precios")
      .upsert(aGuardar, { onConflict: "lista_id,producto_id" })
      .select("lista_id");

    if (error) {
      console.error("[EDIT PRODUCT] precios por lista:", error);
      return "No se pudieron guardar los precios por lista.";
    }
    if (!data || data.length < aGuardar.length) {
      console.error("[EDIT PRODUCT] precios por lista filtrados por RLS", {
        id,
        pedidos: aGuardar.length,
        escritos: data?.length ?? 0,
      });
      return "Solo un administrador puede cambiar los precios por lista.";
    }
  }

  if (aBorrar.length > 0) {
    const { error } = await supabase
      .from("producto_precios")
      .delete()
      .eq("producto_id", id)
      .in("lista_id", aBorrar);

    if (error) {
      console.error("[EDIT PRODUCT] borrando precios por lista:", error);
      return "No se pudieron borrar los precios por lista.";
    }
  }

  return null;
}

/**
 * Las presentaciones comerciales del producto (Balde 4,7 kg, Pack x10): el
 * CONJUNTO que trae el formulario reemplaza al que había — upsert por id de
 * las que siguen, insert de las nuevas, delete de las que faltan.
 *
 * Solo corre con el centinela `presentaciones_editables`, igual que los
 * precios por lista: la sección va colapsada y cerrada no monta nada, así que
 * corregir un precio no puede borrarle los packs a un producto.
 *
 * Se valida ANTES de escribir con `validarPresentaciones`, que es el espejo
 * en TS de los CHECK e índices de la tabla: así el error dice "fila 2: el
 * factor tiene que ser entero" y no un 23505 pelado. La base igual vuelve a
 * frenarlo, y la unidad contra la que se valida es la que se está guardando
 * —si el formulario no la mandó, la que ya tiene el producto.
 *
 * Toda escritura se cuenta: un upsert filtrado por RLS escribe 0 filas y sale
 * con `error: null`, que es el éxito silencioso que costó 35 fotos.
 */
async function guardarPresentaciones(
  supabase: SupabaseServerClient,
  {
    id,
    negocioId,
    formData,
    unidadMedida,
  }: {
    id: string;
    negocioId: string;
    formData: FormData;
    unidadMedida: string | null;
  },
): Promise<string | null> {
  if (!formData.has("presentaciones_editables")) return null;

  let entrada: unknown;
  try {
    entrada = JSON.parse((formData.get("presentaciones") as string) || "[]");
  } catch {
    return "No se pudieron leer las presentaciones.";
  }
  if (!Array.isArray(entrada)) return "No se pudieron leer las presentaciones.";

  // Normalización de forma: lo que no es número no entra como número.
  const presentaciones: PresentacionInput[] = entrada.map((p, i) => {
    const fila = (p ?? {}) as Record<string, unknown>;
    const numero = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? n : Number.NaN;
    };
    return {
      id: typeof fila.id === "string" && fila.id ? fila.id : undefined,
      variante_id:
        typeof fila.variante_id === "string" && fila.variante_id
          ? fila.variante_id
          : null,
      nombre: String(fila.nombre ?? "").trim(),
      factor: numero(fila.factor) ?? Number.NaN,
      regla_precio: normalizarReglaPrecio(fila.regla_precio),
      precio: numero(fila.precio),
      costo: numero(fila.costo),
      sku: String(fila.sku ?? "").trim() || null,
      es_default: fila.es_default === true,
      visible_catalogo: fila.visible_catalogo !== false,
      activa: fila.activa !== false,
      orden: Number.isFinite(Number(fila.orden)) ? Number(fila.orden) : i,
    };
  });

  let unidad = unidadMedida;
  if (!unidad) {
    const { data } = await supabase
      .from("productos")
      .select("unidad_medida")
      .eq("id", id)
      .maybeSingle();
    unidad = (data?.unidad_medida as string | null) ?? null;
  }

  const errores = validarPresentaciones(presentaciones, unidad);
  if (errores.length > 0) {
    const primero = errores[0];
    const nombre = presentaciones[primero.indice]?.nombre || `fila ${primero.indice + 1}`;
    return `Presentaciones sin guardar — "${nombre}": ${MENSAJE_ERROR_PRESENTACION[primero.error]}`;
  }

  const { data: existentes, error: errorLectura } = await supabase
    .from("producto_presentaciones")
    .select("id")
    .eq("producto_id", id);
  if (errorLectura) {
    console.error("[EDIT PRODUCT] leyendo presentaciones:", errorLectura);
    return "No se pudieron leer las presentaciones actuales.";
  }

  const idsQueQuedan = new Set(
    presentaciones.map((p) => p.id).filter((x): x is string => Boolean(x)),
  );
  const aBorrar = (existentes ?? [])
    .map((r) => r.id as string)
    .filter((rid) => !idsQueQuedan.has(rid));

  // Borrar primero: si una fila nueva reusa el nombre de una que se va, el
  // índice único la rechazaría con las dos vivas.
  if (aBorrar.length > 0) {
    const { data, error } = await supabase
      .from("producto_presentaciones")
      .delete()
      .eq("producto_id", id)
      .in("id", aBorrar)
      .select("id");
    if (error) {
      console.error("[EDIT PRODUCT] borrando presentaciones:", error);
      return "No se pudieron borrar las presentaciones que sacaste.";
    }
    if (!data || data.length < aBorrar.length) {
      return "No tenés permiso para cambiar las presentaciones.";
    }
  }

  if (presentaciones.length > 0) {
    const filas = presentaciones.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      negocio_id: negocioId,
      producto_id: id,
      variante_id: p.variante_id,
      nombre: p.nombre,
      factor: p.factor,
      regla_precio: p.regla_precio,
      precio: p.regla_precio === "FIJO" ? p.precio : null,
      costo: p.costo,
      sku: p.sku,
      es_default: p.es_default,
      visible_catalogo: p.visible_catalogo,
      activa: p.activa,
      orden: p.orden,
    }));

    const { data, error } = await supabase
      .from("producto_presentaciones")
      .upsert(filas, { onConflict: "id" })
      .select("id");

    if (error) {
      console.error("[EDIT PRODUCT] presentaciones:", error);
      // Los dos errores que el espejo en TS no puede ver: el sku repetido
      // contra OTRO producto y el factor contra la unidad ya guardada.
      if (error.code === "23505" && error.message.includes("sku")) {
        return "Ese código ya está usado en otra presentación de tu catálogo.";
      }
      if (error.message.includes("PRESENTACION_FACTOR_ENTERO")) {
        return MENSAJE_ERROR_PRESENTACION.FACTOR_ENTERO;
      }
      return "No se pudieron guardar las presentaciones.";
    }
    if (!data || data.length < filas.length) {
      console.error("[EDIT PRODUCT] presentaciones filtradas por RLS", {
        id,
        pedidas: filas.length,
        escritas: data?.length ?? 0,
      });
      return "No tenés permiso para cambiar las presentaciones.";
    }
  }

  return null;
}

async function actualizarImagenesYCabecera(
  supabase: SupabaseServerClient,
  params: {
    id: string;
    negocioId: string;
    nombre: string;
    categoria_id: string;
    descripcion: string;
    precio: number;
    precio_costo: number;
    publicado: boolean;
    archivos: File[];
    thumbnails: File[];
    grids: File[];
    masters: File[];
    imagenesAEliminar: string[];
    /** Columnas de cabecera que solo se tocan si el form las mandó. */
    camposOpcionales: Record<string, string | null>;
    /** Para leer `imagenes_urls`, el camino nuevo en el que el navegador ya
     * subió las fotos a Storage y solo manda las URLs. */
    formData: FormData;
  },
): Promise<ImagenesResult> {
  const {
    id,
    negocioId,
    nombre,
    categoria_id,
    descripcion,
    precio,
    precio_costo,
    publicado,
    archivos,
    thumbnails,
    grids,
    masters,
    imagenesAEliminar,
    camposOpcionales,
    formData,
  } = params;

  // Subir imágenes nuevas y mergear contra el imagen_url REAL en base. No
  // confiamos en ninguna lista "existente" que pueda mandar el cliente: si
  // el sheet quedó con datos viejos en memoria (otra pestaña, sesión
  // larga, etc.), partir de la base evita pisar imágenes que el cliente ni
  // sabía que estaban. El cliente solo manda qué URLs puntuales quiere
  // borrar (imagenesAEliminar); el resultado final se arma acá.
  let imagen_url: string | undefined = undefined;
  let thumbnail_url: string | undefined = undefined;
  let grid_url: string | undefined = undefined;
  let master_url: string | undefined = undefined;
  const hayArchivosNuevos = archivos.some((f) => f.size > 0);
  if (hayArchivosNuevos || imagenesAEliminar.length > 0) {
    const { data: productoActual } = await supabase
      .from("productos")
      .select("imagen_url, thumbnail_url, grid_url, master_url")
      .eq("id", id)
      .single();

    const imagenesActuales = parseProductImages(productoActual?.imagen_url);
    const thumbnailsActuales = parseProductImages(
      productoActual?.thumbnail_url,
    );
    const gridsActuales = parseProductImages(productoActual?.grid_url);
    const mastersActuales = parseProductImages(productoActual?.master_url);

    // imagenesAEliminar llega como URLs de imagen_url (lo único que ve el
    // usuario en el sheet) — recorremos por índice para descartar el
    // thumbnail/grid correspondiente en el mismo lugar del array y no
    // desalinear las listas. Si una imagen vieja no tiene thumbnail o grid
    // propio (productos creados antes de este cambio, o aún no
    // backfilleados), usamos su propia imagen_url como placeholder en vez
    // de dejar el índice vacío — se reemplaza solo cuando corra el backfill.
    //
    // Va ANTES de subir las nuevas porque de acá sale cuántas entran: el tope
    // de MAX_IMAGENES_PRODUCTO cuenta las que quedan más las que se agregan.
    const imagenesFinal: string[] = [];
    const thumbnailsFinal: string[] = [];
    const gridsFinal: string[] = [];
    const mastersFinal: (string | null)[] = [];
    imagenesActuales.forEach((url, idx) => {
      if (imagenesAEliminar.includes(url)) return;
      imagenesFinal.push(url);
      thumbnailsFinal.push(thumbnailsActuales[idx] ?? url);
      gridsFinal.push(gridsActuales[idx] ?? url);
      // A diferencia del thumb y el grid, el master NO cae al placeholder de la
      // imagen: una foto vieja sin master no tiene desde dónde regenerarse, y
      // decir lo contrario haría que una futura reoptimización la recomprima
      // desde una copia ya degradada.
      mastersFinal.push(mastersActuales[idx] ?? null);
    });

    // El tope NO es retroactivo: un producto viejo con 5 fotos conserva las 5.
    // Lo único que pasa es que el cupo da 0 y no se le puede sumar ninguna.
    const cupoDisponible = Math.max(
      0,
      MAX_IMAGENES_PRODUCTO - imagenesFinal.length,
    );

    // El thumbnail y el grid viajan en el mismo índice que su main (ver
    // optimizarImagenesProducto en edit-sheet.tsx). subirImagenesProducto
    // garantiza que las tres listas salgan alineadas y del mismo largo.
    const {
      mains: urls,
      thumbs: urlsThumb,
      grids: urlsGrid,
      masters: urlsMaster,
    } =
      // Camino nuevo: el navegador ya subió a Storage y mandó URLs. El cupo se
      // vuelve a aplicar acá aunque el cliente ya lo haya respetado.
      leerUrlsDeImagenes(formData, negocioId, "EDIT PRODUCT", cupoDisponible) ??
      (hayArchivosNuevos
        ? await subirImagenesProducto(
            supabase,
            negocioId,
            archivos,
            thumbnails,
            grids,
            "EDIT PRODUCT",
            cupoDisponible,
            masters,
          )
        : { mains: [], thumbs: [], grids: [], masters: [] });

    imagen_url = JSON.stringify(imagenesFinal.concat(urls));
    thumbnail_url = JSON.stringify(thumbnailsFinal.concat(urlsThumb));
    grid_url = JSON.stringify(gridsFinal.concat(urlsGrid));

    const mastersCompletos = mastersFinal.concat(urlsMaster);
    master_url = mastersCompletos.some(Boolean)
      ? JSON.stringify(mastersCompletos)
      : undefined;
  }

  const updateData: {
    nombre: string;
    categoria_id: string | null;
    precio: number;
    precio_costo: number;
    descripcion: string;
    publicado: boolean;
    imagen_url?: string;
    thumbnail_url?: string;
    grid_url?: string;
    master_url?: string;
  } = {
    nombre,
    categoria_id: categoria_id || null,
    precio,
    precio_costo,
    descripcion,
    publicado,
    // Identidad y datos fiscales: solo los que el formulario mandó (ver
    // `camposOpcionales` en editarProductoAction).
    ...camposOpcionales,
  };

  if (imagen_url !== undefined) updateData.imagen_url = imagen_url;
  if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
  if (grid_url !== undefined) updateData.grid_url = grid_url;
  if (master_url !== undefined) updateData.master_url = master_url;

  // Con `.select("id")`, por la misma razón que en actualizar-fotos-producto:
  // un UPDATE filtrado por RLS vuelve con 0 filas y sin error, y esta action
  // devolvía `success: true` sobre un guardado que no ocurrió.
  const { data: filasTocadas, error: errorProducto } = await supabase
    .from("productos")
    .update(updateData)
    .eq("id", id)
    .select("id");

  if (errorProducto) {
    console.error("[EDIT PRODUCT ERROR]", errorProducto);
    return {
      success: false,
      error: "Hubo un error al actualizar el producto base.",
    };
  }

  if (!filasTocadas || filasTocadas.length === 0) {
    console.error("[EDIT PRODUCT] El UPDATE no afectó ninguna fila", { id });
    return {
      success: false,
      error: "No tenés permiso para editar este producto.",
    };
  }

  return { success: true, urls: { imagen_url, thumbnail_url, grid_url } };
}

async function procesarVariantes(
  supabase: SupabaseServerClient,
  params: {
    id: string;
    negocioId: string;
    categoria_id: string | null;
    tieneVariantes: boolean;
    stockBase: number;
    formData: FormData;
    userId: string | null;
  },
): Promise<VariantesResult> {
  const {
    id,
    negocioId,
    categoria_id,
    tieneVariantes,
    stockBase,
    formData,
    userId,
  } = params;

  try {
    if (!tieneVariantes) {
      // Un producto sin variantes se guarda por la MISMA RPC que uno con
      // variantes: es el caso degenerado de "una sola combinación, la vacía".
      //
      // Antes esto era un bloque aparte con `.delete()` + `.insert()` crudos
      // sobre `producto_variantes`, y de ahí salían tres problemas:
      //
      //   1. Destruía el UUID de la variante en cada guardado — el mismo bug
      //      que 20260902110000 sacó de la RPC, entrando por otra puerta. Se
      //      arregló pasándolo a UPDATE, pero quedaban los otros dos.
      //   2. Corría suelto desde Node, así que el trigger de
      //      `movimientos_stock` no podía saber el ORIGEN: `set_config` no
      //      cruza transacciones desde acá, y todo cambio de stock quedaba con
      //      origen DESCONOCIDO. Adentro de la RPC, el wrapper declara
      //      EDICION_VARIANTES y escribe el movimiento NETO.
      //   3. Eran DOS escritores para la misma tabla, con dos criterios: el
      //      freno de mercadería, la auditoría y el espejo legacy vivían solo
      //      en uno de los dos. Toda la historia de este archivo dice que dos
      //      caminos a la misma tabla terminan divergiendo.
      //
      // La identidad de la variante única es la clave vacía
      // (`atributos_comparables('{}') = ''`), así que la RPC la matchea contra
      // la "Único" que ya existe y la ACTUALIZA conservando su id.
      const { data: variantesActuales } = await supabase
        .from("producto_variantes")
        .select("id, atributos")
        .eq("producto_id", id);

      // Convertir un producto CON variantes a uno sin variantes es una baja
      // deliberada de todas las combinaciones que tenía, y el freno de la RPC
      // bloquea cualquier baja no confirmada que tenga stock. Se confirman
      // acá: el usuario lo pidió sacando la sección de variantes del
      // formulario. Sin esto, "Quitar variantes" quedaría bloqueado para
      // cualquier producto con mercadería, que es la mayoría.
      const confirmadasEliminar = (variantesActuales ?? [])
        .map((v) => v.atributos ?? {})
        .filter((a) => Object.keys(a).length > 0);

      const sku = formData.has("sku")
        ? (formData.get("sku") as string | null)?.trim().toUpperCase() || null
        : null;

      const { data: rpcUnico, error: rpcUnicoError } = await supabase.rpc(
        "guardar_variantes_producto",
        {
          p_producto_id: id,
          p_negocio_id: negocioId,
          p_variantes: [
            {
              atributos: {},
              nombre_display: "Único",
              precio: null,
              costo: null,
              stock_input: String(stockBase),
              sku,
              relaciones: [],
            },
          ],
          p_editado_por: userId,
          p_confirmadas_eliminar: confirmadasEliminar,
        },
      );
      if (rpcUnicoError) throw rpcUnicoError;

      const resultadoUnico = rpcUnico as {
        success: boolean;
        blocked?: boolean;
      };
      if (!resultadoUnico.success) {
        return {
          success: false,
          error:
            "No se pudo guardar el producto: la base bloqueó la baja de variantes con stock. Volvé a abrirlo y confirmá el cambio.",
        };
      }

      return { success: true };
    }

    // Es producto con opciones dinámicas
    const opcionesStr = formData.get("opciones") as string;
    const variantesStr = formData.get("variantes") as string;

    if (!opcionesStr || !variantesStr) {
      // Nada que procesar del lado de variantes — no es un error.
      return { success: true };
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

    // Descartamos propiedades/valores vacíos antes de tocar la base: un
    // nombre en blanco generaría una fila de atributo con slug "" que
    // quedaría reciclándose entre productos distintos.
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

    // Red de seguridad: "Propiedad N"/"Opción N" son los fallbacks que usa
    // el parser de variantes legacy cuando no puede saber el nombre real
    // de una propiedad (ver parse-variant-attributes.ts). Si el
    // formulario de edición los precarga y el vendedor guarda sin
    // renombrarlos, no deben persistirse como si fueran reales.
    const nombreGenerico = opciones.find((op) =>
      /^(propiedad|opci[oó]n)\s*\d*$/i.test(op.nombre),
    );
    if (nombreGenerico) {
      return {
        success: false,
        error: `La propiedad "${nombreGenerico.nombre}" es un nombre genérico auto-generado. Renombrala (ej. "Color", "Talle", "Material") antes de guardar.`,
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
      return {
        success: false,
        error: `Esta categoría exige el/los atributo(s) "${atributosFaltantes.join('", "')}" — completalos antes de guardar.`,
      };
    }

    const variantesConAtributos = variantesRaw.filter(
      (v) =>
        v.valores &&
        Object.entries(v.valores).some(([k, val]) => k.trim() && val?.trim()),
    );

    if (opciones.length === 0 || variantesConAtributos.length === 0) {
      return {
        success: false,
        error:
          "Las variantes no tienen propiedades o valores válidos. Revisa la grilla antes de guardar.",
      };
    }

    // Red de seguridad: el chequeo anterior solo valida que la combinación
    // tenga atributos (Talle, Color, etc.), lo cual es SIEMPRE cierto en
    // un cross-join — no filtra nada por sí solo. La matriz de selección
    // del cliente ya debería mandar solo las combinaciones marcadas, pero
    // si ese estado llega desincronizado por cualquier motivo, no
    // persistimos filas sin NINGÚN dato real cargado. Importante: "stock
    // en 0" SÍ es un dato real (una variante agotada, ya existente, que
    // hereda precio/costo del producto padre) — el chequeo mira si el
    // campo vino provisto, no si el valor es mayor a cero. Antes acá
    // stock=0 se trataba como "sin datos" y la fila se descartaba del
    // payload, lo que hacía que el guard de la RPC bloqueara SIEMPRE que
    // el producto tuviera una variante agotada sin override propio —
    // aunque el usuario ni hubiera tocado esa combinación.
    const variantes = variantesConAtributos.filter((v) => {
      const stockProvisto =
        v.stock !== undefined && v.stock !== null && v.stock.trim() !== "";
      return Boolean(
        v.precio?.trim() ||
        v.precio_costo?.trim() ||
        stockProvisto ||
        v.sku?.trim(),
      );
    });

    if (variantes.length === 0) {
      return {
        success: false,
        error:
          "Ninguna de las combinaciones tiene precio o stock cargado. Revisá la grilla antes de guardar.",
      };
    }

    // A. Normalizamos cada (propiedad, valor) contra lo que ya existe en
    // atributos/atributo_valores (case/tilde-insensitive vía slug) y
    // cacheamos la forma canónica — "COLOR" y "Color" terminan siendo
    // siempre la misma fila y el mismo string en el JSONB, en vez de lo
    // que se haya tipeado en esta sesión puntual.
    const atributoCache = await construirCacheAtributos(supabase, opciones);

    // B. Armamos el payload con atributos ya canonicalizados y lo mandamos
    // entero al RPC guardar_variantes_producto, que corre el chequeo de
    // seguridad + delete + reinsert + relaciones + stock legacy +
    // auditoría como UNA sola transacción de Postgres: si el chequeo
    // bloquea, el DELETE nunca se ejecuta; si algo falla a mitad de
    // camino, Postgres revierte todo — no puede quedar a medio aplicar
    // como con la secuencia de llamadas sueltas de antes.
    const rpcPayload = variantes.map((v) => {
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

      const relaciones = Object.entries(v.valores).flatMap(
        ([opNombre, opValor]) => {
          const entry = atributoCache[opNombre];
          const valorEntry = entry?.valores[opValor as string];
          return entry && valorEntry
            ? [
                {
                  atributo_id: entry.atributoId,
                  atributo_valor_id: valorEntry.valorId,
                },
              ]
            : [];
        },
      );

      return {
        atributos: valoresCanonicos,
        nombre_display: nombreDisplay,
        precio: v.precio ? Number.parseFloat(v.precio) : null,
        costo: v.precio_costo ? Number.parseFloat(v.precio_costo) : null,
        stock_input: v.stock?.trim() || null,
        sku: v.sku || null,
        relaciones,
      };
    });

    // Lo que el usuario ya vio y confirmó explícitamente en el modal de
    // confirmación (ConfirmSaveVariantsModal) — la RPC solo deja pasar
    // faltantes que estén en esta lista; cualquier otra sigue bloqueando
    // el guardado igual que antes.
    const confirmadasEliminarStr = formData.get("confirmadasEliminar") as
      string | null;
    const confirmadasEliminar = confirmadasEliminarStr
      ? (JSON.parse(confirmadasEliminarStr) as Record<string, string>[])
      : [];

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "guardar_variantes_producto",
      {
        p_producto_id: id,
        p_negocio_id: negocioId,
        p_variantes: rpcPayload,
        p_editado_por: userId,
        p_confirmadas_eliminar: confirmadasEliminar,
      },
    );
    if (rpcError) throw rpcError;

    const resultado = rpcResult as {
      success: boolean;
      blocked?: boolean;
      faltantes?: number;
    };

    if (!resultado.success) {
      return {
        success: false,
        error:
          `Guardado bloqueado: se detectaron ${resultado.faltantes} variante(s) que iban a desaparecer sin haber sido confirmadas en el paso anterior. ` +
          `Esto puede borrar stock real sin que lo hayas pedido — cerrá este cambio, volvé a abrir el producto y confirmá de nuevo. ` +
          `Si el mensaje persiste después de eso, avisá al equipo técnico.`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error("[EDIT PRODUCT ERROR]", error);

    const pgError = error as { code?: string; message?: string };

    if (pgError?.code === "42501") {
      return {
        success: false,
        error:
          "No tenés permisos para guardar estos cambios (política de seguridad RLS).",
      };
    }
    if (pgError?.code === "23503") {
      return {
        success: false,
        error:
          "Alguno de los datos hace referencia a un registro que ya no existe (violación de clave foránea).",
      };
    }

    return {
      success: false,
      error: "Hubo un error al guardar las variantes del producto.",
    };
  }
}
