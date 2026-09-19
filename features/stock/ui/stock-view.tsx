"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProductoIndice } from "@/entities/productos/types";
import {
  buildPropiedadesFiltro,
  resolverAtributosVariante,
} from "@/entities/productos/lib/build-propiedades-filtro";
import { StockTable } from "./stock-table";
import { StockGrid } from "./stock-grid";
import { Button } from "@/shared/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StockFiltersToolbar } from "./stock-filters-toolbar";
import { getTotalStock } from "../lib/stock-product-utils";
import { createClient } from "@/shared/config/supabase/client";
import { construirArbolCategorias } from "@/shared/utils/category-tree";
import type { Rubro } from "@/entities/config/types";
import { useSlugNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useSeleccionProductos } from "../hooks/use-seleccion-productos";
import { BarraSeleccion } from "./seleccion/barra-seleccion";
import {
  useFinalizarSeleccion,
  type CtxSeleccion,
} from "./seleccion/acciones-masivas";

interface StockViewProps {
  productosIndice: ProductoIndice[];
  userRole: string;
  nombreComercio: string;
  mostrarSinStock: boolean;
  rubro: Rubro;
  /** Total de productos del negocio, contado en el server. Distinto de
   * `productosIndice.length`, que puede venir recortado por el tope de filas
   * de PostgREST — justo en 1000, que es el límite del plan Emprendedor. */
  productosDelNegocio?: number;
}

interface CategoriaDB {
  id: string;
  nombre: string;
  slug: string;
  parent_id: string | null;
}

const ITEMS_POR_PAGINA = 12;
const SEARCH_DEBOUNCE_MS = 300;

