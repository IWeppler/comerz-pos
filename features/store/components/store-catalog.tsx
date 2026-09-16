"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Producto } from "@/entities/productos/types";
import { getIndiceCatalogoPublicoAction } from "@/shared/actions/indice-catalogo-publico";
import type { PortadaCatalogo } from "../lib/catalogo-core";
import { Button } from "@/shared/ui/button";
import { Plus, SearchX, ShoppingBag } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CategoryPills } from "./CategoryPills";

import { FiltrosPanel } from "./filtros/filtros-panel";
import { BarraCatalogo } from "./filtros/barra-catalogo";
import { ProductCard } from "./product-card";
import {
  alternarValorFiltro,
  parsearValoresFiltro,
  serializarValoresFiltro,
  type OrdenOption,
} from "../lib/filtros-url";
import {
  DEFAULT_ORDEN,
  DEFAULT_TIPO,
  ITEMS_POR_PAGINA,
  useCatalogFilters,
} from "../hooks/use-catalog-filters";
import { buildPropiedadesFiltro } from "@/entities/productos/lib/build-propiedades-filtro";
import { slugify } from "@/shared/utils/slugify";
import { resolverCategoriaPorSlug } from "@/shared/utils/category-tree";
import { parsearIdsSeleccion } from "@/shared/utils/compartir-catalogo";
import { ConfiguracionPOS } from "@/entities/config/types";
import { StoreHome } from "./store-home";
import {
  construirPortadaCategorias,
  esModoPortada,
  PARAM_VER_TODO,
  seleccionPortada,
  VALOR_VER_TODO,
} from "../lib/portada-catalogo";

interface CategoriaProp {
  id: string;
  nombre: string;
  slug?: string | null;
  parent_id?: string | null;
  /** Portada elegida en Configuración → Categorías. */
  imagen_url?: string | null;
}

interface StoreCatalogProps {
  /**
   * La portada YA calculada por el server: tarjetas de categoría y la fila de
   * 8 productos (los destacados si el comercio marcó alguno, si no los recién
   * llegados). Es lo único que viaja en el HTML — el catálogo completo lo pide
   * este componente aparte. Ver `calcularPortada`.
   */
  portadaInicial: PortadaCatalogo | null;
  config?: ConfiguracionPOS | null;
  categorias?: CategoriaProp[];
}

const ordenOptions: OrdenOption[] = [
  { value: DEFAULT_ORDEN, label: "Más vendidos" },
  { value: "recientes", label: "Últimos ingresos" },
  { value: "menor_precio", label: "Menor precio" },
  { value: "mayor_precio", label: "Mayor precio" },
];
const ORDEN_VALIDOS = new Set(ordenOptions.map((o) => o.value));

/**
 * Los params que `generateMetadata` de la página lee para armar título,
 * canonical y preview del link. Cambiar uno de estos obliga a volver al
 * server; el resto se resuelve entero en el navegador.
 *
 * Si algún día `generateMetadata` empieza a mirar otro param, va acá también
 * — si no, ese link compartido va a mostrar el título de otra cosa.
 */
const PARAMS_CON_METADATA = new Set(["categoria", "sub", "productos"]);

const PARAMS_RESERVADOS = new Set([
  "q",
  "categoria",
  "sub",
  "orden",
  "productos",
  // `ver` alterna portada/grilla completa: si no estuviera acá, una propiedad
  // de variante llamada "Ver" lo pisaría.
  PARAM_VER_TODO,
]);

export function StoreCatalog({
  portadaInicial,
  config,
  categorias,
}: Readonly<StoreCatalogProps>) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }
    >
      <CatalogContent
        portadaInicial={portadaInicial}
        config={config}
        categorias={categorias}
      />
    </Suspense>
  );
}

