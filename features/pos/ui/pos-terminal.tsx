"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSlugNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { Producto } from "@/entities/productos/types";
import type { Rubro } from "@/entities/config/types";
import { PackagePlus, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/shared/store/cart-store";
import { queryKeys } from "@/shared/lib/query-keys";
import { toast } from "sonner";
import { useCatalogFilters } from "@/features/store/hooks/use-catalog-filters";
import { QuickAddModal } from "@/features/pos/ui/quick-add-modal";
import { PosProductList } from "@/features/pos/ui/pos-product-list";
import { posSinImagenes } from "@/features/pos/lib/vista-por-rubro";
import { resumirStock } from "@/features/pos/lib/resumen-stock";
import Image from "next/image";
import { StockFiltersToolbar } from "@/features/stock/ui/stock-filters-toolbar";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  formatearCantidad,
  formatearNumeroCantidad,
  sufijoPrecioPorUnidad,
} from "@/shared/lib/unidad-venta";
import { ShareButton } from "@/shared/components/share-button";
import {
  construirUrlProducto,
  esVisibleEnCatalogo,
} from "@/shared/utils/compartir-catalogo";
import {
  productoCargadoAProducto,
  resolverImagenPrincipal,
  resolverVariantesVendibles,
  type VarianteVendible,
} from "../lib/producto-a-carrito";
import { useCargaRapida } from "@/features/carga-rapida/hooks/use-carga-rapida";
import {
  CargaRapidaPanel,
  CargaRapidaRecargo,
} from "@/features/carga-rapida/ui/carga-rapida-panel";
import type { ProductoCargado } from "@/features/carga-rapida/types";
import { useCobroCcStore } from "@/shared/store/cobro-cc-store";
import { useAtajosTeclado } from "@/shared/hooks/use-atajos-teclado";
import { useListasPrecios } from "@/shared/hooks/use-listas-precios";
import { precioBaseDeVariante } from "@/shared/lib/precio-de-lista";

/** Con menos resultados que esto, la grilla ofrece cargar lo que se buscó:
 * no hay que esperar a que la búsqueda quede en cero para poder crearlo. */
const RESULTADOS_PARA_OFRECER_CARGA = 6;

/** Cuántos productos se dibujan por tanda. Ver `productosVisibles`. */
const PAGINA = 24;

interface PosTerminalProps {
  productos: Producto[];
  categorias: Array<{
    id: string;
    nombre: string;
    slug?: string | null;
    parent_id?: string | null;
  }>;
  permitirVentaSinStock?: boolean;
  nombreComercio?: string;
  mostrarSinStock?: boolean;
  /** Lo necesita la Carga rápida: en electro consulta el Catálogo Maestro,
   * en indumentaria ni lo intenta. */
  rubro: Rubro;
  /** Permiso `clientes.cobrar_cc`: decide si la barra ofrece "Cobrar deuda".
   * El modal vive montado en el layout; acá solo se lo abre. */
  puedeCobrarCuentaCorriente?: boolean;
  /** Búsqueda con la que arranca la pantalla. Hoy la manda la paleta (Ctrl+K)
   * por `?q=` cuando se elige un producto desde otra pantalla. */
  busquedaInicial?: string;
  /**
   * El catálogo todavía viene en camino, y `productos` está vacío por eso y no
   * porque el comercio no tenga nada.
   *
   * La distinción NO es cosmética. Sin ella, la grilla vacía dispara "No se
   * encontraron productos" —y, si la vendedora ya tipeó o escaneó algo, además
   * ofrece CREAR ese producto— cuando la verdad es que todavía no sabemos si
   * existe. Decirle que no está y ofrecerle cargarlo es peor que hacerla
   * esperar: termina con el producto duplicado.
   */
  cargandoCatalogo?: boolean;
}

const getStockTotal = (producto: Producto) => {
  const stockNuevos =
    producto.producto_variantes?.reduce(
      (acc, v) => acc + Number(v.stock_disponible ?? v.stock ?? 0),
      0,
    ) || 0;

  // Solo se suma el stock legacy si el producto no tiene producto_variantes
  // — si no, se duplica el total porque ambas fuentes describen el mismo stock.
  if (producto.producto_variantes && producto.producto_variantes.length > 0) {
    return stockNuevos;
  }

  const stockViejos =
    producto.stock?.reduce((acc, s) => acc + Number(s.cantidad || 0), 0) || 0;

  return stockViejos + stockNuevos;
};

