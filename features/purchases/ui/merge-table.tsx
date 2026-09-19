"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  aprobarOrdenAction,
  crearProductoAlVueloAction,
} from "../actions/merge-purchase";
import {
  getMergeDraft,
  saveMergeDraft,
  deleteMergeDraft,
} from "../lib/merge-draft-db";
import {
  borrarBorradorOrdenAction,
  guardarBorradorOrdenAction,
} from "../actions/carga-inicial";
import { queryKeys } from "@/shared/lib/query-keys";
import { withTimeout, TimeoutError } from "@/shared/utils/with-timeout";
import { runWithConcurrencyLimit } from "@/shared/utils/concurrency";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Save,
  ArrowLeft,
  Undo2,
  PlusCircle,
  Percent,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import {
  ItemResuelto,
  OrdenCompra,
  SugerenciaSimilitud,
} from "@/entities/compras/types";
import { Producto } from "@/entities/productos/types";
import { createClient } from "@/shared/config/supabase/client";
import { parseAttributeSegment } from "@/entities/productos/lib/parse-variant-attributes";
import { ProductMediaSection } from "@/features/stock/ui/create-product/product-media-section";
import { ProgresoOverlay } from "./progreso-overlay";
import {
  ImagenError,
  optimizarImagenesProducto,
} from "@/shared/utils/image-optimizer";
import {
  clasificarDesconocido,
  construirMapaSimilares,
  BucketDesconocido,
} from "../lib/match-classification";
import {
  clasificarProductosCompartidos,
  detectarFusiones,
} from "../lib/fusiones-remito";
import { precioAlAsociar } from "../lib/precio-al-asociar";
import {
  construirPesos,
  evaluarCandidato,
  hayEmpate,
} from "../lib/afinidad-nombre";
import {
  resolverCategoriaDisplayLabel,
  type CategoriaBase,
} from "@/shared/utils/category-tree";
import {
  CategoriaPadreHijoSelect,
  useArbolParaElegir,
} from "@/shared/components/categoria-padre-hijo-select";

interface MergeTableProps {
  orden: OrdenCompra;
  itemsOriginales: ItemResuelto[];
  productos: Producto[];
  sugerenciasSimilitud: SugerenciaSimilitud[];
  /** Borrador de ESTE modo guardado en la base (ordenes_borradores). El de
   * IndexedDB sigue existiendo y gana cuando los dos están: es el más
   * inmediato. Este es el que sobrevive a cambiar de máquina o limpiar el
   * navegador, que era el agujero real. */
  borradorServidor?: {
    items: ItemResuelto[];
    productosCreados: Producto[];
  } | null;
}

type ItemResueltoConCategoria = ItemResuelto & {
  raw_categoria?: string | null;
};

// Timeout de UI para las acciones de red disparadas desde esta pantalla:
// si no responden a tiempo, se tratan como error y el botón se destraba
// en vez de quedar "cargando" para siempre.
//
// OJO: NO se usa para aprobar la orden, a propósito. `withTimeout` rechaza
// la promesa del cliente pero el server action sigue corriendo hasta el
// final — destrabar el botón por timeout es exactamente lo que multiplicó
// el stock ×8 en Estilo Bonito el 27/07 (8 apretadas = 8 impactos). Acá
// solo cubre acciones seguras de reintentar: crear producto al vuelo
// (INSERT que, si duplica, deja un producto de más visible y borrable, no
// stock inflado en silencio).
const ACTION_TIMEOUT_MS = 100_000;

/**
 * El precio y el costo que este producto tiene HOY EN LA CAJA.
 *
 * `productos.precio` es el de cabecera y `producto_variantes.precio` el de
 * cada variante; en la venta gana la variante. Los dos números difieren en 30
 * productos de los cuatro negocios, y esta pantalla los usaba para calcular el
 * margen anterior — o sea que "conservaba" un margen sacado de un precio que
 * nadie cobra. La vista `productos_precio_efectivo` resuelve cuál es cuál y la
 * conciliación la lee desde 20260908180000.
 *
 * El `??` cubre a los productos creados al vuelo en esta misma pantalla, que
 * se inyectan en `localProductos` sin pasar por la vista: recién creados, no
 * tienen variante con precio propio, así que la cabecera ES el efectivo.
 */
function precioVigente(producto: Producto | undefined): number {
  if (!producto) return 0;
  return Number(producto.precio_efectivo ?? producto.precio) || 0;
}

function costoVigente(producto: Producto | undefined): number {
  if (!producto) return 0;
  return Number(producto.costo_efectivo ?? producto.precio_costo) || 0;
}