function CatalogContent({
  portadaInicial,
  config,
  categorias,
}: Readonly<StoreCatalogProps>) {
  /**
   * El índice completo, que ya no viene en el HTML.
   *
   * `null` = todavía no llegó. Mientras tanto la portada se dibuja con lo que
   * calculó el server (`portadaInicial`), así que el visitante que entra a la
   * home ve el catálogo sin esperar nada; el índice se usa recién cuando hay
   * que filtrar, buscar o entrar a una categoría.
   *
   * Se pide siempre, no solo al salir de la portada: el que va a filtrar
   * empieza a moverse en el primer segundo, y esperar a su primer click para
   * recién ahí arrancar la descarga le suma el viaje entero a esa interacción.
   */
  const [indice, setIndice] = useState<Producto[] | null>(null);

  useEffect(() => {
    let vigente = true;
    getIndiceCatalogoPublicoAction()
      .then((res) => {
        if (vigente && res.data) setIndice(res.data as Producto[]);
      })
      .catch((e) => {
        // Sin índice el catálogo queda en la portada, que es una degradación
        // legible; que no sea silenciosa igual, porque significa que no se
        // puede buscar ni filtrar.
        console.error("[CATALOGO] No se pudo cargar el índice:", e);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const productos = indice ?? [];
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchQuery = searchParams.get("q") || "";

  // --- ?productos=id1,id2,... — selección curada, gana sobre el resto ---
  // El parseo es el mismo que usa generateMetadata para armar el preview del
  // link: si divergen, la imagen compartida no coincide con lo que se abre.
  const idsSeleccionados = useMemo(() => {
    const ids = parsearIdsSeleccion(searchParams.get("productos"));
    return ids.length > 0 ? new Set(ids) : null;
  }, [searchParams]);
  const modoSeleccion = idsSeleccionados !== null;
  const productosBase = modoSeleccion
    ? productos.filter((p) => idsSeleccionados.has(p.id))
    : productos;

  const categoriasBase = useMemo(
    () =>
      (categorias || []).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        slug: c.slug || "",
        parent_id: c.parent_id ?? null,
      })),
    [categorias],
  );

  // El árbol de categorías no transporta la portada (no la necesita para
  // filtrar), así que se busca acá contra las filas crudas.
  const portadaPorCategoriaId = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categorias || []) {
      if (cat.imagen_url) map.set(cat.id, cat.imagen_url);
    }
    return map;
  }, [categorias]);

  // --- categoria (?categoria=<slug>) + sub (?sub=<slug>) ---
  // La identidad (padre/hijo) se resuelve contra la lista PLANA de
  // categorías, sin importar stock — así un link viejo a lo que hoy es
  // una subcategoría (ej. ?categoria=boxer, compartido antes de que Boxer
  // se re-parentara bajo Ropa Hombre) sigue resolviendo a los mismos
  // productos aunque la URL canónica hoy sea otra.
  const categoriaParam = searchParams.get("categoria");
  const subParam = searchParams.get("sub");

  const resolucion = useMemo(() => {
    if (!categoriaParam) return null;
    return resolverCategoriaPorSlug(categoriasBase, categoriaParam);
  }, [categoriaParam, categoriasBase]);

  // Si vino &sub= explícito, tiene que matchear una subcategoría REAL del
  // mismo padre resuelto arriba — si no matchea nada, se ignora (se
  // degrada a "Todo <Padre>" en vez de romper el filtro).
  const subResuelto = useMemo(() => {
    if (!subParam || !resolucion) return null;
    const key = subParam.toLowerCase();
    const match = categoriasBase.find(
      (c) =>
        c.parent_id === resolucion.padreId &&
        (c.id.toLowerCase() === key || c.slug.toLowerCase() === key),
    );
    return match?.id ?? null;
  }, [subParam, resolucion, categoriasBase]);

  const tipo = useMemo(() => {
    if (!resolucion) return DEFAULT_TIPO;
    if (subResuelto) return subResuelto;
    if (resolucion.hijoId) return resolucion.hijoId;
    return resolucion.padreId;
  }, [resolucion, subResuelto]);

  // --- orden (?orden=<valor>) ---
  const ordenParam = searchParams.get("orden");
  const orden =
    ordenParam && ORDEN_VALIDOS.has(ordenParam) ? ordenParam : DEFAULT_ORDEN;

  // 🚀 NUEVO: Filtramos los productos por la categoría activa y la búsqueda
  // ANTES de extraer las variantes, para que los filtros sean contextuales.
  const productosContextuales = useMemo(() => {
    if (modoSeleccion) return productosBase;

    return productosBase.filter((p) => {
      // 1. Filtro por Búsqueda de texto
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchBuscador =
          p.nombre?.toLowerCase().includes(q) ||
          p.tipo?.toLowerCase().includes(q) ||
          p.descripcion?.toLowerCase().includes(q);
        if (!matchBuscador) return false;
      }

      // 2. Filtro por Categoría activa
      if (tipo !== DEFAULT_TIPO) {
        // `categoria_id` está en el tipo Producto (lo usa useCatalogFilters
        // directo); el `as any` que había acá no hacía falta.
        const catId = p.categoria_id;
        if (!catId) return false;

        // Match exacto (Ej: Seleccionó Hombre y el producto es Hombre)
        if (catId === tipo) return true;

        // Match por subcategoría (Ej: Seleccionó Hombre y el producto es Remeras Hombre)
        const catDelProducto = categoriasBase.find(c => c.id === catId);
        if (catDelProducto?.parent_id === tipo) return true;

        return false;
      }

      return true;
    });
  }, [productosBase, modoSeleccion, searchQuery, tipo, categoriasBase]);

  const propiedadesGlobales = useMemo(
    () =>
      buildPropiedadesFiltro(productosContextuales, {
        ocultarSinStock: config?.mostrar_sin_stock === false,
        incluirStockLegacy: false,
        // Los colores se muestran agrupados en familias con su muestra de
        // color; el valor crudo se sigue viendo en la ficha del producto.
        agruparColores: true,
      }),
    [productosContextuales, config],
  );

  // Multi-valor: `?color=Azul,Negro`. Un link viejo de un solo valor parsea a
  // un array de uno y filtra igual que antes.
  const filtrosVariantes = useMemo(() => {
    if (modoSeleccion) return {};
    const result: Record<string, string[]> = {};
    for (const propName of Object.keys(propiedadesGlobales)) {
      const paramName = slugify(propName);
      if (PARAMS_RESERVADOS.has(paramName)) continue;
      const valores = parsearValoresFiltro(searchParams.get(paramName));
      if (valores.length > 0) result[propName] = valores;
    }
    return result;
  }, [searchParams, propiedadesGlobales, modoSeleccion]);

  const [visibleCount, setVisibleCount] = useState(ITEMS_POR_PAGINA);

  const {
    arbolCategorias,
    productosFiltrados,
    productosVisibles,
    hayMasProductos,
    hayFiltrosActivos,
    matchesFueraDeCategoria,
    resolverCategoriaIdDeProducto,
  } = useCatalogFilters({
    productos: productosBase,
    categorias,
    config,
    searchQuery: modoSeleccion ? "" : searchQuery,
    tipo: modoSeleccion ? DEFAULT_TIPO : tipo,
    filtrosVariantes,
    orden,
    visibleCount,
  });

  const resetVisibleCount = () => setVisibleCount(ITEMS_POR_PAGINA);

  // --- portada vs. grilla completa ---
  const verTodo = searchParams.get(PARAM_VER_TODO) === VALOR_VER_TODO;
  // El `length > 0` no está en esModoPortada porque no es una decisión de
  // navegación sino de datos: si el catálogo tiene productos cargados pero
  // ninguno visible (todo sin stock con `mostrar_sin_stock: false`), la
  // portada quedaría en una pantalla con un botón que dice "Ver los 0
  // productos". Ahí conviene caer al estado vacío de la grilla.
  // Separado en dos: `modoPortadaUrl` depende SOLO de la URL, así que se puede
  // responder antes de que llegue el índice — es lo que permite dibujar la
  // portada del server sin tener el catálogo todavía. El de abajo le suma la
  // condición de datos, que recién se puede evaluar con el índice cargado.
  const modoPortadaUrl = esModoPortada({
    modoSeleccion,
    tipo,
    searchQuery,
    verTodo,
    cantidadFiltrosVariante: Object.keys(filtrosVariantes).length,
  });
  const modoPortada = modoPortadaUrl && productosFiltrados.length > 0;

  // `productosFiltrados` en la portada equivale a "todo lo visible" (sin
  // categoría, sin búsqueda, sin filtros), así que sirve de base tanto para la
  // fila de 8 como para el total del botón de salida.
  const fila = useMemo(
    () =>
      modoPortada
        ? seleccionPortada(productosFiltrados)
        : { productos: [], origen: "recientes" as const },
    [modoPortada, productosFiltrados],
  );

  const categoriasPortada = useMemo(() => {
    if (!modoPortada) return [];

    // Un padre no tiene productos propios: su rama son él y sus hijos. Las
    // categorías sueltas (sin padre) entran como una rama de uno.
    const entradas = [
      ...arbolCategorias.padres.map((padre) => ({
        id: padre.id,
        nombre: padre.nombre,
        count: padre.count,
        idsRama: [padre.id, ...padre.hijos.map((h) => h.id)],
        imagenConfigurada: portadaPorCategoriaId.get(padre.id) ?? null,
      })),
      ...arbolCategorias.sinPadre.map((cat) => ({
        id: cat.id,
        nombre: cat.nombre,
        count: cat.count,
        idsRama: [cat.id],
        imagenConfigurada: portadaPorCategoriaId.get(cat.id) ?? null,
      })),
    ];

    return construirPortadaCategorias({
      entradas,
      productos: productosFiltrados,
      resolverCategoriaId: resolverCategoriaIdDeProducto,
    });
  }, [
    modoPortada,
    arbolCategorias,
    productosFiltrados,
    resolverCategoriaIdDeProducto,
    portadaPorCategoriaId,
  ]);

  const updateParams = (
    entries: Record<string, string | null>,
    mode: "push" | "replace",
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(entries)) {
      if (value) params.set(name, value);
      else params.delete(name);
    }

    const url = params.toString() ? `${pathname}?${params}` : pathname;

    // Filtrar NO es navegar.
    //
    // Todo esto pasaba por el router, o sea un viaje al server por cada tap
    // de talle o de orden: la ruta es `force-dynamic`, así que reejecutaba el
    // tenant, la config, las categorías y el render entero para responder algo
    // que el cliente ya sabe — el filtrado vive acá, en `useCatalogFilters`.
    //
    // El corte no es una preferencia: son exactamente los params que lee
    // `generateMetadata` de la página (`categoria`, `sub`, `productos`). Esos
    // cambian el título, el canonical y el preview del link compartido, así
    // que tienen que pasar por el router para que el server los regenere.
    // El resto —talles, color, orden, `ver`, la búsqueda— no aparece en
    // ninguna metadata, y la History API alcanza: Next actualiza
    // `useSearchParams` sin volver a pedir la página.
    const tocaMetadata = Object.keys(entries).some((name) =>
      PARAMS_CON_METADATA.has(name),
    );

    if (tocaMetadata) {
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
      return;
    }

    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  // Canonicaliza links viejos: si `categoria` resolvió directo a lo que
  // hoy es una subcategoría (sin &sub= explícito todavía), reescribe la
  // URL a la forma padre+sub sin agregar entrada al historial — mismos
  // productos filtrados de siempre, el link viejo sigue funcionando.
  useEffect(() => {
    if (!resolucion?.hijoId || subResuelto) return;
    const padre = categoriasBase.find((c) => c.id === resolucion.padreId);
    const hijo = categoriasBase.find((c) => c.id === resolucion.hijoId);
    if (!padre?.slug || !hijo?.slug) return;
    updateParams({ categoria: padre.slug, sub: hijo.slug }, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolucion, subResuelto, categoriasBase]);

  // Salir de una categoría vuelve a la PORTADA, no a la grilla completa: por
  // eso también se limpia `ver`. Para ver todo con filtros está el botón
  // explícito de la portada.
  const handleSelectTodos = () => {
    resetVisibleCount();
    updateParams({ categoria: null, sub: null, [PARAM_VER_TODO]: null }, "push");
  };

  const handleVerTodo = () => {
    resetVisibleCount();
    updateParams({ [PARAM_VER_TODO]: VALOR_VER_TODO }, "push");
  };

  // Un solo id de entrada: puede ser un padre (entra a nivel 2 / "Todo
  // <Padre>"), un hijo (nivel 2 con ese hijo activo), o una categoría
  // suelta (comportamiento plano de siempre).
  const handleSelectCategoria = (id: string) => {
    resetVisibleCount();
    // `ver` se limpia siempre: adentro de una categoría la grilla con filtros
    // acotados es el comportamiento por defecto, no hace falta el flag.
    const salirDeVerTodo = { [PARAM_VER_TODO]: null };

    const padre = arbolCategorias.padres.find((p) => p.id === id);
    if (padre) {
      updateParams({ categoria: padre.slug, sub: null, ...salirDeVerTodo }, "push");
      return;
    }

    const padreDeHijo = arbolCategorias.padres.find((p) =>
      p.hijos.some((h) => h.id === id),
    );
    if (padreDeHijo) {
      const hijo = padreDeHijo.hijos.find((h) => h.id === id)!;
      updateParams(
        { categoria: padreDeHijo.slug, sub: hijo.slug, ...salirDeVerTodo },
        "push",
      );
      return;
    }

    const cat = categoriasBase.find((c) => c.id === id);
    updateParams(
      { categoria: cat?.slug ?? id, sub: null, ...salirDeVerTodo },
      "push",
    );
  };

  const handleOrdenChange = (value: string) => {
    resetVisibleCount();
    updateParams({ orden: value === DEFAULT_ORDEN ? null : value }, "replace");
  };

  // Toggle: tocar un valor ya elegido lo desmarca. Es lo que permite tener
  // varios colores puestos y sacar uno solo sin limpiar todo.
  const handleToggleValorFiltro = (propiedad: string, valor: string) => {
    resetVisibleCount();
    const paramName = slugify(propiedad);
    if (PARAMS_RESERVADOS.has(paramName)) return;

    const actuales = filtrosVariantes[propiedad] ?? [];
    const siguiente = alternarValorFiltro(actuales, valor);
    updateParams({ [paramName]: serializarValoresFiltro(siguiente) }, "push");
  };

  /**
   * Limpia SÓLO los filtros de variante y la búsqueda — la categoría en la que
   * estás parado se conserva.
   *
   * Antes esto hacía `router.replace(pathname)`, que borraba todo: estando en
   * "Ropa Mujer" con dos colores puestos, tocar Limpiar te devolvía a la
   * portada. Con los filtros escondidos en un dropdown casi no se notaba; con
   * el botón a la vista en el panel es el camino obvio para sacarse un color
   * de encima.
   */
  const limpiarFiltros = () => {
    resetVisibleCount();
    const aBorrar: Record<string, string | null> = { q: null };
    for (const propName of Object.keys(propiedadesGlobales)) {
      const paramName = slugify(propName);
      if (PARAMS_RESERVADOS.has(paramName)) continue;
      aBorrar[paramName] = null;
    }
    updateParams(aBorrar, "replace");
  };

  // --- Todavía sin índice ---
  // En la portada no se nota: se dibuja con lo que ya calculó el server, que
  // es exactamente lo mismo que dibujaría el cliente. Fuera de la portada
  // (una categoría, una búsqueda, un link compartido) hace falta el catálogo
  // para responder, y ahí sí se espera.
  //
  // El chequeo de "catálogo vacío" va DESPUÉS de este: sin índice `productos`
  // es un array vacío, y sin esta guarda toda visita mostraría "Catálogo
  // vacío" por un instante antes de dibujar la tienda.
  if (indice === null) {
    if (modoPortadaUrl && portadaInicial && portadaInicial.totalProductos > 0) {
      return (
        <StoreHome
          categorias={portadaInicial.categorias}
          productos={portadaInicial.productos}
          origen={portadaInicial.origen}
          totalProductos={portadaInicial.totalProductos}
          onSelectCategoria={handleSelectCategoria}
          onVerTodo={handleVerTodo}
        />
      );
    }

    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (productos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <ShoppingBag
          className="w-16 h-16 text-muted-foreground/20 mb-6"
          strokeWidth={1}
        />
        <h2 className="text-2xl font-light text-foreground tracking-tight">
          Catálogo vacío
        </h2>
      </div>
    );
  }

  // Portada: categorías + recién llegados, SIN la barra de filtros. Los
  // filtros de variante sobre el catálogo entero eran ilegibles (todos los
  // talles y todos los colores del local juntos); adentro de una categoría el
  // mismo componente ya sale acotado, porque `propiedadesGlobales` se calcula
  // sobre `productosContextuales`.
  if (modoPortada) {
    return (
      <StoreHome
        categorias={categoriasPortada}
        productos={fila.productos}
        origen={fila.origen}
        totalProductos={productosFiltrados.length}
        onSelectCategoria={handleSelectCategoria}
        onVerTodo={handleVerTodo}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Los chips de categoría quedan arriba de todo: adentro de una
          categoría muestran sus SUBcategorías, que es navegación y no
          filtrado. Por eso no se mudan al aside. */}
      {!modoSeleccion && (
        <CategoryPills
          tipoActivo={tipo}
          arbolCategorias={arbolCategorias}
          onSelectTodos={handleSelectTodos}
          onSelectCategoria={handleSelectCategoria}
          volverAInicio={verTodo}
        />
      )}

      <div className="flex gap-8">
        {/* ASIDE DE FILTROS (desktop). `sticky` con su propio scroll: en una
            categoría con muchos talles el panel es más alto que la pantalla y
            si no, el final quedaba inalcanzable. */}
        {!modoSeleccion && (
          <aside className="hidden lg:block w-60 xl:w-64 shrink-0">
            <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 scrollbar-hide">
              <FiltrosPanel
                propiedadesGlobales={propiedadesGlobales}
                filtrosVariantes={filtrosVariantes}
                onToggleValor={handleToggleValorFiltro}
                onLimpiarFiltros={limpiarFiltros}
                hayFiltrosActivos={hayFiltrosActivos}
                orden={orden}
                ordenOptions={ordenOptions}
                onOrdenChange={handleOrdenChange}
              />
            </div>
          </aside>
        )}

        <div className="min-w-0 flex-1 space-y-6">
          {!modoSeleccion && (
            <>
              <BarraCatalogo
                totalResultados={productosFiltrados.length}
                propiedadesGlobales={propiedadesGlobales}
                filtrosVariantes={filtrosVariantes}
                onToggleValor={handleToggleValorFiltro}
                onLimpiarFiltros={limpiarFiltros}
                hayFiltrosActivos={hayFiltrosActivos}
                orden={orden}
                ordenOptions={ordenOptions}
                onOrdenChange={handleOrdenChange}
              />

              {tipo !== DEFAULT_TIPO && matchesFueraDeCategoria > 0 && (
                <button
                  type="button"
                  onClick={handleSelectTodos}
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
                >
                  Ver {matchesFueraDeCategoria} resultado
                  {matchesFueraDeCategoria === 1 ? "" : "s"} más en todo el
                  catálogo
                </button>
              )}
            </>
          )}

          {productosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <SearchX
                className="w-12 h-12 text-muted-foreground/30 mb-4"
                strokeWidth={1}
              />
              <h2 className="text-xl font-medium text-foreground tracking-tight">
                No encontramos resultados
              </h2>
              <Button
                variant="link"
                className="mt-4 text-foreground underline underline-offset-4"
                onClick={limpiarFiltros}
              >
                Limpiar filtros
              </Button>
            </div>
          ) : (
            <>
              {/* La cuarta columna vuelve en xl. No es sólo estética: las
                  imágenes de grilla se guardan a 480px de lado máximo, así
                  que a 3 columnas en una pantalla de 1280px cada card queda
                  en ~300px CSS y en retina pide 600px reales — de ahí que se
                  vieran pixeladas. Con 4 columnas la card baja a ~224px, que
                  en retina pide 448px y entra dentro del original. */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12">
                {productosVisibles.map((producto, index) => (
                  <ProductCard
                    key={producto.id}
                    producto={producto}
                    priority={index < 8}
                  />
                ))}
              </div>

              {hayMasProductos && (
                <div className="flex justify-center pt-12 pb-8">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() =>
                      setVisibleCount((prev) => prev + ITEMS_POR_PAGINA)
                    }
                    className="w-full sm:w-auto font-bold rounded-none border-border shadow-none text-foreground px-12 uppercase tracking-widest text-xs transition-colors h-14 cursor-pointer"
                  >
                    <Plus className="mr-2 h-4 w-4" /> Cargar más
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