export function StockView({
  productosIndice,
  userRole,
  nombreComercio,
  mostrarSinStock,
  rubro,
  productosDelNegocio,
}: Readonly<StockViewProps>) {
  const [view, setView] = useState<"table" | "grid">("table");
  const [paginaActual, setPaginaActual] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [categoriaActiva, setCategoriaActiva] = useState("todos");
  const [filtrosVariantes, setFiltrosVariantes] = useState<
    Record<string, string>
  >({});
  const [orden, setOrden] = useState("nombre_asc");
  const [categoriasDB, setCategoriasDB] = useState<CategoriaDB[]>([]);

  const isAdmin = userRole === "ADMIN";

  // Fetch liviano de categorías reales (con parent_id) — separado del
  // índice de productos, que ya trae categoria:{id,nombre,slug} por
  // producto pero no la relación padre/hijo en sí.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categorias")
      .select("id, nombre, slug, parent_id")
      .eq("activa", true)
      .then(({ data }) => {
        if (data) setCategoriasDB(data as CategoriaDB[]);
      });
  }, []);

  // Sin fetch de por medio, el debounce es solo para no re-filtrar/
  // ordenar/paginar en cada tecla — la caja de texto sigue respondiendo al
  // instante (searchQuery), el filtrado usa la versión debounced.
  useEffect(() => {
    const timer = setTimeout(
      () => setSearchDebounced(searchQuery),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Misma lógica de filtrado de siempre (buildPropiedadesFiltro /
  // resolverAtributosVariante no cambiaron), corriendo ahora sobre el
  // índice liviano en vez del catálogo completo con todas las columnas.
  //
  // Ya no se pide `incluirFallbackRelacional`: el índice dejó de traer
  // `producto_variante_valores` porque ese fallback no se activaba nunca (solo
  // corre con `atributos` vacío, y no hay ninguna variante así en los seis
  // negocios). Pedirlo acá sería declarar que se usa un dato que no llega.
  // El fallback por `nombre_display`, que es el que de verdad rescata las 72
  // variantes sin atributos, sigue en pie sin ningún flag.
  const propiedadesGlobales = useMemo(
    () => buildPropiedadesFiltro(productosIndice),
    [productosIndice],
  );

  const matchSearchYVariantes = useCallback(
    (p: ProductoIndice) => {
      const matchSearch = p.nombre
        ?.toLowerCase()
        .includes(searchDebounced.toLowerCase());

      const matchVariantes = Object.entries(filtrosVariantes).every(
        ([propiedad, valor]) => {
          if (valor === "todos") return true;

          return (
            p.producto_variantes?.some((variante) => {
              const atributos = resolverAtributosVariante(variante);
              return (
                atributos[propiedad]?.toLowerCase() === valor.toLowerCase()
              );
            }) ?? false
          );
        },
      );

      return matchSearch && matchVariantes;
    },
    [searchDebounced, filtrosVariantes],
  );

  // Lookup id/slug/nombre (lowercased) -> id real de categoría — mismo
  // criterio que use-catalog-filters.ts, para que tanto productos con
  // categoria_id real como los legacy que solo traen `tipo` (texto libre)
  // se crediten a la misma categoría real cuando corresponda.
  const categoriaIdPorClave = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categoriasDB) {
      map.set(cat.id.toLowerCase(), cat.id);
      if (cat.slug) map.set(cat.slug.toLowerCase(), cat.id);
      if (cat.nombre) map.set(cat.nombre.toLowerCase(), cat.id);
    }
    return map;
  }, [categoriasDB]);

  const resolverCategoriaIdDeProducto = useCallback(
    (p: ProductoIndice): string => {
      const porRelacionId = p.categoria?.id
        ? categoriaIdPorClave.get(p.categoria.id.toLowerCase())
        : undefined;
      if (porRelacionId) return porRelacionId;
      const porNombre = p.categoria?.nombre
        ? categoriaIdPorClave.get(p.categoria.nombre.toLowerCase())
        : undefined;
      if (porNombre) return porNombre;
      const porTipo = p.tipo
        ? categoriaIdPorClave.get(p.tipo.toLowerCase())
        : undefined;
      if (porTipo) return porTipo;
      return (
        p.categoria?.id ||
        p.categoria?.nombre ||
        p.tipo ||
        "sin-categoria"
      ).toLowerCase();
    },
    [categoriaIdPorClave],
  );

  // Set filtrado por búsqueda + variantes, SIN el filtro de categoría — es
  // la base tanto de la tabla (con matchCat sumado abajo) como de los
  // contadores facetados de cada chip (que nunca deben filtrarse por su
  // propia categoría, si no cada chip terminaría mostrando su propio total).
  const productosFiltradosSinCategoria = useMemo(
    () => productosIndice.filter(matchSearchYVariantes),
    [productosIndice, matchSearchYVariantes],
  );

  // Árbol de categorías: existencia = TODO el índice sin filtrar (un chip
  // no debería aparecer/desaparecer con la búsqueda, solo su número);
  // mostrado = con búsqueda+variante aplicados (facetado).
  const conteosExistencia = useMemo(() => {
    const conteos: Record<string, number> = {};
    productosIndice.forEach((p) => {
      const id = resolverCategoriaIdDeProducto(p);
      conteos[id] = (conteos[id] || 0) + 1;
    });
    return conteos;
  }, [productosIndice, resolverCategoriaIdDeProducto]);

  const conteosMostrados = useMemo(() => {
    const conteos: Record<string, number> = {};
    productosFiltradosSinCategoria.forEach((p) => {
      const id = resolverCategoriaIdDeProducto(p);
      conteos[id] = (conteos[id] || 0) + 1;
    });
    return conteos;
  }, [productosFiltradosSinCategoria, resolverCategoriaIdDeProducto]);

  const arbolCategorias = useMemo(
    () =>
      construirArbolCategorias(
        categoriasDB,
        conteosExistencia,
        conteosMostrados,
      ),
    [categoriasDB, conteosExistencia, conteosMostrados],
  );

  const hijosIdsPorPadreId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const padre of arbolCategorias.padres) {
      map.set(padre.id, new Set(padre.hijos.map((h) => h.id)));
    }
    return map;
  }, [arbolCategorias]);

  const idsAMatchear = useMemo(() => {
    if (categoriaActiva === "todos") return null;
    const hijos = hijosIdsPorPadreId.get(categoriaActiva);
    if (hijos) return new Set([categoriaActiva, ...hijos]);
    return new Set([categoriaActiva]);
  }, [categoriaActiva, hijosIdsPorPadreId]);

  const productosFiltrados = useMemo(() => {
    if (idsAMatchear === null) return productosFiltradosSinCategoria;
    return productosFiltradosSinCategoria.filter((p) =>
      idsAMatchear.has(resolverCategoriaIdDeProducto(p)),
    );
  }, [
    productosFiltradosSinCategoria,
    idsAMatchear,
    resolverCategoriaIdDeProducto,
  ]);

  // Búsqueda transversal: cuántos resultados matchean búsqueda+variante
  // por fuera de la categoría/subcategoría activa.
  const resultadosFueraDeCategoria = useMemo(() => {
    if (categoriaActiva === "todos") return 0;
    return Math.max(
      0,
      productosFiltradosSinCategoria.length - productosFiltrados.length,
    );
  }, [categoriaActiva, productosFiltradosSinCategoria, productosFiltrados]);

  // El sort corre acá, sobre TODO el set filtrado, antes de paginar. Antes
  // vivía adentro de stock-table.tsx y solo reordenaba los 10 productos de
  // la página visible — cambiar de página no respetaba el orden elegido.
  const productosOrdenados = useMemo(() => {
    const arr = [...productosFiltrados];
    arr.sort((a, b) => {
      switch (orden) {
        case "nombre_asc":
          return a.nombre.localeCompare(b.nombre);
        case "nombre_desc":
          return b.nombre.localeCompare(a.nombre);
        case "stock_desc":
          return getTotalStock(b) - getTotalStock(a);
        case "stock_asc":
          return getTotalStock(a) - getTotalStock(b);
        case "costo_desc":
          return (b.precio_costo || 0) - (a.precio_costo || 0);
        case "costo_asc":
          return (a.precio_costo || 0) - (b.precio_costo || 0);
        case "precio_desc":
          return b.precio - a.precio;
        case "precio_asc":
          return a.precio - b.precio;
        case "categoria_asc":
          return (a.tipo || "").localeCompare(b.tipo || "");
        case "categoria_desc":
          return (b.tipo || "").localeCompare(a.tipo || "");
        default:
          return 0;
      }
    });
    return arr;
  }, [productosFiltrados, orden]);

  const totalPaginas = Math.ceil(productosOrdenados.length / ITEMS_POR_PAGINA);

  // Página visible: un slice puro en memoria sobre el índice ya filtrado/
  // ordenado — sin fetch de por medio. ProductoIndice ya trae lo que la
  // tabla/grid necesitan para renderizar (imagen, slug, publicado); el
  // detalle completo de un producto puntual lo pide su propio sheet de
  // edición al abrirse (ver edit-sheet.tsx), no la lista.
  const productosPagina = useMemo(
    () =>
      productosOrdenados.slice(
        (paginaActual - 1) * ITEMS_POR_PAGINA,
        paginaActual * ITEMS_POR_PAGINA,
      ),
    [productosOrdenados, paginaActual],
  );

  // --- SELECCIÓN MÚLTIPLE ---
  // Vive acá y no en la tabla a propósito: así sobrevive a cambiar de página
  // y de vista, y "seleccionar todo lo filtrado" puede abarcar el set entero
  // (productosOrdenados), no solo la página visible.
  const idsFiltrados = useMemo(
    () => productosOrdenados.map((p) => p.id),
    [productosOrdenados],
  );
  const idsPagina = useMemo(
    () => productosPagina.map((p) => p.id),
    [productosPagina],
  );
  const seleccion = useSeleccionProductos({ idsFiltrados, idsPagina });

  const productosSeleccionados = useMemo(
    () => productosOrdenados.filter((p) => seleccion.ids.has(p.id)),
    [productosOrdenados, seleccion.ids],
  );

  const slugNegocio = useSlugNegocioActivo() ?? "";
  const finalizarSeleccion = useFinalizarSeleccion(seleccion.limpiar);

  const ctxSeleccion: CtxSeleccion = useMemo(
    () => ({
      ids: seleccion.idsArray,
      productos: productosSeleccionados,
      isAdmin,
      nombreComercio,
      mostrarSinStock,
      slugNegocio,
      categoriasArbol: categoriasDB,
      finalizar: finalizarSeleccion,
    }),
    [
      seleccion.idsArray,
      productosSeleccionados,
      isAdmin,
      nombreComercio,
      mostrarSinStock,
      slugNegocio,
      categoriasDB,
      finalizarSeleccion,
    ],
  );

  const hayFiltrosActivos =
    searchQuery !== "" ||
    categoriaActiva !== "todos" ||
    Object.values(filtrosVariantes).some((valor) => valor !== "todos");

  // Padres primero (con hijos embebidos), después las categorías sueltas
  // — mismo orden/patrón que CategoryPills en el catálogo público y que
  // pos-terminal.tsx.
  const categoriasDisponibles = useMemo(
    () => [
      ...arbolCategorias.padres.map((padre) => ({
        nombre: padre.nombre,
        value: padre.id,
        count: padre.count,
        hijos: padre.hijos.map((h) => ({
          nombre: h.nombre,
          value: h.id,
          count: h.count,
        })),
      })),
      ...arbolCategorias.sinPadre.map((cat) => ({
        nombre: cat.nombre,
        value: cat.id,
        count: cat.count,
      })),
    ],
    [arbolCategorias],
  );

  const categoriaActivaObj = useMemo(
    () => categoriasDB.find((c) => c.id === categoriaActiva) ?? null,
    [categoriasDB, categoriaActiva],
  );
  const slugCategoriaActiva = categoriaActivaObj?.slug ?? null;
  const nombreCategoriaActiva = categoriaActivaObj?.nombre ?? categoriaActiva;

  const limpiarFiltros = () => {
    setSearchQuery("");
    setCategoriaActiva("todos");
    setFiltrosVariantes({});
    setPaginaActual(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPaginaActual(1);
  };

  const handleCategoriaChange = (categoria: string) => {
    setCategoriaActiva(categoria);
    setPaginaActual(1);
  };

  const handleFiltroVarianteChange = (propiedad: string, valor: string) => {
    setFiltrosVariantes((current) => ({
      ...current,
      [propiedad]: valor,
    }));
    setPaginaActual(1);
  };

  const handleSort = (nuevoOrden: string) => {
    setOrden(nuevoOrden);
    setPaginaActual(1);
  };

  return (
    <div className="space-y-4 px-2 md:px-4">
      {/* El toolbar NO se apila con la barra de selección: se reemplaza. Misma
          posición, misma altura, cero reflow al entrar y salir del modo. */}
      {seleccion.cantidad > 0 ? (
        <BarraSeleccion seleccion={seleccion} ctx={ctxSeleccion} />
      ) : (
        <StockFiltersToolbar
          rubro={rubro}
          view={view}
          onViewChange={setView}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          categoriaActiva={categoriaActiva}
          onCategoriaChange={handleCategoriaChange}
          categoriasDisponibles={categoriasDisponibles}
          totalProductos={productosIndice.length}
          productosDelNegocio={productosDelNegocio}
          resultadosFueraDeCategoria={resultadosFueraDeCategoria}
          hayFiltrosActivos={hayFiltrosActivos}
          propiedadesGlobales={propiedadesGlobales}
          filtrosVariantes={filtrosVariantes}
          onFiltroVarianteChange={handleFiltroVarianteChange}
          isAdmin={isAdmin}
          onLimpiarFiltros={limpiarFiltros}
          slugCategoriaActiva={slugCategoriaActiva}
          nombreCategoriaActiva={nombreCategoriaActiva}
          nombreComercio={nombreComercio}
        />
      )}

      {/* 3. VISTAS */}
      <div className="bg-background rounded-xl border border-border overflow-hidden min-h-100 relative">
        {view === "table" ? (
          <StockTable
            productos={productosPagina}
            userRole={userRole}
            nombreComercio={nombreComercio}
            mostrarSinStock={mostrarSinStock}
            orden={orden}
            onSort={handleSort}
            categoriasArbol={categoriasDB}
            rubro={rubro}
            seleccion={seleccion}
          />
        ) : (
          <StockGrid
            productos={productosPagina}
            userRole={userRole}
            nombreComercio={nombreComercio}
            mostrarSinStock={mostrarSinStock}
            categorias={categoriasDB}
            rubro={rubro}
            seleccion={seleccion}
          />
        )}
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4 border-t border-border mt-4">
          <span className="text-xs font-medium text-muted-foreground">
            Mostrando{" "}
            {Math.min(
              productosOrdenados.length,
              (paginaActual - 1) * ITEMS_POR_PAGINA + 1,
            )}{" "}
            a{" "}
            {Math.min(
              productosOrdenados.length,
              paginaActual * ITEMS_POR_PAGINA,
            )}{" "}
            de {productosOrdenados.length} productos
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 shadow-none"
              onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
              disabled={paginaActual === 1}
            >
              <ChevronLeft className="w-4 h-4 sm:mr-1" />{" "}
              <span className="hidden sm:inline">Anterior</span>
            </Button>
            <div className="text-xs font-bold px-3">
              {paginaActual} / {totalPaginas}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shadow-none"
              onClick={() =>
                setPaginaActual((p) => Math.min(totalPaginas, p + 1))
              }
              disabled={paginaActual === totalPaginas}
            >
              <span className="hidden sm:inline">Siguiente</span>{" "}
              <ChevronRight className="w-4 h-4 sm:ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