// --- Combobox de Búsqueda Personalizado ---
function SearchableSelect({
  productos,
  value,
  onSelect,
}: {
  productos: Producto[];
  value: string | null;
  onSelect: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Cierra el dropdown si se hace click fuera de él
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filtra los productos por el texto ingresado
  const filtered = productos.filter(
    (p) =>
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (p.tipo && p.tipo.toLowerCase().includes(search.toLowerCase())),
  );

  const selectedProduct = productos.find((p) => p.id === value);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {/* Botón Trigger (Gatillo) */}
      <div
        className="flex items-center justify-between w-full h-10 px-3 py-2 text-sm bg-card border border-border rounded-md cursor-pointer"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearch(""); // Reseteamos la búsqueda al abrir
        }}
      >
        <span
          className={`truncate ${selectedProduct ? "text-foreground font-semibold" : "text-muted-foreground"}`}
        >
          {selectedProduct
            ? `${selectedProduct.nombre} (${selectedProduct.tipo})`
            : "-- Buscar Producto --"}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground opacity-50 shrink-0 ml-2" />
      </div>

      {/* Contenido del Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-popover text-popover-foreground border border-border rounded-md outline-none animate-in fade-in-0 zoom-in-95">
          {/* Buscador interno */}
          <div className="flex items-center px-3 border-b border-border/50">
            <Search className="w-4 h-4 mr-2 text-muted-foreground opacity-50" />
            <input
              type="text"
              className="flex w-full h-10 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground focus:ring-0"
              placeholder="Escribe para buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Lista de Resultados */}
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-4 text-sm text-center text-muted-foreground italic">
                No se encontraron productos.
              </p>
            ) : (
              filtered.map((p) => (
                <div
                  key={p.id}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 px-2 text-sm outline-none hover:bg-muted font-medium"
                  onClick={() => {
                    onSelect(p.id);
                    setIsOpen(false);
                  }}
                >
                  {p.nombre}{" "}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({p.tipo})
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cómo se comporta una celda de la tabla en un celular.
 *
 * Debajo de md la tabla deja de ser tabla: cada `<tr>` es una tarjeta y cada
 * `<td>` una fila de ancho completo. Antes la tabla tenía `min-w-250` —1.000
 * píxeles fijos— adentro de un `overflow-x-auto`, así que en un teléfono de
 * 390 px se veía menos de la mitad de un renglón y había que arrastrar de
 * costado para llegar al botón. La cabecera se esconde (apilada no ordena
 * nada) y el rótulo de cada columna viaja en `data-label`, porque sin el
 * thead un número suelto no dice si es el costo o el precio.
 */
const CELDA_APILADA =
  "max-md:block max-md:w-full max-md:px-4 max-md:py-1.5 " +
  "max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] " +
  "max-md:before:font-semibold max-md:before:uppercase " +
  "max-md:before:tracking-wide max-md:before:text-muted-foreground " +
  "max-md:before:content-[attr(data-label)]";

export function MergeTable({
  orden,
  itemsOriginales,
  productos,
  sugerenciasSimilitud,
  borradorServidor = null,
}: Readonly<MergeTableProps>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // No usamos el total de cabecera: el valor histórico del remito es la suma
  // congelada de cantidad × costo de cada línea, aunque luego cambie el costo
  // actual de los productos o una carga vieja tenga un total presupuestado
  // desactualizado.
  const valorHistoricoRemito = itemsOriginales.reduce(
    (total, item) => total + Number(item.cantidad ?? 0) * Number(item.precio_costo ?? 0),
    0,
  );

  // Estado de red por acción — separados para que un "crear producto"
  // colgado no bloquee el botón de aprobar (y viceversa).
  const [crearLoading, setCrearLoading] = useState(false);
  const [crearError, setCrearError] = useState<string | null>(null);
  const [aprobarLoading, setAprobarLoading] = useState(false);
  /**
   * Ya se avisó de los productos compartidos y la persona decidió seguir.
   *
   * No se resetea al cambiar las vinculaciones a propósito: si después de ver
   * el aviso mueve una fila, ya entendió de qué se trata, y volver a frenarla
   * en cada cambio convierte una advertencia en un obstáculo.
   */
  const [compartidosConfirmados, setCompartidosConfirmados] = useState(false);
  const [aprobarError, setAprobarError] = useState<string | null>(null);

  // Loading/error por fila para las acciones de 1-click y masivas — separado
  // de crearLoading/crearError, que siguen siendo solo del modal manual.
  const [loadingPorGrupo, setLoadingPorGrupo] = useState<
    Record<string, boolean>
  >({});
  const [errorPorGrupo, setErrorPorGrupo] = useState<
    Record<string, string | null>
  >({});

  // Qué chips de variante (talle/color) están expandidos a su desglose
  // completo — colapsados por default. El chip compacto trunca a ~148px,
  // así que el desglose es la única forma de leer variantes con varios
  // atributos sin cortar; antes se mostraban las dos formas siempre,
  // duplicando la misma info.
  const [variantesExpandidas, setVariantesExpandidas] = useState<Set<string>>(
    new Set(),
  );
  const toggleVarianteExpandida = (key: string) => {
    setVariantesExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Categoría elegida a mano por el usuario (override), por raw_nombre —
  // guarda categoria_id (uuid), NUNCA el nombre: el árbol permite nombres
  // repetidos bajo padres distintos ("Remeras" en Ropa Mujer y en Ropa
  // Niña), así que un id es la única identidad no ambigua acá.
  // Independiente del modal. Si no hay override, se usa la sugerencia
  // automática de sugerirCategoria calculada en clasificacionPorGrupo
  // (resuelta a id contra categoriasDB antes de guardarse).
  const [categoriaIdPorGrupo, setCategoriaIdPorGrupo] = useState<
    Record<string, string>
  >({});

  // Selección múltiple de filas Ambiguas, para "Asignar categoría a selección".
  const [gruposSeleccionados, setGruposSeleccionados] = useState<Set<string>>(
    new Set(),
  );
  const [categoriaIdParaSeleccion, setCategoriaIdParaSeleccion] = useState("");
  const [bulkCrearLoading, setBulkCrearLoading] = useState(false);
  // Progreso determinado de la creación masiva: se puede contar cuántos
  // grupos terminaron. La aprobación, en cambio, es una sola RPC —
  // ahí el overlay muestra solo el cronómetro.
  const [bulkProgreso, setBulkProgreso] = useState<{
    hechos: number;
    total: number;
  } | null>(null);

  // Borrador local (IndexedDB) de esta conciliación
  const [draftState, setDraftState] = useState<"checking" | "prompt" | "ready">(
    "checking",
  );
  const [pendingDraft, setPendingDraft] =
    useState<Awaited<ReturnType<typeof getMergeDraft>>>(null);

  // En lugar de manejar índices sueltos, manejamos el `raw_nombre` de la agrupación
  const [groupToRemoveName, setGroupToRemoveName] = useState<string | null>(
    null,
  );
  const [groupToCreateName, setGroupToCreateName] = useState<string | null>(
    null,
  );

  // Categorías reales del comercio — se declaran ACÁ (antes de
  // clasificacionPorGrupo) porque la clasificación de filas desconocidas
  // ahora resuelve la sugerencia contra el árbol real, no solo por nombre.
  const [categoriasDB, setCategoriasDB] = useState<CategoriaBase[]>([]);

  useEffect(() => {
    const fetchCats = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("categorias")
        .select("id, nombre, slug, parent_id")
        .eq("activa", true)
        .order("nombre");
      if (data) setCategoriasDB(data);
    };
    fetchCats();
  }, []);

  // Árbol para los dos <Select> de categoría de esta pantalla. Sin conteos:
  // acá se ELIGE, no se filtra, así que cada categoría existe siempre.
  const arbolCategoriasDB = useArbolParaElegir(categoriasDB);

  // sugerirCategoria (category-suggestions.ts) es un diccionario portable
  // entre tenants — devuelve NOMBRES a propósito, nunca ids hardcodeados.
  // Estos dos helpers son el único punto donde ese nombre se resuelve
  // contra el árbol real antes de guardarse en cualquier estado.
  const idPorNombreCategoria = (nombre: string): string | undefined =>
    categoriasDB.find(
      (cat) => cat.nombre.trim().toLowerCase() === nombre.trim().toLowerCase(),
    )?.id;
  const nombrePorIdCategoria = (id: string): string | undefined =>
    categoriasDB.find((cat) => cat.id === id)?.nombre;

  // Estado local para productos (permite inyectar los creados al vuelo)
  const [localProductos, setLocalProductos] = useState<Producto[]>(productos);

  // Estado local plano de ítems para envío
  const [items, setItems] = useState<ItemResueltoConCategoria[]>(() =>
    itemsOriginales.map((item) => ({
      ...item,
      variante_match: item.variante_match || item.raw_variante || "Unico",
      // El precio de la planilla gana sobre el que ya tiene el producto: si
      // el proveedor mandó lista nueva, ese es el dato más fresco. No se
      // escribe solo — queda en el input de la fila y se aprueba a mano.
      precio_venta_actualizado:
        Number(item.precio_venta_sugerido) > 0
          ? Number(item.precio_venta_sugerido)
          : precioVigente(productoReal(item.producto_id, productos)),
    })),
  );

  // Snapshot del estado prístino (sin tocar), para no ofrecer "restaurar
  // borrador" ni pisar un borrador real cuando el usuario todavía no hizo
  // ningún cambio en esta sesión.
  const pristineItemsSnapshotRef = useRef<string>(JSON.stringify(items));

  // Agrupación Computada Dinámicamente para Renderizar
  const groupedItems = useMemo(() => {
    const map = new Map<string, ItemResueltoConCategoria[]>();
    items.forEach((item) => {
      if (!map.has(item.raw_nombre)) map.set(item.raw_nombre, []);
      map.get(item.raw_nombre)!.push(item);
    });
    return Array.from(map.entries());
  }, [items]);

  // Candidatos de "posible match" (similitud de texto), 1 por raw_nombre.
  const similaresMap = useMemo(
    () => construirMapaSimilares(sugerenciasSimilitud),
    [sugerenciasSimilitud],
  );

  // Clasificación de las 3 filas "no reconocido" (posible match / nuevo
  // sugerido / ambiguo), calculada 1 vez por raw_nombre DESCONOCIDO.
  const clasificacionPorGrupo = useMemo(() => {
    const mapa = new Map<string, BucketDesconocido>();
    for (const [rawNombre, group] of groupedItems) {
      if (group[0].estado_match === "DESCONOCIDO") {
        // El género de la fila entra en la clasificación: sin él, la
        // sugerencia sale del diccionario plano y propone la subcategoría
        // de otra audiencia (ver clasificarDesconocido).
        mapa.set(
          rawNombre,
          clasificarDesconocido(
            rawNombre,
            similaresMap,
            group[0].raw_genero ?? null,
            categoriasDB,
            group[0].raw_categoria ?? null,
            // La categoría que el import ya resolvió (columna Categoría del
            // CSV matcheada contra el árbol real). Sin pasarla, la fila se
            // reclasificaba desde cero por nombre y las categorías que no
            // son de ropa —JUGUETES— caían siempre en Ambiguo.
            group[0].raw_categoria_id ?? null,
          ),
        );
      }
    }
    return mapa;
  }, [groupedItems, similaresMap, categoriasDB]);

  /**
   * Los grupos que se pueden crear de una sola vez, que es lo único que hace
   * falta para poder crear un producto: un nombre y una categoría.
   *
   * Son dos bucket, no uno. El obvio es NUEVO_SUGERIDO, que ya trae categoría
   * inferida. El otro es AMBIGUO al que la persona YA le eligió categoría a
   * mano con la barra de selección múltiple: en ese momento deja de estar
   * ambiguo: lo único que le faltaba era eso. Antes quedaba afuera del lote y
   * el toast lo decía sin disimulo —"ahora podés usar Crear en cada una"—, o
   * sea que después de resolver 30 grupos de un saque había que dar 30 clicks
   * más para ejecutar la decisión ya tomada.
   *
   * Los que tienen candidato (POSIBLE_MATCH) se quedan afuera A PROPÓSITO,
   * aunque el 98,9% de los grupos que pasan por esta pantalla terminen siendo
   * alta nueva: crear en lote sobre un candidato sin mirarlo es exactamente
   * cómo se fabrica el catálogo duplicado que esta pantalla existe para
   * evitar. Ahí la decisión sigue siendo de a una.
   */
  const gruposCreablesEnLote = useMemo(
    () =>
      groupedItems
        .filter(([rawNombre, group]) => {
          if (group[0].producto_id) return false;
          const bucket = clasificacionPorGrupo.get(rawNombre);
          if (bucket?.tipo === "NUEVO_SUGERIDO") return true;
          return (
            bucket?.tipo === "AMBIGUO" && Boolean(categoriaIdPorGrupo[rawNombre])
          );
        })
        .map(([rawNombre]) => rawNombre),
    [groupedItems, clasificacionPorGrupo, categoriaIdPorGrupo],
  );

  /** Los que la pantalla NO puede resolver sola y siguen siendo trabajo
   * manual. Se cuentan para poder decirlo al lado del botón: "creo 34 y te
   * quedan 12" es una promesa que se cumple; "creo todos" no. */
  const gruposQueQuedanAMano = useMemo(
    () =>
      groupedItems.filter(([rawNombre, group]) => {
        if (group[0].producto_id) return false;
        if (group[0].estado_match !== "DESCONOCIDO") return false;
        return !gruposCreablesEnLote.includes(rawNombre);
      }).length,
    [groupedItems, gruposCreablesEnLote],
  );

  // Grupo activo del modal "Crear Producto Múltiple" y si tiene costos
  // dispersos entre sus filas (para advertir que el precio unificado no
  // va a aplicar por igual a todas las variantes).
  const grupoParaCrear = useMemo(
    () =>
      groupToCreateName
        ? items.filter((i) => i.raw_nombre === groupToCreateName)
        : [],
    [items, groupToCreateName],
  );
  const grupoTieneCostoDisperso = useMemo(
    () => new Set(grupoParaCrear.map((i) => i.precio_costo)).size > 1,
    [grupoParaCrear],
  );

  // Estados para nuevas funcionalidades
  const [recargoGlobal, setRecargoGlobal] = useState<number | "">("");
  const [nuevoProductoData, setNuevoProductoData] = useState({
    nombre: "",
    precio: 0,
    categoriaId: "",
    marca: "",
    origenPrecio: "",
  });
  const [archivosNuevoProducto, setArchivosNuevoProducto] = useState<File[]>(
    [],
  );
  // Busca un borrador guardado de ESTA orden al entrar a la pantalla.
  useEffect(() => {
    let cancelled = false;
    getMergeDraft(orden.id)
      .then((draft) => {
        if (cancelled) return;
        if (draft && draft.items.length > 0) {
          setPendingDraft(draft);
          setDraftState("prompt");
          return;
        }
        // Sin borrador local puede haber uno en la base: el trabajo se hizo
        // en otra máquina, o este navegador se limpió.
        if (borradorServidor && borradorServidor.items.length > 0) {
          setPendingDraft({
            ordenId: orden.id,
            items: borradorServidor.items,
            productosCreados: borradorServidor.productosCreados ?? [],
            actualizadoEn: Date.now(),
          });
          setDraftState("prompt");
          return;
        }
        setDraftState("ready");
      })
      .catch(() => {
        if (!cancelled) setDraftState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [orden.id, borradorServidor]);

  // Autoguardado del borrador local — solo una vez que se resolvió si
  // había (y qué hacer con) un borrador previo, y solo si hay cambios
  // reales sobre el estado prístino.
  useEffect(() => {
    if (draftState !== "ready") return;

    const productosCreados = localProductos.filter(
      (p) => !productos.some((orig) => orig.id === p.id),
    );
    const serializedItems = JSON.stringify(items);
    if (
      serializedItems === pristineItemsSnapshotRef.current &&
      productosCreados.length === 0
    ) {
      return;
    }

    const timer = setTimeout(() => {
      saveMergeDraft({
        ordenId: orden.id,
        items,
        productosCreados,
        actualizadoEn: Date.now(),
      }).catch(() => {});

      // Y a la base, que es lo que sobrevive a cambiar de máquina. No se
      // espera ni se avisa si falla: el borrador local ya quedó guardado.
      guardarBorradorOrdenAction(orden.id, {
        version: 1,
        modo: "CONCILIACION",
        items,
        productosCreados,
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [items, localProductos, productos, draftState, orden.id]);

  const handleRestaurarDraft = () => {
    if (pendingDraft) {
      setItems(pendingDraft.items);
      if (pendingDraft.productosCreados.length > 0) {
        setLocalProductos((prev) => {
          const existentes = new Set(prev.map((p) => p.id));
          const nuevos = pendingDraft.productosCreados.filter(
            (p) => !existentes.has(p.id),
          );
          return [...prev, ...nuevos];
        });
      }
      toast.info("Continuando donde quedaste.");
    }
    setPendingDraft(null);
    setDraftState("ready");
  };

  const handleDescartarDraft = () => {
    deleteMergeDraft(orden.id).catch(() => {});
    setPendingDraft(null);
    setDraftState("ready");
  };

  function productoReal(
    id: string | null,
    listaProductos = localProductos,
  ): Producto | undefined {
    if (!id) return undefined;
    return listaProductos.find((p) => p.id === id);
  }

  /**
   * Renglones de productos DISTINTOS que caen en la misma variante del mismo
   * producto. Es lo que fusionaba vestidos únicos en Evens (8/9/2026): al
   * aprobar, la RPC sumaba los dos stocks sobre una sola fila y el segundo
   * color pisaba al primero.
   *
   * Se recalcula en cada cambio de vinculación para que el aviso aparezca
   * mientras se concilia, no al final. El freno real vive en
   * `aprobar_orden_compra`, que rechaza el remito antes de escribir nada:
   * esto es lo que evita llegar hasta ahí.
   */
  const fusiones = useMemo(
    () => detectarFusiones(items, (id) => productoReal(id)?.nombre),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, localProductos],
  );

  /**
   * Productos que ya tienen más de un nombre del remito colgando, separados
   * entre error y grafía.
   *
   * ESTO ES LO QUE FALTABA EL 28/8. `fusiones` solo ve el choque cuando dos
   * nombres caen en la MISMA variante, y los cinco vestidos que terminaron
   * dentro de "VESTIDO EGRESADA MORE" venían en cinco colores distintos: no
   * hubo una sola fusión que detectar y el remito se aprobó sin una queja.
   *
   * `esMismaPrenda` separa el error real del typo del proveedor
   * ("VESTIOD VERA"), que compartir producto es lo correcto. Sin esa
   * distinción el aviso saldría en casos buenos y se aprende a ignorarlo.
   */
  const compartidos = useMemo(
    () => clasificarProductosCompartidos(items, (id) => productoReal(id)?.nombre),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, localProductos],
  );

  /** Los que de verdad hay que mirar: nombres distintos en un mismo producto. */
  const compartidosSospechosos = useMemo(
    () => compartidos.filter((c) => !c.esMismaPrenda),
    [compartidos],
  );

  /**
   * El mismo dato indexado por producto, para el aviso al pie de cada fila.
   *
   * Ese aviso ya existía y salía para TODO producto compartido, incluido el
   * typo del proveedor. Ahora sale solo para los sospechosos: un cartel que
   * también aparece cuando está todo bien es un cartel que se deja de leer.
   */
  const productosCompartidos = useMemo(
    () =>
      new Map(compartidosSospechosos.map((c) => [c.productoId, c.nombres])),
    [compartidosSospechosos],
  );

  /** Los nombres del remito que participan de alguna fusión, para marcarlos. */
  const nombresEnFusion = useMemo(
    () => new Set(fusiones.flatMap((f) => f.nombres)),
    [fusiones],
  );

  /**
   * Peso de cada palabra del catálogo, para saber cuánta confianza merece cada
   * sugerencia. Se calcula UNA vez por pantalla: recorrer 1.600 productos por
   * cada uno de los 43 grupos de un remito sería hacerlo 43 veces.
   */
  const pesosCatalogo = useMemo(
    () => construirPesos(localProductos.map((p) => p.nombre)),
    [localProductos],
  );

  // --- Handlers Grupales ---

  /**
   * Qué precio proponer para una fila ya vinculada a un producto existente.
   * Vive en `precio-al-asociar.ts` con sus tests; acá solo se le pasan los
   * cuatro datos que hacen falta.
   */
  const propuestaPrecio = (
    item: ItemResueltoConCategoria,
    productoId: string | null,
  ) => {
    const prod = productoReal(productoId);
    return precioAlAsociar({
      costoRemito: item.precio_costo,
      precioSugeridoRemito: item.precio_venta_sugerido,
      precioEnLaFila: item.precio_venta_actualizado,
      costoActualProducto: costoVigente(prod),
      precioActualProducto: precioVigente(prod),
      preciosDispares: prod?.precios_dispares === true,
    });
  };

  const handleAssignProduct = (rawNombre: string, newProductId: string) => {
    const prod = productoReal(newProductId);

    // Aviso al momento de vincular, que es cuando la persona todavía tiene
    // presente qué eligió. Sin esto, mandar tres vestidos distintos al mismo
    // producto no se notaba hasta que el stock ya estaba sumado.
    const yaAsignadoA = items
      .filter(
        (item) =>
          item.producto_id === newProductId && item.raw_nombre !== rawNombre,
      )
      .map((item) => item.raw_nombre);

    if (yaAsignadoA.length > 0) {
      const otros = Array.from(new Set(yaAsignadoA));
      toast.warning(
        `"${prod?.nombre ?? "Ese producto"}" ya está vinculado a ${otros
          .slice(0, 2)
          .map((n) => `"${n}"`)
          .join(", ")}${otros.length > 2 ? ` y ${otros.length - 2} más` : ""}. Si son prendas distintas, buscá otro producto.`,
      );
    }

    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.raw_nombre === rawNombre) {
          return {
            ...item,
            producto_id: newProductId,
            // Asociar a un producto que ya existe es, casi siempre, ACTUALIZARLO:
            // entra mercadería con un costo nuevo. Antes acá quedaba el precio
            // viejo (`item.precio_venta_actualizado || prod?.precio`), así que
            // al aprobar se escribía el costo nuevo con el precio de antes y el
            // margen se comía solo. Ahora el precio se recalcula manteniendo el
            // margen que ese producto ya tenía. Ver `precio-al-asociar.ts`.
            precio_venta_actualizado: precioAlAsociar({
              costoRemito: item.precio_costo,
              precioSugeridoRemito: item.precio_venta_sugerido,
              precioEnLaFila: item.precio_venta_actualizado,
              costoActualProducto: costoVigente(prod),
              precioActualProducto: precioVigente(prod),
              preciosDispares: prod?.precios_dispares === true,
            }).precio,
            estado_match:
              item.estado_match === "DESCONOCIDO"
                ? "NUEVO_ALIAS"
                : item.estado_match,
          };
        }
        return item;
      }),
    );
  };

  const handleUpdatePrice = (rawNombre: string, newPrice: number) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.raw_nombre === rawNombre
          ? { ...item, precio_venta_actualizado: newPrice }
          : item,
      ),
    );
  };

  const handleUndo = (rawNombre: string) => {
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.raw_nombre === rawNombre) {
          return {
            ...item,
            producto_id: null,
            precio_venta_actualizado: 0,
            estado_match: "DESCONOCIDO",
          };
        }
        return item;
      }),
    );
    toast.info(`Asignación deshecha para "${rawNombre}".`);
  };

  const confirmRemoveGroup = () => {
    if (!groupToRemoveName) return;

    setItems((prevItems) =>
      prevItems.filter((item) => item.raw_nombre !== groupToRemoveName),
    );
    setGroupToRemoveName(null);
    toast.info("Agrupación descartada de la conciliación.");
  };

  const handleAplicarRecargoGlobal = () => {
    if (recargoGlobal === "" || recargoGlobal < 0) return;

    setItems((prevItems) =>
      prevItems.map((item) => ({
        ...item,
        precio_venta_actualizado: Math.ceil(
          item.precio_costo * (1 + Number(recargoGlobal) / 100),
        ),
      })),
    );
    toast.success(
      `Recargo del ${recargoGlobal}% aplicado a todos los productos.`,
    );
  };

  // --- Crear al Vuelo (compartido por el modal manual, el 1-click y el masivo) ---
  // Nunca throwea — siempre resuelve a un resultado, así los callers (loop
  // masivo incluido) no necesitan try/catch propio.
  async function crearYAsignarProducto(params: {
    rawNombre: string;
    nombreProducto: string;
    categoriaId?: string;
    precio: number;
    marca?: string;
    archivosMain?: File[];
    archivosThumb?: File[];
    archivosGrid?: File[];
    archivosMaster?: File[];
  }): Promise<{ ok: true; producto: Producto } | { ok: false; error: string }> {
    const itemActual = items.find((i) => i.raw_nombre === params.rawNombre);
    if (!itemActual) {
      return { ok: false, error: "No se encontró el ítem en la conciliación." };
    }

    try {
      const res = await withTimeout(
        crearProductoAlVueloAction(
          params.nombreProducto,
          itemActual.precio_costo,
          params.precio,
          params.archivosMain || [],
          params.archivosThumb || [],
          params.archivosGrid || [],
          params.categoriaId,
          params.marca,
          params.archivosMaster || [],
        ),
        ACTION_TIMEOUT_MS,
      );

      if (res.error || !res.producto) {
        return { ok: false, error: res.error || "Ocurrió un error al crear." };
      }

      const nuevoProd = res.producto as Producto;
      setLocalProductos((prevProductos) => [...prevProductos, nuevoProd]);
      queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });

      const precioUnificado = Number(params.precio || nuevoProd.precio || 0);
      setItems((prevItems) =>
        prevItems.map((item) => {
          if (item.raw_nombre !== params.rawNombre) return item;

          return {
            ...item,
            producto_id: nuevoProd.id,
            precio_venta_actualizado: precioUnificado,
            estado_match:
              item.estado_match === "DESCONOCIDO"
                ? "NUEVO_ALIAS"
                : item.estado_match,
          };
        }),
      );

      return { ok: true, producto: nuevoProd };
    } catch (err) {
      const message =
        err instanceof TimeoutError
          ? "La creación tardó demasiado y se canceló. Probá de nuevo."
          : err instanceof Error
            ? err.message
            : "Ocurrió un error inesperado al crear el producto.";
      return { ok: false, error: message };
    }
  }

  const handleCrearAlVuelo = async () => {
    if (!groupToCreateName) return;

    setCrearLoading(true);
    setCrearError(null);

    try {
      // Comprimimos generando las tres versiones (main + thumbnail + grid),
      // secuencial a propósito (ver optimizarImagenesProducto): en paralelo
      // el pico de memoria mataba la pestaña en mobile.
      const imagenesProcesadas =
        archivosNuevoProducto.length > 0
          ? await optimizarImagenesProducto(archivosNuevoProducto)
          : [];

      const archivosMain = imagenesProcesadas.map((img) => img.main);
      const archivosThumb = imagenesProcesadas.map((img) => img.thumbnail);
      const archivosGrid = imagenesProcesadas.map((img) => img.grid);
      const archivosMaster = imagenesProcesadas.map((img) => img.master);

      const resultado = await crearYAsignarProducto({
        rawNombre: groupToCreateName,
        nombreProducto: nuevoProductoData.nombre,
        categoriaId: nuevoProductoData.categoriaId,
        precio: nuevoProductoData.precio,
        marca: nuevoProductoData.marca,
        archivosMain,
        archivosThumb,
        archivosGrid,
      });

      if (!resultado.ok) {
        setCrearError(resultado.error);
        return;
      }

      toast.success(
        `Producto "${resultado.producto.nombre}" creado y asignado a ${items.filter((i) => i.raw_nombre === groupToCreateName).length} variantes.`,
      );
      setGroupToCreateName(null);
      setArchivosNuevoProducto([]);
    } catch (error) {
      // La compresión ahora tira si no puede procesar una imagen (antes
      // devolvía el archivo crudo y reventaba el límite de body de la acción).
      // Sin este catch quedaba como unhandled rejection y el modal se
      // congelaba sin decir nada.
      console.error("[MERGE] Error creando producto al vuelo", error);
      setCrearError(
        error instanceof ImagenError
          ? error.message
          : "No se pudo crear el producto. Revisá las imágenes y volvé a intentar.",
      );
    } finally {
      setCrearLoading(false);
    }
  };

  /** Precio de venta con el que se crea un producto al vuelo. Usa el de la
   * fila (que ya viene sembrado con el precio_venta de la planilla, o con el
   * recargo global si se aplicó) y solo cae a costo + 50% si no hay ninguno:
   * crear al 1.5 teniendo el precio del proveedor era descartarlo. */
  function precioParaCrear(item: ItemResueltoConCategoria | undefined): number {
    const desdeFila = Number(item?.precio_venta_actualizado || 0);
    if (desdeFila > 0) return desdeFila;
    return Math.ceil(Number(item?.precio_costo || 0) * 1.5);
  }

  // --- 1-click: bucket (b) Nuevo Sugerido ---
  const handleCrearSugerido = async (
    rawNombre: string,
    categoriaIdSugerida: string | undefined,
    categoriaNombreParaToast: string,
  ) => {
    const itemActual = items.find((i) => i.raw_nombre === rawNombre);
    if (!itemActual) return;

    const categoriaId = categoriaIdPorGrupo[rawNombre] ?? categoriaIdSugerida;
    const precio = precioParaCrear(itemActual);

    setLoadingPorGrupo((prev) => ({ ...prev, [rawNombre]: true }));
    setErrorPorGrupo((prev) => ({ ...prev, [rawNombre]: null }));

    const resultado = await crearYAsignarProducto({
      rawNombre,
      nombreProducto: rawNombre,
      categoriaId,
      precio,
      marca: itemActual.raw_marca || undefined,
    });

    setLoadingPorGrupo((prev) => ({ ...prev, [rawNombre]: false }));

    if (!resultado.ok) {
      setErrorPorGrupo((prev) => ({ ...prev, [rawNombre]: resultado.error }));
      return;
    }

    toast.success(
      `"${resultado.producto.nombre}" creado en "${categoriaNombreParaToast}".`,
    );
  };

  // --- T3: acciones masivas ---

  const toggleGrupoSeleccionado = (rawNombre: string) => {
    setGruposSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(rawNombre)) next.delete(rawNombre);
      else next.add(rawNombre);
      return next;
    });
  };

  const handleAsignarCategoriaASeleccion = () => {
    if (!categoriaIdParaSeleccion || gruposSeleccionados.size === 0) return;

    setCategoriaIdPorGrupo((prev) => {
      const next = { ...prev };
      for (const rawNombre of gruposSeleccionados) {
        next[rawNombre] = categoriaIdParaSeleccion;
      }
      return next;
    });

    const nombreElegido = nombrePorIdCategoria(categoriaIdParaSeleccion) ?? "";
    toast.success(
      `Categoría "${nombreElegido}" asignada a ${gruposSeleccionados.size} agrupaciones. Ya entran en "Crear", arriba de la tabla.`,
    );
    setGruposSeleccionados(new Set());
    setCategoriaIdParaSeleccion("");
  };

  const handleCrearTodosSugeridos = async () => {
    if (gruposCreablesEnLote.length === 0 || bulkCrearLoading) return;

    setBulkCrearLoading(true);
    setBulkProgreso({ hechos: 0, total: gruposCreablesEnLote.length });
    setLoadingPorGrupo((prev) => {
      const next = { ...prev };
      for (const rawNombre of gruposCreablesEnLote) next[rawNombre] = true;
      return next;
    });

    const tareas = gruposCreablesEnLote.map((rawNombre) => async () => {
      const bucket = clasificacionPorGrupo.get(rawNombre);
      const categoriaIdSugerida =
        bucket?.tipo === "NUEVO_SUGERIDO"
          ? (bucket.categoriaId ??
            idPorNombreCategoria(bucket.categoriaSugerida.categoriaNombre))
          : undefined;
      const categoriaId = categoriaIdPorGrupo[rawNombre] ?? categoriaIdSugerida;
      const itemActual = items.find((i) => i.raw_nombre === rawNombre);
      const precio = precioParaCrear(itemActual);

      const resultado = await crearYAsignarProducto({
        rawNombre,
        nombreProducto: rawNombre,
        categoriaId,
        precio,
        marca: itemActual?.raw_marca || undefined,
      });

      setLoadingPorGrupo((prev) => ({ ...prev, [rawNombre]: false }));
      setErrorPorGrupo((prev) => ({
        ...prev,
        [rawNombre]: resultado.ok ? null : resultado.error,
      }));
      // Cuenta los terminados, con éxito o no: el progreso mide avance del
      // proceso, no cuántos salieron bien (eso ya lo dice el toast final).
      setBulkProgreso((prev) =>
        prev ? { ...prev, hechos: prev.hechos + 1 } : prev,
      );

      return resultado.ok;
    });

    const resultados = await runWithConcurrencyLimit(tareas, 3);
    setBulkCrearLoading(false);
    setBulkProgreso(null);

    const exitosos = resultados.filter(Boolean).length;
    const fallidos = resultados.length - exitosos;

    if (fallidos === 0) {
      toast.success(`Se crearon ${exitosos} productos sugeridos.`);
    } else {
      toast.warning(
        `Creados ${exitosos}/${resultados.length}. ${fallidos} fallaron — reintentalos individualmente (quedaron marcados en rojo).`,
      );
    }
  };

  const handleAprobar = async () => {
    const sinResolver = items.some((i) => !i.producto_id);
    if (sinResolver) {
      toast.error(
        "Debes asignar un producto a todas las agrupaciones desconocidas (Rojas).",
      );
      return;
    }

    // Freno de fusión. La RPC rechaza este remito igual —y ese es el freno que
    // cuenta— pero conviene decirlo acá con los nombres a la vista, porque el
    // error del server llega como un texto suelto arriba de todo.
    if (fusiones.length > 0) {
      const ejemplo = fusiones[0];
      toast.error(
        `No se puede impactar: ${ejemplo.nombres.join(" y ")} caen en la misma variante de "${ejemplo.productoNombre}" (${ejemplo.variante})` +
          (fusiones.length > 1
            ? `, y hay ${fusiones.length - 1} caso${fusiones.length > 2 ? "s" : ""} más. Revisá las filas marcadas en rojo.`
            : ". Vinculá una de las dos a otro producto."),
      );
      return;
    }

    // Producto compartido: NO frena, pregunta. Es la diferencia con la
    // fusión de arriba — aquello suma stock en una fila y no se puede
    // deshacer; esto puede ser correcto (el proveedor escribió el mismo
    // artículo de dos formas) y el que sabe cuál de las dos es está del otro
    // lado de la pantalla. Se pregunta UNA vez y con los nombres puestos.
    if (compartidosSospechosos.length > 0 && !compartidosConfirmados) {
      setCompartidosConfirmados(true);
      const c = compartidosSospechosos[0];
      toast.warning(
        `${c.nombres.join(" + ")} van a entrar todos como "${c.productoNombre}"` +
          (compartidosSospechosos.length > 1
            ? `, y hay ${compartidosSospechosos.length - 1} producto${compartidosSospechosos.length > 2 ? "s" : ""} más en la misma situación. `
            : ". ") +
          "Si son artículos distintos, vinculalos a productos distintos. Si está bien, tocá Impactar de nuevo.",
        { duration: 12000 },
      );
      return;
    }

    setAprobarLoading(true);
    setAprobarError(null);

    try {
      // SIN withTimeout, a propósito: esta acción muta stock y precios. Un
      // timeout de UI no cancela el server action, solo destraba el botón
      // para que la misma impactación se dispare de nuevo. El botón queda
      // deshabilitado hasta que la respuesta llegue o falle explícitamente,
      // aunque tarde.
      const res = await aprobarOrdenAction(orden.id, orden.proveedor, items);

      if (res.success) {
        borrarBorradorOrdenAction(orden.id);
        if (res.yaAprobada) {
          // Camino idempotente: la RPC no tocó nada porque esta orden ya
          // estaba impactada. No es error y no hay nada que reintentar.
          toast.warning(
            "Esta orden ya estaba aprobada. No se volvió a sumar stock.",
          );
        } else {
          toast.success("¡Orden conciliada! Stock actualizado.");

          // El precio nuevo no llegó a estas variantes porque tenían uno
          // propio distinto, y esas son las que va a cobrar la caja. Va como
          // aviso y no como error: la mercadería ya entró, y elegir qué precio
          // gana es del comercio.
          if (res.variantesConservadas > 0) {
            toast.warning(
              `${res.variantesConservadas} variante${res.variantesConservadas === 1 ? "" : "s"} mantuvo su precio propio`,
              {
                description:
                  "El precio nuevo quedó en el producto, pero esas variantes se venden al suyo. Revisalas en Inventario.",
                duration: 10_000,
              },
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        // Guardado real confirmado contra el server: el borrador local ya
        // no tiene sentido, no debe quedar un borrador fantasma.
        await deleteMergeDraft(orden.id).catch(() => {});
        router.push("/stock");
      } else {
        setAprobarError(res.error || "Ocurrió un error.");
      }
    } catch (err) {
      // Reintentar acá es seguro: el guard de idempotencia de
      // `aprobar_orden_compra` corre antes de escribir stock, así que si la
      // corrida que se cortó ya había impactado, la próxima sale por
      // `ya_aprobada` sin sumar de nuevo.
      setAprobarError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error inesperado al impactar los datos.",
      );
    } finally {
      setAprobarLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-2">
      {/* Overlay de la aprobación: una sola RPC, no hay progreso parcial que
          mostrar — el cronómetro es lo que demuestra que sigue viva. */}
      <ProgresoOverlay
        abierto={aprobarLoading}
        titulo="Impactando stock y precios"
        descripcion={`Actualizando ${items.length} ${items.length === 1 ? "renglón" : "renglones"} del remito de ${orden.proveedor}.`}
      />

      {/* Overlay de la creación masiva: acá sí se puede contar. */}
      <ProgresoOverlay
        abierto={bulkCrearLoading}
        titulo="Creando productos sugeridos"
        descripcion="Se crean de a tres por vez para no saturar la conexión."
        progreso={bulkProgreso ?? undefined}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/stock"
            className="text-xs text-muted-foreground hover:text-foreground font-semibold uppercase tracking-widest flex items-center mb-2"
          >
            <ArrowLeft className="w-3 h-3 mr-1" /> Volver al Inventario
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            Conciliación de Pedido
          </h1>
          <p className="text-muted-foreground mt-1">
            Proveedor: <strong>{orden.proveedor}</strong> | Valor histórico: $
            {valorHistoricoRemito.toLocaleString("es-AR")}
          </p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
          <Button
            size="lg"
            className="h-10 bg-primary hover:bg-primary/90 text-white w-full sm:w-auto cursor-pointer"
            onClick={handleAprobar}
            // Con una fusión pendiente el botón queda deshabilitado y NO por
            // prolijidad: la RPC va a rechazar el remito entero igual, así que
            // dejar apretar solo consigue una espera y un error críptico.
            disabled={
              aprobarLoading ||
              crearLoading ||
              items.length === 0 ||
              fusiones.length > 0
            }
          >
            <Save className="w-5 h-5 mr-2" />
            {aprobarLoading
              ? "Procesando..."
              : fusiones.length > 0
                ? "Revisá los renglones que se combinan"
                : aprobarError
                  ? "Reintentar"
                  : "Confirmar e Impactar Stock"}
          </Button>
          {aprobarError && (
            <p className="text-xs text-danger font-medium max-w-sm text-right">
              {aprobarError}
            </p>
          )}
        </div>
      </div>

      {/* Acciones Rápidas (Recargo Global + Masivas) */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-background p-4 rounded-xl border border-border">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Percent className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium whitespace-nowrap">
            Aplicar recargo global a todos:
          </span>
          <Input
            type="number"
            placeholder="Ej: 30"
            className="w-20 h-8 text-center"
            value={recargoGlobal}
            onChange={(e) =>
              setRecargoGlobal(e.target.value ? Number(e.target.value) : "")
            }
          />
          <span className="text-sm text-muted-foreground">%</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAplicarRecargoGlobal}
          >
            Aplicar
          </Button>
        </div>

      </div>

      {/* CREAR EN LOTE — la acción principal de esta pantalla, y por eso está
          acá arriba y en primario, no gris al lado del recargo global.
          Medido sobre los 115 remitos aprobados: de los 2.053 grupos que
          pasaron por conciliación, 23 (1,1%) terminaron asociados a un
          producto que ya existía y el resto fue alta nueva. La pregunta que
          la pantalla hacía primero —"¿esto ya lo tenías?"— casi nunca aplica,
          así que dar de alta tiene que ser lo primero que se ofrece.
          El conteo va desglosado a propósito: prometer "todos" y dejar 12
          filas rojas es peor que prometer 34 y cumplirlo. */}
      {gruposCreablesEnLote.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-chart-3 bg-chart-3/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-chart-3">
              {gruposCreablesEnLote.length === 1
                ? "Hay 1 producto nuevo listo para crear"
                : `Hay ${gruposCreablesEnLote.length} productos nuevos listos para crear`}
            </p>
            <p className="mt-0.5 text-sm text-foreground/80">
              Ya tienen nombre, categoría y precio.{" "}
              {gruposQueQuedanAMano > 0
                ? `Los otros ${gruposQueQuedanAMano} hay que revisarlos de a uno: tienen un producto parecido en el catálogo o les falta la categoría.`
                : "Después de esto no queda nada por resolver a mano."}
            </p>
          </div>
          <Button
            size="lg"
            className="h-10 w-full shrink-0 cursor-pointer sm:w-auto"
            onClick={handleCrearTodosSugeridos}
            disabled={bulkCrearLoading}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {bulkCrearLoading
              ? "Creando..."
              : `Crear los ${gruposCreablesEnLote.length}`}
          </Button>
        </div>
      )}

      {/* Barra de selección múltiple (solo Ambiguo) */}
      {gruposSeleccionados.size > 0 && (
        <div className="flex flex-col sm:flex-row items-center gap-3 bg-danger/10 border border-danger/20 p-3 rounded-xl">
          <span className="text-sm font-semibold text-danger whitespace-nowrap">
            {gruposSeleccionados.size} agrupaciones seleccionadas
          </span>
          <CategoriaPadreHijoSelect
            arbol={arbolCategoriasDB}
            categoriasFlat={categoriasDB}
            value={categoriaIdParaSeleccion}
            onChange={setCategoriaIdParaSeleccion}
            size="sm"
            triggerClassName="w-full sm:w-52 h-8 bg-background"
          />
          <Button
            size="sm"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={!categoriaIdParaSeleccion}
            onClick={handleAsignarCategoriaASeleccion}
          >
            Asignar categoría a selección
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full sm:w-auto"
            onClick={() => setGruposSeleccionados(new Set())}
          >
            Cancelar selección
          </Button>
        </div>
      )}

      {/* Leyenda Visual */}
      <div className="flex flex-wrap gap-4 px-2">
        <Badge variant="success">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Match Perfecto
        </Badge>
        <Badge variant="warning">
          <AlertTriangle className="w-4 h-4 mr-2" /> Aumento de Costo
        </Badge>
        <Badge variant="outline">
          <Search className="w-4 h-4 mr-2" /> Posible Match Existente
        </Badge>
        <Badge
          variant="outline"
          className="bg-chart-3/10 text-chart-3 border-chart-3 px-3 py-1"
        >
          <Sparkles className="w-4 h-4 mr-2" /> Nuevo (Categoría Sugerida)
        </Badge>
        <Badge variant="danger">
          <HelpCircle className="w-4 h-4 mr-2" /> Ambiguo / Sin Sugerencia
        </Badge>
      </div>

      {/* AVISO DE FUSIÓN — el que faltaba el 28/8 en Evens.
          Dos renglones de prendas distintas vinculados al mismo producto y con
          la misma variante terminan sumando su stock en una sola fila. Se
          muestra con los nombres puestos: "revisá las vinculaciones" no
          alcanza cuando el remito tiene 43 grupos. */}
      {fusiones.length > 0 && (
        <div className="mx-2 rounded-xl border border-danger bg-danger/10 p-4">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {fusiones.length === 1
              ? "Hay dos renglones que se van a combinar en un solo producto"
              : `Hay ${fusiones.length} pares de renglones que se van a combinar`}
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            Si son prendas distintas, su stock se suma en la misma variante y
            no hay forma de separarlo después. Vinculá una de las dos a otro
            producto.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {fusiones.slice(0, 5).map((fusion) => (
              <li
                key={`${fusion.productoId}-${fusion.variante}`}
                className="text-foreground/90"
              >
                <span className="font-semibold">
                  {fusion.nombres.join(" + ")}
                </span>{" "}
                → {fusion.productoNombre}{" "}
                <span className="text-muted-foreground">
                  ({fusion.variante})
                </span>
              </li>
            ))}
            {fusiones.length > 5 && (
              <li className="text-muted-foreground">
                y {fusiones.length - 5} más.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* AVISO DE PRODUCTO COMPARTIDO — el hueco que dejó el de fusión.
          Aquel solo dispara cuando dos nombres chocan en la MISMA variante;
          este ve el caso que se aprobó sin una queja el 28/8: cinco vestidos
          distintos, cinco colores distintos, un solo producto.

          En ámbar y no en rojo, y sin frenar: compartir producto a veces es
          correcto —el proveedor escribió el mismo artículo de dos formas— y
          eso ya lo filtra `esMismaPrenda`. Lo que queda acá es una pregunta
          que solo el comercio puede contestar. Frenarlo sería frenar remitos
          buenos; no mostrarlo fue perder cinco prendas adentro de una. */}
      {compartidosSospechosos.length > 0 && (
        <div className="mx-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {compartidosSospechosos.length === 1
              ? "Hay un producto que va a recibir varios artículos del remito"
              : `Hay ${compartidosSospechosos.length} productos que van a recibir varios artículos del remito`}
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            Son nombres distintos del proveedor cayendo en el mismo producto. Si
            de verdad son prendas distintas, van a quedar como variantes de una
            sola y el catálogo va a decir que son lo mismo.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {compartidosSospechosos.slice(0, 5).map((c) => (
              <li key={c.productoId} className="text-foreground/90">
                <span className="font-semibold">{c.nombres.join(" + ")}</span>{" "}
                → {c.productoNombre}
              </li>
            ))}
            {compartidosSospechosos.length > 5 && (
              <li className="text-muted-foreground">
                y {compartidosSospechosos.length - 5} más.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Tabla Interactiva Agrupada */}
      <div className="bg-background rounded-xl border border-border overflow-hidden md:overflow-x-auto">
        <table className="w-full text-sm text-left max-md:block md:min-w-250">
          <thead className="bg-muted/50 text-foreground/80 text-xs uppercase font-semibold tracking-wide border-b border-border max-md:hidden">
            <tr>
              <th className="px-6 py-3 w-16 text-center">Estado</th>
              <th className="px-6 py-3 w-1/3">Productos del Remito</th>
              <th className="px-6 py-3 w-1/3">Vinculación en Sistema</th>
              <th className="px-6 py-3 text-right">Costo Und.</th>
              <th className="px-6 py-3 text-right">Precio Público</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border max-md:block">
            {groupedItems.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="text-center py-12 text-muted-foreground max-md:block max-md:w-full"
                >
                  No hay ítems para conciliar.
                </td>
              </tr>
            ) : (
              groupedItems.map(([rawNombre, group]) => {
                // Tomamos el primer item como representativo para estado y costos base
                const firstItem = group[0];
                const pReal = productoReal(firstItem.producto_id);
                const isPerfecto =
                  firstItem.estado_match === "PERFECTO" ||
                  firstItem.estado_match === "NUEVO_ALIAS";
                const isInflacion = firstItem.estado_match === "MODIFICADO";
                const isDesconocido = firstItem.estado_match === "DESCONOCIDO";
                const bucket = isDesconocido
                  ? clasificacionPorGrupo.get(rawNombre)
                  : undefined;
                const posibleMatch =
                  bucket?.tipo === "POSIBLE_MATCH" ? bucket : null;
                const nuevoSugerido =
                  bucket?.tipo === "NUEVO_SUGERIDO" ? bucket : null;
                const isAmbiguo =
                  isDesconocido && !posibleMatch && !nuevoSugerido;
                const totalGroupStock = group.reduce(
                  (sum, i) => sum + i.cantidad,
                  0,
                );

                // Este grupo choca con otro en la misma variante: gana sobre
                // cualquier otro estado, porque es lo único que impide
                // impactar el remito.
                const enFusion = nombresEnFusion.has(rawNombre);
                // Comparte producto con otro grupo sin chocar todavía. No
                // bloquea —el proveedor puede escribir el mismo artículo de
                // dos formas— pero es la antesala de la fusión.
                const comparteProducto = firstItem.producto_id
                  ? (productosCompartidos.get(firstItem.producto_id) ?? [])
                      .filter((n) => n !== rawNombre)
                  : [];

                let rowClassName = "hover:bg-muted/30";
                if (enFusion)
                  rowClassName = "bg-danger/20 hover:bg-danger/30";
                else if (isInflacion)
                  rowClassName = "bg-warning/10 hover:bg-warning/20";
                else if (posibleMatch)
                  rowClassName = "bg-info/10 hover:bg-info/20";
                else if (nuevoSugerido)
                  rowClassName = "bg-chart-3/10 hover:bg-chart-3/20";
                else if (isAmbiguo)
                  rowClassName = "bg-danger/10 hover:bg-danger/20";

                return (
                  <tr
                    key={rawNombre}
                    className={`transition-colors ${rowClassName} max-md:block max-md:py-2`}
                  >
                    {/* STATUS */}
                    <td
                      data-label="Estado"
                      className={`px-6 py-4 text-center align-top pt-5 max-md:text-left ${CELDA_APILADA}`}
                    >
                      {isAmbiguo && (
                        <input
                          type="checkbox"
                          className="mb-1.5 w-4 h-4 accent-danger cursor-pointer"
                          checked={gruposSeleccionados.has(rawNombre)}
                          onChange={() => toggleGrupoSeleccionado(rawNombre)}
                          title="Seleccionar para asignar categoría en lote"
                        />
                      )}
                      {isPerfecto && (
                        <CheckCircle2 className="w-6 h-6 text-chart-4 mx-auto" />
                      )}
                      {isInflacion && (
                        <AlertTriangle className="w-6 h-6 text-chart-5 mx-auto" />
                      )}
                      {posibleMatch && (
                        <Search className="w-6 h-6 text-chart-1 mx-auto" />
                      )}
                      {nuevoSugerido && (
                        <Sparkles className="w-6 h-6 text-chart-3 mx-auto" />
                      )}
                      {isAmbiguo && (
                        <HelpCircle className="w-6 h-6 text-chart-2 mx-auto" />
                      )}
                    </td>

                    {/* PRODUCTO DEL PROVEEDOR (Desglose de variantes) */}
                    <td
                      data-label="Productos del remito"
                      className={`px-6 py-4 align-top ${CELDA_APILADA}`}
                    >
                      <p className="font-bold text-foreground uppercase tracking-wide">
                        {rawNombre}
                      </p>
                      {enFusion ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-danger">
                          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                          Se combina con otro renglón en la misma variante. Su
                          stock se sumaría en una sola fila.
                        </p>
                      ) : (
                        comparteProducto.length > 0 && (
                          <p className="mt-1 text-[11px] text-chart-5">
                            Comparte producto con{" "}
                            {comparteProducto
                              .slice(0, 2)
                              .map((n) => `"${n}"`)
                              .join(", ")}
                            {comparteProducto.length > 2
                              ? ` y ${comparteProducto.length - 2} más`
                              : ""}
                            .
                          </p>
                        )
                      )}
                      {/* Dato CRUDO tal como vino del CSV (raw_marca /
                          raw_genero) — antes de cualquier resolución, para
                          poder comparar de un vistazo contra lo que el
                          sistema entendió (categoría/marca del candidato,
                          en la columna de al lado). */}
                      {(firstItem.raw_marca || firstItem.raw_genero) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {[
                            firstItem.raw_marca
                              ? `Marca: ${firstItem.raw_marca}`
                              : null,
                            firstItem.raw_genero
                              ? `Género: ${firstItem.raw_genero}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {/* Sub-bloques de variantes integrados */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {group.map((item, idx) => {
                          const segmentosDetectados = item.raw_variante
                            .split(" / ")
                            .map((segmento) => parseAttributeSegment(segmento))
                            .filter(
                              (
                                segmento,
                              ): segmento is {
                                nombre: string;
                                valor: string;
                              } => segmento !== null,
                            );
                          const key = item.id ?? `${rawNombre}-${idx}`;
                          const expandible = segmentosDetectados.length > 0;
                          const expandida = variantesExpandidas.has(key);

                          return (
                            <div key={idx} className="flex flex-col gap-1">
                              <button
                                type="button"
                                disabled={!expandible}
                                onClick={() => toggleVarianteExpandida(key)}
                                className={`flex items-center gap-1.5 bg-background border border-border/80 px-2 py-1 rounded text-xs text-muted-foreground ${
                                  expandible
                                    ? "cursor-pointer hover:border-primary/50"
                                    : "cursor-default"
                                }`}
                              >
                                <Layers className="w-3 h-3 opacity-60 shrink-0" />
                                <span className="truncate max-w-37">
                                  {item.raw_variante}
                                </span>
                                <span className="font-semibold text-success ">
                                  +{item.cantidad}
                                </span>
                                {expandible &&
                                  (expandida ? (
                                    <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />
                                  ))}
                              </button>
                              {expandida && (
                                <div className="flex flex-wrap gap-1 pl-1">
                                  {segmentosDetectados.map(
                                    (segmento, segIdx) => (
                                      <span
                                        key={`${segmento.nombre}-${segIdx}`}
                                        className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-[10px] text-muted-foreground font-semibold border border-border/50"
                                      >
                                        {segmento.nombre}: {segmento.valor}
                                      </span>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-xs font-semibold text-muted-foreground">
                        Total a ingresar:{" "}
                        <span className="text-foreground">
                          {totalGroupStock} u.
                        </span>
                      </div>
                    </td>

                    {/* VINCULACIÓN EN SISTEMA */}
                    <td
                      data-label="Vinculación en sistema"
                      className={`px-6 py-4 align-top pt-5 ${CELDA_APILADA}`}
                    >
                      {(() => {
                        const abrirModalManual = () => {
                          setGroupToCreateName(rawNombre);
                          setCrearError(null);

                          // Si ya hay un precio calculado para esta fila (recargo global
                          // aplicado o edición manual), lo usamos como sugerencia.
                          // Si no, caemos al fallback por defecto de costo + 50%.
                          const recargoYaAplicado =
                            (firstItem.precio_venta_actualizado || 0) > 0;
                          const precioSugerido = recargoYaAplicado
                            ? (firstItem.precio_venta_actualizado as number)
                            : Math.ceil(firstItem.precio_costo * 1.5);

                          const origenPrecio = recargoYaAplicado
                            ? `Costo $${firstItem.precio_costo.toLocaleString("es-AR")} + ${(
                                ((precioSugerido - firstItem.precio_costo) /
                                  firstItem.precio_costo) *
                                100
                              ).toFixed(
                                1,
                              )}% recargo = $${precioSugerido.toLocaleString("es-AR")}`
                            : "Precio sugerido por defecto (sin recargo aplicado todavía)";

                          // La sugerencia de REGLAS_CATEGORIA es un NOMBRE
                          // (diccionario portable entre comercios), así que
                          // puede no existir en el árbol de este tenant —
                          // en ese caso no hay id que precargar y el select
                          // queda vacío, que es lo correcto: no inventamos
                          // una categoría que no existe acá.
                          const categoriaIdSugerida = nuevoSugerido
                            ? (nuevoSugerido.categoriaId ??
                              idPorNombreCategoria(
                                nuevoSugerido.categoriaSugerida.categoriaNombre,
                              ))
                            : undefined;

                          setNuevoProductoData({
                            nombre: rawNombre,
                            precio: precioSugerido,
                            categoriaId:
                              categoriaIdPorGrupo[rawNombre] ??
                              categoriaIdSugerida ??
                              firstItem.raw_categoria_id ??
                              "",
                            marca: firstItem.raw_marca ?? "",
                            origenPrecio,
                          });
                          setArchivosNuevoProducto([]);
                        };

                        const fallbackManual = (
                          <>
                            <SearchableSelect
                              productos={localProductos}
                              value={firstItem.producto_id || null}
                              onSelect={(value) =>
                                handleAssignProduct(rawNombre, value)
                              }
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs border-dashed text-foreground hover:border-primary w-full justify-start"
                              onClick={abrirModalManual}
                            >
                              <PlusCircle className="w-4 h-4 mr-2" />
                              Crear Producto Nuevo
                            </Button>
                          </>
                        );

                        if (posibleMatch) {
                          const candidatoCategoriaLabel = posibleMatch.candidato
                            .categoriaId
                            ? resolverCategoriaDisplayLabel(
                                categoriasDB,
                                posibleMatch.candidato.categoriaId,
                              )
                            : "";
                          // Qué tan confiable es la sugerencia, midiendo si las
                          // palabras que DISTINGUEN al producto coinciden. El
                          // trigrama de la RPC no puede: con "VESTIDO EGRESADA
                          // ALANA" y "…ALINA", casi todo el nombre es igual.
                          const afinidad = evaluarCandidato(
                            rawNombre,
                            posibleMatch.candidato.nombre,
                            pesosCatalogo,
                            localProductos.length,
                          );
                          // Los OTROS candidatos que la RPC devolvió y que
                          // hasta ahora se tiraban. Con una familia de nombre
                          // largo ("VESTIDO EGRESADA …") pueden ser 5, y
                          // mostrar uno solo convierte una elección en una
                          // afirmación.
                          const otros = posibleMatch.candidatos
                            .slice(1)
                            .map((c) => ({
                              candidato: c,
                              afinidad: evaluarCandidato(
                                rawNombre,
                                c.nombre,
                                pesosCatalogo,
                                localProductos.length,
                              ),
                            }));
                          const empatan = hayEmpate([
                            afinidad.cobertura,
                            ...otros.map((o) => o.afinidad.cobertura),
                          ]);
                          // Con empate no hay recomendación posible: el orden
                          // lo puso el trigrama, que es justo lo que no
                          // distingue a estos nombres.
                          const dudosa = afinidad.confianza === "baja" || empatan;
                          return (
                            <div className="flex flex-col gap-2">
                              <div
                                className={`flex items-start justify-between gap-2 p-2 rounded-md border ${
                                  dudosa
                                    ? "bg-chart-5/10 border-chart-5"
                                    : "bg-sky-300/10 border-sky-300"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p
                                    className={`font-semibold flex items-center gap-1.5 truncate ${
                                      dudosa ? "text-chart-5" : "text-sky-400"
                                    }`}
                                  >
                                    <Search className="w-3.5 h-3.5 shrink-0" />
                                    {posibleMatch.candidato.nombre}
                                  </p>
                                  {dudosa ? (
                                    // Lo único que importa acá es en QUÉ se
                                    // diferencian: el porcentaje de similitud
                                    // empuja a confirmar, y es justo lo que
                                    // hacía fusionar dos prendas distintas.
                                    <p className="text-[11px] text-chart-5 mt-0.5">
                                      {afinidad.faltantes.length > 0
                                        ? `El remito dice "${afinidad.faltantes.join(", ")}" y este producto no.`
                                        : "Los nombres se parecen, pero no coinciden."}
                                      {afinidad.sobrantes.length > 0 &&
                                        ` En el sistema dice "${afinidad.sobrantes.join(", ")}".`}
                                    </p>
                                  ) : (
                                    <p className="text-[11px] text-sky-300 mt-0.5">
                                      ~
                                      {Math.round(
                                        posibleMatch.candidato.score * 100,
                                      )}
                                      % similar
                                    </p>
                                  )}
                                  {(posibleMatch.candidato.marca ||
                                    candidatoCategoriaLabel) && (
                                    <p className="text-[11px] text-sky-300 mt-0.5 truncate">
                                      {[
                                        posibleMatch.candidato.marca
                                          ? `Marca: ${posibleMatch.candidato.marca}`
                                          : null,
                                        candidatoCategoriaLabel || null,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                  {/* El costo y el precio del candidato: con
                                      nombres que se diferencian en dos letras
                                      ("CADARUVE CF" y "CADARUVE CR"), el
                                      número es lo que permite darse cuenta de
                                      que es OTRA prenda antes de confirmar. */}
                                  {(() => {
                                    const cand = productoReal(
                                      posibleMatch.candidato.productoId,
                                    );
                                    if (!cand) return null;
                                    const costo = Number(cand.precio_costo) || 0;
                                    const precio = Number(cand.precio) || 0;
                                    if (!costo && !precio) return null;
                                    return (
                                      <p className="text-[11px] text-sky-300/80 mt-0.5">
                                        Hoy: costo $
                                        {costo.toLocaleString("es-AR")} · precio $
                                        {precio.toLocaleString("es-AR")}
                                        {" · "}el remito trae costo $
                                        {firstItem.precio_costo.toLocaleString(
                                          "es-AR",
                                        )}
                                      </p>
                                    );
                                  })()}
                                </div>
                                {/* Con confianza baja el botón NO es la acción
                                    principal: la pantalla pregunta en vez de
                                    recomendar. Un botón azul y prominente sobre
                                    una sugerencia dudosa es lo que hacía
                                    confirmar de más. */}
                                <Button
                                  size="sm"
                                  variant={dudosa ? "outline" : "default"}
                                  className={
                                    dudosa
                                      ? "h-8 text-xs shrink-0"
                                      : "h-8 text-xs bg-sky-600 hover:bg-sky-700 text-white shrink-0"
                                  }
                                  onClick={() =>
                                    handleAssignProduct(
                                      rawNombre,
                                      posibleMatch.candidato.productoId,
                                    )
                                  }
                                >
                                  {dudosa ? "Es el mismo" : "Confirmar asociación"}
                                </Button>
                              </div>

                              {/* Los demás candidatos. Se muestran SIEMPRE que
                                  existan, no solo con empate: que el segundo
                                  esté más lejos no lo vuelve inexistente, y el
                                  costo de verlo es una línea. Con empate,
                                  además, arriba ya no hay recomendación. */}
                              {otros.length > 0 && (
                                <div className="rounded-md border border-border p-2">
                                  <p className="text-[11px] font-medium text-muted-foreground">
                                    {empatan
                                      ? "Se parecen todos lo mismo — elegí cuál es:"
                                      : `También se parece a ${otros.length === 1 ? "este" : "estos"}:`}
                                  </p>
                                  <ul className="mt-1 flex flex-col gap-1">
                                    {otros.map(
                                      ({ candidato, afinidad: otraAfinidad }) => (
                                        <li
                                          key={candidato.productoId}
                                          className="flex items-center justify-between gap-2"
                                        >
                                          <div className="min-w-0">
                                            <p className="truncate text-xs text-foreground/90">
                                              {candidato.nombre}
                                            </p>
                                            {otraAfinidad.faltantes.length >
                                              0 && (
                                              <p className="text-[11px] text-muted-foreground">
                                                le falta &quot;
                                                {otraAfinidad.faltantes.join(
                                                  ", ",
                                                )}
                                                &quot;
                                              </p>
                                            )}
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 shrink-0 text-xs"
                                            onClick={() =>
                                              handleAssignProduct(
                                                rawNombre,
                                                candidato.productoId,
                                              )
                                            }
                                          >
                                            Es este
                                          </Button>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              )}

                              <details className="text-xs" open={dudosa}>
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                                  {dudosa
                                    ? "Es otro producto — crearlo o buscar el correcto"
                                    : "No es este producto — buscar otro"}
                                </summary>
                                <div className="mt-2 flex flex-col gap-2">
                                  {fallbackManual}
                                </div>
                              </details>
                            </div>
                          );
                        }

                        if (nuevoSugerido) {
                          const categoriaIdOverride =
                            categoriaIdPorGrupo[rawNombre];
                          const categoriaNombreEfectiva = categoriaIdOverride
                            ? (nombrePorIdCategoria(categoriaIdOverride) ??
                              nuevoSugerido.categoriaSugerida.categoriaNombre)
                            : nuevoSugerido.categoriaSugerida.categoriaNombre;
                          // Si la sugerencia salió del árbol real ya trae
                          // el id resuelto; el lookup por nombre queda
                          // solo como fallback del diccionario plano.
                          const categoriaIdEfectiva =
                            categoriaIdOverride ??
                            nuevoSugerido.categoriaId ??
                            idPorNombreCategoria(
                              nuevoSugerido.categoriaSugerida.categoriaNombre,
                            );
                          return (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-start justify-between gap-2 p-2 bg-chart-3/10 border border-chart-3 rounded-md">
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground flex items-center gap-1.5 truncate">
                                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                    {categoriaNombreEfectiva}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Sugerido por &quot;
                                    {
                                      nuevoSugerido.categoriaSugerida
                                        .matchedKeyword
                                    }
                                    &quot;
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  className="h-8 text-xs bg-chart-3 hover:bg-chart-3/80 text-white shrink-0"
                                  disabled={loadingPorGrupo[rawNombre]}
                                  onClick={() =>
                                    handleCrearSugerido(
                                      rawNombre,
                                      categoriaIdEfectiva,
                                      categoriaNombreEfectiva,
                                    )
                                  }
                                >
                                  {loadingPorGrupo[rawNombre] ? (
                                    "Creando..."
                                  ) : errorPorGrupo[rawNombre] ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />{" "}
                                      Reintentar
                                    </>
                                  ) : (
                                    "Crear"
                                  )}
                                </Button>
                              </div>
                              {errorPorGrupo[rawNombre] && (
                                <p className="text-[11px] text-danger font-medium">
                                  {errorPorGrupo[rawNombre]}
                                </p>
                              )}
                              <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                                  No es esta categoría — elegir a mano
                                </summary>
                                <div className="mt-2 flex flex-col gap-2">
                                  {/* Selector de CATEGORÍA (lo que promete el
                                      label) — arranca en la sugerencia
                                      vigente, así corregirla es un solo
                                      paso y no se pierde lo ya elegido.
                                      Antes acá solo había un buscador de
                                      producto + "Crear", que abría el modal
                                      con la categoría en blanco. */}
                                  <CategoriaPadreHijoSelect
                                    arbol={arbolCategoriasDB}
                                    categoriasFlat={categoriasDB}
                                    value={categoriaIdEfectiva ?? ""}
                                    onChange={(val) =>
                                      setCategoriaIdPorGrupo((prev) => ({
                                        ...prev,
                                        [rawNombre]: val,
                                      }))
                                    }
                                    size="sm"
                                    triggerClassName="h-8 w-full bg-background"
                                  />
                                  {fallbackManual}
                                </div>
                              </details>
                            </div>
                          );
                        }

                        if (isDesconocido) {
                          return (
                            <div className="flex flex-col gap-2 relative">
                              {fallbackManual}
                            </div>
                          );
                        }

                        return null;
                      })()}
                      {!isDesconocido && (
                        <div className="flex items-start justify-between gap-2 p-2 bg-background border border-border/60 rounded-md">
                          <div>
                            <p className="font-semibold text-primary flex items-center gap-1.5">
                              {pReal?.nombre}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Asignado a {group.length} variantes
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-danger hover:text-danger hover:bg-danger/10 shrink-0"
                            onClick={() => handleUndo(rawNombre)}
                            title="Deshacer asignación para todo el grupo"
                          >
                            <Undo2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </td>

                    {/* COSTO UNITARIO */}
                    <td
                      data-label="Costo unitario"
                      className={`px-6 py-4 text-right align-top pt-5 max-md:text-left ${CELDA_APILADA}`}
                    >
                      <p className="font-semibold text-foreground">
                        $
                        {Number(firstItem.precio_costo).toLocaleString("es-AR")}
                      </p>
                      {isInflacion && pReal && (
                        <p
                          className="text-xs text-warning font-semibold line-through mt-0.5"
                          title="Costo anterior en sistema"
                        >
                          Era $
                          {Number(pReal.precio_costo).toLocaleString("es-AR")}
                        </p>
                      )}
                    </td>

                    {/* PRECIO PÚBLICO (Unificado para todo el grupo) */}
                    <td
                      data-label="Precio público"
                      className={`px-6 py-4 text-right align-top pt-5 max-md:text-left ${CELDA_APILADA}`}
                    >
                      {firstItem.producto_id ? (
                        <div className="flex justify-end">
                          <div className="relative w-28">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                              $
                            </span>
                            <Input
                              type="number"
                              className={`pl-7 h-9 font-semibold text-right ${
                                isInflacion
                                  ? "border-amber-400 bg-amber-50 focus-visible:ring-amber-500"
                                  : "bg-background"
                              }`}
                              value={firstItem.precio_venta_actualizado || 0}
                              onChange={(e) =>
                                handleUpdatePrice(
                                  rawNombre,
                                  Number(e.target.value),
                                )
                              }
                              title="Este precio se aplicará al producto padre y sus variantes"
                            />
                          </div>
                        </div>
                      ) : null}

                      {/* DE DÓNDE SALE ESE PRECIO. Sin esto, el número aparece
                          solo y no se puede saber si es el del proveedor, el
                          que había, o uno recalculado — que es exactamente la
                          confusión que reportó Evelyn al confirmar una
                          asociación. */}
                      {firstItem.producto_id &&
                        (() => {
                          const propuesta = propuestaPrecio(
                            firstItem,
                            firstItem.producto_id,
                          );
                          const precioPuesto =
                            Number(firstItem.precio_venta_actualizado) || 0;
                          const margen =
                            firstItem.precio_costo > 0 && precioPuesto > 0
                              ? precioPuesto / firstItem.precio_costo
                              : null;

                          return (
                            <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                              <p>{propuesta.explicacion}</p>
                              {propuesta.advertencia && (
                                <p className="font-semibold text-warning">
                                  {propuesta.advertencia}
                                </p>
                              )}
                              {margen !== null && (
                                <p
                                  className={
                                    propuesta.markupAnterior !== null &&
                                    margen < propuesta.markupAnterior - 0.01
                                      ? "font-semibold text-warning"
                                      : ""
                                  }
                                >
                                  Margen ×{margen.toFixed(2)}
                                  {propuesta.markupAnterior !== null &&
                                    ` (antes ×${propuesta.markupAnterior.toFixed(2)})`}
                                </p>
                              )}
                            </div>
                          );
                        })()}

                      {!firstItem.producto_id && (
                        <span className="text-xs text-muted-foreground italic mr-2">
                          Esperando asignación...
                        </span>
                      )}
                    </td>

                    {/* DESCARTAR GRUPO */}
                    <td className="px-4 py-4 text-center align-top pt-5 max-md:block max-md:w-full max-md:px-4 max-md:py-1 max-md:text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-danger hover:bg-danger/10"
                        onClick={() => setGroupToRemoveName(rawNombre)}
                        title="Descartar todo este grupo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal para Crear Al Vuelo */}
      <Dialog
        open={groupToCreateName !== null}
        onOpenChange={(open) => {
          if (!open) {
            setGroupToCreateName(null);
            setArchivosNuevoProducto([]);
            setCrearError(null);
          }
        }}
      >
        <DialogContent aria-describedby="crear-producto-description">
          <DialogHeader>
            <DialogTitle>Crear Producto Múltiple</DialogTitle>
            <DialogDescription id="crear-producto-description">
              Se creará este producto y se le asociarán las variantes detectadas
              automáticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Nombre del Producto Central</Label>
              <Input
                value={nuevoProductoData.nombre}
                onChange={(e) =>
                  setNuevoProductoData({
                    ...nuevoProductoData,
                    nombre: e.target.value,
                  })
                }
                placeholder="Ej: Ficus Benjamina"
              />
            </div>

            <ProductMediaSection
              archivos={archivosNuevoProducto}
              onArchivosChange={setArchivosNuevoProducto}
              inputId="imagenes-merge-table"
            />

            <div className="space-y-2">
              <Label>Categoría</Label>
              <CategoriaPadreHijoSelect
                arbol={arbolCategoriasDB}
                categoriasFlat={categoriasDB}
                value={nuevoProductoData.categoriaId}
                onChange={(val) =>
                  setNuevoProductoData({
                    ...nuevoProductoData,
                    categoriaId: val,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Marca</Label>
              <Input
                value={nuevoProductoData.marca}
                onChange={(e) =>
                  setNuevoProductoData({
                    ...nuevoProductoData,
                    marca: e.target.value,
                  })
                }
                placeholder="Ej: Ossira"
              />
            </div>

            <div className="space-y-2">
              <Label>Precio Público Unificado</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                  $
                </span>
                <Input
                  type="number"
                  className="pl-7"
                  value={nuevoProductoData.precio}
                  onChange={(e) =>
                    setNuevoProductoData({
                      ...nuevoProductoData,
                      precio: Number(e.target.value),
                    })
                  }
                />
              </div>
              {nuevoProductoData.origenPrecio && (
                <p className="text-xs text-muted-foreground">
                  {nuevoProductoData.origenPrecio}
                </p>
              )}
              {grupoTieneCostoDisperso && (
                <div className="flex items-start gap-2 bg-warning/10 border border-warning rounded-md p-2.5 mt-2">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-warning font-medium leading-tight">
                    Este grupo tiene variantes con distinto costo — se va a
                    aplicar el precio calculado por variante, no un valor único.
                  </p>
                </div>
              )}
            </div>

            {crearError && (
              <div className="flex items-start gap-2 bg-danger/10 border border-danger/20 rounded-md p-2.5">
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger font-medium leading-tight">
                  {crearError}
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setGroupToCreateName(null);
                  setArchivosNuevoProducto([]);
                  setCrearError(null);
                }}
                disabled={crearLoading}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCrearAlVuelo}
                disabled={crearLoading}
                className="bg-primary"
              >
                {crearLoading ? (
                  "Creando..."
                ) : crearError ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                  </>
                ) : (
                  "Guardar y Asignar Todo"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmación para Descartar Grupo */}
      <AlertDialog
        open={groupToRemoveName !== null}
        onOpenChange={(open) => !open && setGroupToRemoveName(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar grupo completo?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás a punto de ignorar{" "}
              <strong className="text-foreground">{groupToRemoveName}</strong> y
              todas sus variantes de este remito. No se impactará stock ni
              precios para este producto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setGroupToRemoveName(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveGroup}
              className="bg-danger hover:bg-danger text-white"
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Recuperación de Borrador Local */}
      <AlertDialog open={draftState === "prompt"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Progreso sin confirmar encontrado
            </AlertDialogTitle>
            <AlertDialogDescription>
              Encontramos un progreso sin confirmar de esta conciliación.
              ¿Querés continuar donde quedaste?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDescartarDraft}>
              Empezar de cero
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRestaurarDraft}>
              Continuar donde quedé
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