export function PosTerminal({
  productos,
  categorias,
  permitirVentaSinStock = false,
  nombreComercio = "Tienda",
  mostrarSinStock = true,
  rubro,
  puedeCobrarCuentaCorriente = false,
  busquedaInicial = "",
  cargandoCatalogo = false,
}: Readonly<PosTerminalProps>) {
  const abrirCobroCc = useCobroCcStore((state) => state.abrir);
  // El buscador de la barra: lo comparten la tecla "F" y la Carga rápida.
  const buscadorRef = useRef<HTMLInputElement>(null);
  // El área scrolleable de productos y, adentro, la grilla. La grilla se
  // referencia aparte porque de ELLA se leen las columnas: son clases de
  // Tailwind (2 / md:3 / lg:4) y repetir esos breakpoints en JS sería una
  // segunda definición que se desincroniza la primera vez que alguien toca
  // el layout.
  const contenedorProductosRef = useRef<HTMLDivElement>(null);
  const grillaRef = useRef<HTMLDivElement>(null);
  // El link del catálogo necesita el negocio, no solo el origen: cada
  // comercio tiene su propia tienda.
  const slugNegocio = useSlugNegocioActivo() ?? "";
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState(busquedaInicial);
  const [tipo, setTipo] = useState("todos");
  const [filtrosVariantes, setFiltrosVariantes] = useState<
    Record<string, string[]>
  >({});
  const [visibleCount, setVisibleCount] = useState(PAGINA);

  // Estados para el Modal Rápido
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Carga rápida NO es otra pantalla: es una vista del mismo POS. Cambian la
  // grilla y la fila de pills; el buscador, el ticket y el sidebar quedan
  // donde están.
  const [vista, setVista] = useState<"vender" | "cargar">("vender");

  const addItem = useCartStore((state) => state.addItem);
  const itemsCarrito = useCartStore((state) => state.items);

  /**
   * Cuántas unidades de cada producto ya están en el ticket.
   *
   * Se suma POR PRODUCTO y no por variante: la grilla muestra productos, y
   * lo que la vendedora necesita saber de un vistazo es si esa card ya
   * entró al ticket. Si cargó dos talles, la card dice "3" y el detalle
   * está en el ticket, que es donde se corrige.
   */
  const cantidadEnCarrito = useMemo(() => {
    const porProducto = new Map<string, number>();
    for (const item of itemsCarrito) {
      porProducto.set(
        item.productoId,
        (porProducto.get(item.productoId) ?? 0) + item.cantidad,
      );
    }
    return porProducto;
  }, [itemsCarrito]);
  const setIsOpenCart = useCartStore((state) => state.setIsOpen);
  // La lista con la que se está armando el ticket. La elige el carrito, que es
  // un componente hermano: por eso vive en el store y no en un prop.
  const listaPrecioId = useCartStore((state) => state.listaPrecioId);
  const { resolver: resolverPrecio } = useListasPrecios();

  const {
    arbolCategorias,
    productosFiltrados,
    propiedadesGlobales,
    matchesFueraDeCategoria,
  } = useCatalogFilters({
    productos,
    categorias,
    searchQuery,
    tipo,
    filtrosVariantes,
    orden: "mas_vendidos",
    // SIN `visibleCount`: acá el corte se hace ABAJO, después de ordenar por
    // stock. Antes decía `visibleCount: 1000` y no hacía nada — el hook lo usa
    // solo para `productosVisibles`, y la grilla mapeaba `productosFiltrados`,
    // que es la lista entera. O sea que el POS dibujaba las 1.226 tarjetas de
    // Evens en el primer pintado, sin virtualización, con su imagen, su
    // resumen de stock y su URL para compartir cada una. Ese era el TBT de
    // 1.080 ms.
  });

  // Padres primero (con sus hijos embebidos, para que el toolbar los
  // reconozca y ofrezca navegación de 2 niveles), después las categorías
  // sueltas — mismo orden que CategoryPills en el catálogo público.
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

  const productosOrdenados = useMemo(
    () =>
      [...productosFiltrados].sort((a, b) => {
        const stockA = getStockTotal(a);
        const stockB = getStockTotal(b);

        if (stockA > 0 && stockB <= 0) return -1;
        if (stockA <= 0 && stockB > 0) return 1;
        return 0;
      }),
    [productosFiltrados],
  );

  /**
   * Lo que REALMENTE se dibuja.
   *
   * El corte va acá y no adentro de `useCatalogFilters` por el orden de las
   * operaciones: el hook cortaría sobre el resultado del filtro, y el "con
   * stock primero" se aplica DESPUÉS. Cortando antes, la primera pantalla de
   * un catálogo con mucho agotado podría quedar entera sin stock — justo lo
   * que ese orden existe para evitar.
   *
   * `PAGINA` arranca en 24 y no en 12 (el número de la tienda pública) porque
   * en una tablet apaisada la grilla es de 4 columnas: 12 llenan tres filas y
   * se vería el fondo abajo apenas carga.
   */
  const productosVisibles = useMemo(
    () => productosOrdenados.slice(0, visibleCount),
    [productosOrdenados, visibleCount],
  );
  const hayMasProductos = visibleCount < productosOrdenados.length;

  // Al cambiar la búsqueda, la categoría o los filtros, la lista es OTRA y el
  // scroll vuelve arriba: mostrar 200 de la búsqueda anterior sería pagar
  // render por lo que nadie está mirando. `useMemo` y no `useEffect` para que
  // el reset ocurra en el mismo render del cambio y no en uno posterior, que
  // dibujaría una vez de más.
  const claveDeLista = `${searchQuery}|${tipo}|${JSON.stringify(filtrosVariantes)}`;
  const [claveAnterior, setClaveAnterior] = useState(claveDeLista);
  if (claveAnterior !== claveDeLista) {
    setClaveAnterior(claveDeLista);
    setVisibleCount(PAGINA);
  }

  /** Suma una página cuando el scroll se acerca al fondo del contenedor. Sin
   * botón: en el mostrador, buscar un producto scrolleando no puede pedir un
   * click extra. El margen de 600 px hace que la página siguiente ya esté
   * dibujada cuando se llega. */
  const handleScrollProductos = () => {
    if (!hayMasProductos) return;
    const el = contenedorProductosRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) {
      setVisibleCount((n) => n + PAGINA);
    }
  };

  // En kiosco y almacén la venta es por nombre, no de vista: la grilla pasa a
  // lista y el ticket del carrito deja de mostrar miniaturas. Se decide una
  // vez acá y viaja a los dos lugares, para que no puedan quedar en desacuerdo.
  const vistaSinImagenes = posSinImagenes(rubro);

  const hayFiltrosActivos =
    searchQuery !== "" ||
    tipo !== "todos" ||
    Object.values(filtrosVariantes).some((valores) => valores.length > 0);

  const limpiarFiltros = () => {
    setSearchQuery("");
    setTipo("todos");
    setFiltrosVariantes({});
  };

  const handleFiltroVarianteChange = (propiedad: string, valor: string) => {
    setFiltrosVariantes((prev) => {
      if (valor === "todos") return { ...prev, [propiedad]: [] };
      const actuales = prev[propiedad] ?? [];
      const siguientes = actuales.includes(valor)
        ? actuales.filter((v) => v !== valor)
        : [...actuales, valor];
      return { ...prev, [propiedad]: siguientes };
    });
  };

  const agregarVarianteAlCarrito = (
    producto: Producto,
    variante: VarianteVendible,
  ) => {
    // El precio de siempre, con la cascada compartida (`variante ?? producto`).
    const precioBase = precioBaseDeVariante(producto, {
      precio: variante.precio,
    });
    // Y encima, la lista con la que se está armando el ticket. Sin lista
    // elegida esto devuelve el mismo `precioBase` y no cambia nada.
    const { precio } = resolverPrecio({
      listaPrecioId,
      productoId: producto.id,
      precioBase,
      precioCosto: producto.precio_costo,
    });

    addItem({
      productoId: producto.id,
      nombre: producto.nombre || "Sin nombre",
      tipo: producto.tipo || "",
      variante: variante.variante,
      varianteId: variante.varianteId,
      precio,
      // El base y el costo viajan en la línea para que cambiar de lista pueda
      // re-preciar el ticket sin volver a mirar el catálogo: el carrito se
      // dibuja en otro componente que a propósito no recibe los ~2 MB de
      // productos.
      precioBase,
      costoBase: producto.precio_costo ?? null,
      cantidad: 1,
      unidadMedida: producto.unidad_medida,
      imagenUrl: resolverImagenPrincipal(producto),
      stockMaximo: variante.cantidad,
    });
  };

  const handleProductClick = (producto: Producto) => {
    const variantesParaVender = resolverVariantesVendibles(
      producto,
      permitirVentaSinStock,
    );

    if (variantesParaVender.length === 0) {
      toast.error("Producto agotado.");
      return;
    }

    // Variante única: se agrega como un rayo.
    if (variantesParaVender.length === 1) {
      agregarVarianteAlCarrito(producto, variantesParaVender[0]);
      setIsOpenCart(true);
    } else {
      // Varias variantes: abrimos el selector.
      setSelectedProduct(producto);
      setIsModalOpen(true);
    }
  };

  /**
   * Contexto de retorno de la Carga rápida dentro del POS: volver a Vender,
   * refrescar el catálogo y seguir la venta con lo cargado.
   *
   * Lo cargado entra por el MISMO camino que un producto tocado en la grilla
   * (`handleProductClick`): variante única va derecho al carrito, y con
   * talles/colores se abre el selector de siempre.
   */
  const handleCargaRapidaFinalizada = (cargados: ProductoCargado[]) => {
    setVista("vender");
    setSearchQuery("");
    queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });

    if (cargados.length === 0) return;

    // El selector de variante es uno solo y modal, así que no se pueden
    // encadenar: se agregan directo los de variante única y el selector se
    // abre para el primero que lo necesite. El resto ya quedó en el catálogo
    // y se toca desde la grilla.
    let pendienteDeSelector: Producto | null = null;

    for (const cargado of cargados) {
      const producto = productoCargadoAProducto(cargado);
      const vendibles = resolverVariantesVendibles(
        producto,
        permitirVentaSinStock,
      );
      if (vendibles.length === 1) {
        agregarVarianteAlCarrito(producto, vendibles[0]);
      } else if (vendibles.length > 1 && !pendienteDeSelector) {
        pendienteDeSelector = producto;
      }
    }

    if (pendienteDeSelector) {
      setSelectedProduct(pendienteDeSelector);
      setIsModalOpen(true);
    } else {
      setIsOpenCart(true);
    }
  };

  // LA Carga rápida, la misma de Inventario: mismo hook, mismo panel. Lo
  // único propio del POS es el contexto de retorno y que el texto lo maneja
  // el buscador de arriba en vez de un input propio.
  const carga = useCargaRapida(productos, rubro, {
    query: searchQuery,
    onQueryChange: setSearchQuery,
    onFinalizar: handleCargaRapidaFinalizada,
  });

  /** La card "cargar" de la grilla: la persona ya vio que no está, así que
   * la línea entra directo y la vista cambia a Cargar para completar precio
   * y cantidad. Sin modal de por medio. */
  const cargarLoBuscado = () => {
    const texto = searchQuery.trim();
    if (!texto) {
      setVista("cargar");
      return;
    }
    carga.agregarLineaNueva(texto);
    setVista("cargar");
  };

  /** Cuántas columnas está pintando la grilla AHORA. Sale de la CSS real, así
   * que sigue a los breakpoints de Tailwind sin repetirlos: si mañana la
   * grilla pasa a 5 columnas en pantallas grandes, las flechas se enteran
   * solas. En la vista de lista es siempre 1. */
  const columnasDeLaGrilla = () => {
    const grilla = grillaRef.current;
    if (!grilla) return 1;
    const columnas = getComputedStyle(grilla)
      .gridTemplateColumns.split(" ")
      .filter(Boolean).length;
    return columnas > 0 ? columnas : 1;
  };

  /** Mueve el foco `paso` productos: ±1 son los costados y ±columnas son
   * arriba y abajo. Los agotados no entran (van `disabled`, o sea que ni
   * siquiera son enfocables) y en los bordes se FRENA en vez de dar la
   * vuelta: con 851 productos, saltar del último al primero desorienta más
   * de lo que ayuda. La única salida por arriba es el buscador, que es de
   * donde se venía. */
  const moverFoco = (paso: number) => {
    const botones = Array.from(
      contenedorProductosRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-producto-foco]:not([disabled])",
      ) ?? [],
    );
    if (botones.length === 0) return;

    const actual = botones.indexOf(document.activeElement as HTMLButtonElement);

    // Desde el buscador (o desde cualquier otro lado), la primera flecha
    // entra al catálogo por el primer producto.
    if (actual === -1) {
      enfocar(botones[0]);
      return;
    }

    if (actual === 0 && paso < 0) {
      buscadorRef.current?.focus();
      return;
    }

    const destino = Math.min(Math.max(actual + paso, 0), botones.length - 1);
    enfocar(botones[destino]);
  };

  /** `preventScroll` + `scrollIntoView` en vez del scroll que hace `focus()`
   * solo: el del navegador centra el producto y salta media pantalla en cada
   * flecha. Con "nearest" la grilla se mueve lo mínimo para que se vea. */
  const enfocar = (boton: HTMLButtonElement) => {
    boton.focus({ preventScroll: true });
    boton.scrollIntoView({ block: "nearest" });
  };

  /**
   * Atajos de la mitad izquierda: catálogo y búsqueda. Los del ticket viven en
   * CartPanelAdmin, con sus propios handlers — repartidos por dueño y no en un
   * archivo de atajos aparte, que sería el archivo que se olvida de actualizar
   * cuando la acción cambia.
   *
   * Alt+1…9 entra por `handleProductClick`, el mismo camino que tocar la card:
   * variante única va derecho al ticket y con talles se abre el selector. Un
   * atajo que agregue "la primera variante" elegiría el talle por su cuenta.
   */
  useAtajosTeclado([
    {
      teclas: "F8",
      correr: () => setVista((v) => (v === "cargar" ? "vender" : "cargar")),
    },
    {
      // Confirmar la carga. Ctrl+Space y NO Ctrl+Enter: el ticket ya usa
      // Ctrl+Enter (AtajosCarrito), CartPanelAdmin se monta afuera de este
      // componente y sigue escuchando mientras se carga mercadería. Los dos
      // listeners son hermanos en window, así que la misma combinación
      // dispararía las dos cosas: confirmaría la carga Y llevaría la venta al
      // pago. Con modificador funciona además con el foco dentro de una
      // celda, que es justo desde donde se confirma.
      teclas: "ctrl+Space",
      activo:
        vista === "cargar" && carga.lineas.length > 0 && !carga.isConfirming,
      correr: carga.confirmar,
    },
    {
      // El campo que enfoca F es el que está en pantalla: en Cargar, el
      // buscador de la barra ES el campo de escaneo de la Carga rápida (misma
      // barra, otro ref), así que apuntar siempre a `buscadorRef` dejaba el
      // atajo sin efecto justo en la vista donde más se escanea.
      teclas: "f",
      correr: () =>
        vista === "cargar"
          ? carga.enfocarBuscador()
          : buscadorRef.current?.focus(),
    },
    // Las flechas mueven el FOCO real del DOM, no una selección propia. Con
    // foco de verdad, Enter agrega el producto sin una sola línea de código
    // extra (es un <button>), el navegador lo scrollea a la vista y el anillo
    // de foco ya dice cuál está marcado. Una selección paralela habría
    // necesitado las tres cosas escritas a mano, y desincronizada del foco
    // cada vez que alguien toca con el dedo.
    //
    // Izquierda y derecha NO se registran en la vista de lista: ahí hay una
    // sola columna, así que moverían igual que arriba y abajo y le sacarían
    // las teclas al cursor de cualquier campo.
    {
      teclas: "ArrowDown",
      activo: vista === "vender",
      correr: () => moverFoco(columnasDeLaGrilla()),
    },
    {
      teclas: "ArrowUp",
      activo: vista === "vender",
      correr: () => moverFoco(-columnasDeLaGrilla()),
    },
    {
      teclas: "ArrowRight",
      activo: vista === "vender" && !vistaSinImagenes,
      correr: () => moverFoco(1),
    },
    {
      teclas: "ArrowLeft",
      activo: vista === "vender" && !vistaSinImagenes,
      correr: () => moverFoco(-1),
    },
    {
      teclas: "Escape",
      activo: hayFiltrosActivos,
      correr: limpiarFiltros,
    },
    ...Array.from({ length: 9 }, (_, indice) => ({
      teclas: `alt+${indice + 1}`,
      activo: vista === "vender",
      correr: () => {
        const producto = productosOrdenados[indice];
        if (producto) handleProductClick(producto);
      },
    })),
  ]);

  // Sobre la lista COMPLETA, no sobre `productosVisibles`: "hay menos de 6
  // resultados" es una afirmación sobre lo que existe, no sobre lo que entró
  // en la primera tanda. Con la visible, un catálogo grande diría siempre 24 y
  // la oferta de cargar no aparecería nunca. Mismo motivo para el
  // `length === 0` de más abajo, que decide si mostrar "No se encontraron
  // productos".
  const ofrecerCarga =
    vista === "vender" &&
    searchQuery.trim().length > 0 &&
    productosOrdenados.length < RESULTADOS_PARA_OFRECER_CARGA;

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* LADO IZQUIERDO: CATÁLOGO POS */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Toolbar POS */}
        <StockFiltersToolbar
          rubro={rubro}
          view="grid"
          onViewChange={() => undefined}
          showViewToggle={false}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          categoriaActiva={tipo}
          onCategoriaChange={setTipo}
          categoriasDisponibles={categoriasDisponibles}
          // Mientras el catálogo no llegó, `productos.length` es 0 y el
          // toolbar mostraría "0 productos", que es un dato equivocado, no uno
          // que falta. `undefined` lo deja sin contador hasta que haya algo
          // que contar.
          totalProductos={cargandoCatalogo ? undefined : productos.length}
          resultadosFueraDeCategoria={matchesFueraDeCategoria}
          hayFiltrosActivos={hayFiltrosActivos}
          propiedadesGlobales={propiedadesGlobales}
          filtrosVariantes={filtrosVariantes}
          onFiltroVarianteChange={handleFiltroVarianteChange}
          isAdmin={false}
          onLimpiarFiltros={limpiarFiltros}
          onCargaRapida={() =>
            setVista((v) => (v === "cargar" ? "vender" : "cargar"))
          }
          cargaRapidaActiva={vista === "cargar"}
          onCobrarCuentaCorriente={
            puedeCobrarCuentaCorriente ? () => abrirCobroCc() : undefined
          }
          searchPlaceholder={
            vista === "cargar"
              ? "Escaneá o escribí y Enter…"
              : "Buscar producto..."
          }
          onSearchEnter={vista === "cargar" ? carga.procesarEnter : undefined}
          // Bajar desde el buscador entra al catálogo por el primer
          // producto; desde ahí, subir en el primero devuelve el foco acá.
          // Solo ArrowDown: arriba, en el campo, no hay a dónde ir, e
          // izquierda y derecha se quedan donde tienen que estar (en el
          // cursor de lo que se está escribiendo).
          onSearchKeyDown={(evento) => {
            if (vista === "cargar" || evento.key !== "ArrowDown") return;
            evento.preventDefault();
            moverFoco(1);
          }}
          // En Cargar el ref es de la Carga rápida (necesita devolverle el
          // foco al input después de cada línea); en Vender es el nuestro, que
          // usa la tecla "F".
          searchInputRef={vista === "cargar" ? carga.inputRef : buscadorRef}
          atajoBusqueda={vista === "cargar" ? undefined : "F"}
          searchDisabled={
            vista === "cargar" &&
            (carga.modalAbierto || carga.buscandoEnMaestro)
          }
          filaSecundaria={
            vista === "cargar" ? (
              <>
                <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                  {carga.buscandoEnMaestro
                    ? "Buscando en el Catálogo Maestro…"
                    : "Enter agrega a la lista. Al confirmar volvés a la venta con lo cargado."}
                </p>
                <CargaRapidaRecargo carga={carga} />
              </>
            ) : undefined
          }
        />

        {/* Área de productos: es lo único que cambia entre Vender y Cargar. */}
        <div
          ref={contenedorProductosRef}
          onScroll={handleScrollProductos}
          className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] p-2 min-h-0"
        >
          {vista === "cargar" ? (
            <div className="pb-20 lg:pb-0">
              <CargaRapidaPanel carga={carga} />
            </div>
          ) : cargandoCatalogo ? (
            <GrillaSkeleton busqueda={searchQuery} />
          ) : productosOrdenados.length === 0 && !ofrecerCarga ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <ShoppingBag className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg">No se encontraron productos</p>
              <p className="text-sm mt-1">
                Intenta con otra búsqueda o categoría.
              </p>
            </div>
          ) : vistaSinImagenes ? (
            // Lista densa. Ver `posSinImagenes` para qué rubros la usan y por
            // qué es del rubro y no un toggle.
            <>
              <PosProductList
                productos={productosVisibles}
                stockTotalDe={getStockTotal}
                cantidadEnCarritoDe={(producto) =>
                  cantidadEnCarrito.get(producto.id) ?? 0
                }
                permitirVentaSinStock={permitirVentaSinStock}
                mostrarSinStock={mostrarSinStock}
                slugNegocio={slugNegocio}
                nombreComercio={nombreComercio}
                onProductoClick={handleProductClick}
              />

              {ofrecerCarga && (
                <button
                  type="button"
                  onClick={cargarLoBuscado}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-3 transition-colors hover:border-primary hover:bg-primary/5 cursor-pointer"
                >
                  <PackagePlus className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    Cargar &quot;{searchQuery.trim()}&quot;
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    y seguí cobrando
                  </span>
                </button>
              )}
            </>
          ) : (
            <div
              ref={grillaRef}
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-20 lg:pb-0"
            >
              {productosVisibles.map((producto, index) => {
                const primeraImagen = resolverImagenPrincipal(producto);

                const stockTotal = getStockTotal(producto);
                const sinStock = stockTotal <= 0;
                const bloqueado = sinStock && !permitirVentaSinStock;
                const resumen = resumirStock(producto);
                const enCarrito = cantidadEnCarrito.get(producto.id) ?? 0;

                const urlProducto = producto.slug
                  ? construirUrlProducto(slugNegocio, producto.slug)
                  : null;
                const compartirDeshabilitado =
                  !urlProducto ||
                  !esVisibleEnCatalogo(
                    { publicado: producto.publicado, stockTotal },
                    { mostrarSinStock },
                  );
                const motivoCompartirDeshabilitado = !urlProducto
                  ? "Este producto no tiene link público"
                  : "Este producto no está visible en el catálogo";

                return (
                  // El ícono de compartir vive como hermano del <button> de
                  // agregar-al-carrito (no anidado — un <button> dentro de
                  // otro <button> es HTML inválido) para no competir con el
                  // tap principal de la card.
                  <div key={producto.id} className="relative h-full group">
                    <button
                      onClick={() => handleProductClick(producto)}
                      disabled={bloqueado}
                      data-producto-foco=""
                      // El anillo marca lo que YA está en el ticket. Va
                      // como `ring` y no como borde para no correr un
                      // pixel el contenido de la card al prenderse: con la
                      // grilla llena, ese salto se nota más que la marca.
                      className={`flex flex-col text-left rounded-lg bg-card transition-all overflow-hidden x w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                        enCarrito > 0 ? "ring-2 ring-primary/60" : ""
                      } ${
                        !bloqueado
                          ? "shadow-xs hover:shadow-sm hover:-translate-y-0.5 transition-all duration-150"
                          : "shadow-xs opacity-50"
                      }`}
                    >
                      <div className="w-full aspect-4/3 bg-muted relative border-b border-border/40">
                        {primeraImagen ? (
                          <Image
                            src={primeraImagen}
                            alt={producto.nombre || ""}
                            fill
                            className="object-cover"
                            sizes="200px"
                            priority={index < 8}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ShoppingBag className="w-8 h-8 text-muted-foreground/30" />
                          </div>
                        )}
                        {/* Cuántas unidades de este producto ya se
                            cargaron. Arriba a la IZQUIERDA: a la derecha
                            vive el botón de compartir, que aparece al
                            pasar el mouse y taparía el número justo
                            cuando la vendedora va a tocar la card.

                            El número, y no solo el color: en una grilla
                            con varias cards marcadas, "¿cuántas de esta
                            llevo?" es la pregunta que sigue. */}
                        {enCarrito > 0 && (
                          <span className="absolute top-2 left-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground shadow-sm">
                            {formatearNumeroCantidad(
                              enCarrito,
                              producto.unidad_medida,
                            )}
                          </span>
                        )}

                        {sinStock && (
                          <div className="absolute inset-0 bg-background/55 backdrop-blur-[1px]">
                            <span className="px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest bg-danger/10 text-danger border border-danger/20">
                              Agotado
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="px-3 pt-2 pb-3 flex flex-col flex-1 justify-between">
                        <p className="font-medium text-xs sm:text-sm text-foreground leading-tight line-clamp-2 mb-2">
                          {producto.nombre}
                        </p>
                        <p className="font-mono font-semibold tracking-tight text-sm sm:text-base text-muted-foreground">
                          {formatearMoneda(producto.precio)}
                          <span className="text-[10px] font-normal">
                            {sufijoPrecioPorUnidad(producto.unidad_medida)}
                          </span>
                        </p>

                        {/* Cuánto queda. Información SECUNDARIA: va abajo
                            del precio, más chica y apagada, porque la card
                            se lee por nombre y precio. Con variantes se
                            nombran las que tienen stock — el total solo
                            diría "quedan 6" sin decir de qué talle, que es
                            justo lo que hay que saber para ofrecerlo. */}
                        {!sinStock && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground/70">
                            <span className="font-mono tabular-nums">
                              {formatearCantidad(
                                stockTotal,
                                producto.unidad_medida,
                              )}
                            </span>

                            {resumen.tieneVariantes &&
                              resumen.variantes.map((v) => (
                                // "14 ×1" y no "14 1": dos números pegados
                                // no dicen cuál es el talle y cuál la
                                // cantidad. El × lo dice sin rotular
                                // "Talles:", que sería mentira cuando el
                                // primer atributo es color o estampado.
                                <span
                                  key={v.etiqueta}
                                  className="rounded bg-muted px-1 py-px font-mono tabular-nums"
                                >
                                  {v.etiqueta}
                                  <span className="opacity-60">×</span>
                                  {v.stock}
                                </span>
                              ))}

                            {resumen.restantes > 0 && (
                              <span>+{resumen.restantes}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>

                    <ShareButton
                      url={urlProducto ?? ""}
                      disabled={compartirDeshabilitado}
                      disabledReason={motivoCompartirDeshabilitado}
                      variant="secondary"
                      size="icon-xs"
                      className="absolute top-2 right-2 bg-background/90 backdrop-blur-sm shadow-sm hover:bg-background opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    />
                  </div>
                );
              })}

              {/* Card de carga: aparece con la búsqueda todavía dando
                  resultados, para no tener que llegar a cero antes de poder
                  cargar lo que no está. Punteada y sin foto — se lee como
                  acción, no como un producto más. */}
              {ofrecerCarga && (
                <button
                  type="button"
                  onClick={cargarLoBuscado}
                  className="flex flex-col items-center justify-center text-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors h-full min-h-44 p-3 cursor-pointer"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <PackagePlus className="w-5 h-5 text-primary" />
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-foreground line-clamp-2">
                    Cargar &quot;{searchQuery.trim()}&quot;
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight">
                    Lo creás y seguís cobrando
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <QuickAddModal
        producto={selectedProduct}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        permitirVentaSinStock={permitirVentaSinStock}
      />
    </div>
  );
}

/**
 * La grilla mientras el catálogo viene en camino.
 *
 * Skeleton y no spinner: un spinner no dice cuánto ni de qué, y sobre todo no
 * reserva el espacio. Estas tarjetas usan la MISMA grilla y la misma altura
 * que las reales (`grid-cols-2 md:3 lg:4`, `aspect-square` + pie de texto), así
 * que cuando llegan los productos ocupan el lugar que ya estaba dibujado y no
 * hay salto de layout.
 *
 * Son 8 y no 40: alcanzan para llenar la primera pantalla en mobile y en
 * desktop, y dibujar más sería pagar render por algo que se va a reemplazar.
 *
 * Lo de `busqueda` es lo que evita el peor caso de la carga diferida. El
 * buscador ahora existe desde el primer pintado, así que la vendedora puede
 * tipear —o el lector puede escanear— antes de que llegue el catálogo. Esas
 * teclas NO se pierden: `searchQuery` es estado y el filtro se re-corre solo
 * cuando llegan los datos. Pero sin decir nada, la pantalla se ve igual que
 * una búsqueda sin resultados. La línea de abajo es la diferencia entre "no
 * existe" y "todavía no sé".
 */
function GrillaSkeleton({ busqueda }: Readonly<{ busqueda: string }>) {
  return (
    <div className="pb-20 lg:pb-0">
      {busqueda.trim() !== "" && (
        <p
          className="px-1 pb-3 text-sm text-muted-foreground"
          aria-live="polite"
        >
          Buscando &quot;{busqueda.trim()}&quot;… el catálogo está terminando de
          cargar.
        </p>
      )}

      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
        aria-hidden="true"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border overflow-hidden"
          >
            <div className="aspect-square w-full animate-pulse bg-muted" />
            <div className="p-2 space-y-2">
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
