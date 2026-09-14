"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSlugNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useDragScroll } from "@/shared/hooks/use-drag-scroll";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ClipboardList,
  Filter,
  FilterX,
  HandCoins,
  LayoutGrid,
  List,
  MoreHorizontal,
  PackagePlus,
  Plus,
  ScanBarcode,
  Search,
  Lock,
} from "lucide-react";
import { useLimiteLleno } from "@/features/planes/lib/use-limite-lleno";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
/**
 * Los modales pesados se cargan cuando se abren, no cuando se monta la barra.
 *
 * Esta toolbar la usa /stock pero TAMBIÉN la terminal de venta (/pos la
 * importa a través de PosTerminal), así que su bundle lo pagaba cada vendedora
 * en cada carga del POS. Lo que arrastraba:
 *
 *   ImportarPedidoModal ....... xlsx (311 kB, 108 kB gzip)
 *   IngresarMercaderiaModal ... xlsx, por leerPlanillaProductos
 *   CrearProductoSheet ........ el compresor de imágenes del navegador
 *
 * Nada de eso se usa vendiendo. `ssr: false` porque son modales de navegador
 * puros: no aportan nada al HTML del server.
 *
 * OJO: `dynamic()` sola no alcanzaba. Los tres se montaban SIEMPRE (con
 * `isAdmin`) y solo se abrían por prop `open`, así que el chunk se pedía igual
 * al montar la barra. Por eso abajo además se renderizan recién cuando su
 * estado de apertura es true.
 */
const ImportarPedidoModal = dynamic(
  () =>
    import("@/features/purchases/ui/create-purchase-modal").then(
      (m) => m.ImportarPedidoModal,
    ),
  { ssr: false },
);
import type { Rubro } from "@/entities/config/types";
const CrearProductoSheet = dynamic(
  () =>
    import("@/features/stock/ui/create-sheet").then(
      (m) => m.CrearProductoSheet,
    ),
  { ssr: false },
);

const IngresarMercaderiaModal = dynamic(
  () =>
    import("./ingresar-mercaderia-modal").then(
      (m) => m.IngresarMercaderiaModal,
    ),
  { ssr: false },
);

// Este vive adentro del DropdownMenu, y Radix desmonta el contenido cerrado,
// así que no hace falta gatearlo a mano: no se renderiza hasta que se abre el
// menú.
const UpdatePricesModal = dynamic(
  () => import("./update-prices-modal").then((m) => m.UpdatePricesModal),
  { ssr: false },
);
import { PriceHistoryModal } from "./price-history-modal";
import { ShareButton } from "@/shared/components/share-button";
import { construirUrlCategoria } from "@/shared/utils/compartir-catalogo";

export type CategoriaToolbarHijo = {
  nombre: string;
  value: string;
  count: number;
};

export type CategoriaToolbar = CategoriaToolbarHijo & {
  /** Presente y no-vacío = esta categoría es un "padre" — al seleccionarla
   * o seleccionar uno de sus hijos, la barra pasa a modo nivel 2. */
  hijos?: CategoriaToolbarHijo[];
};

interface StockFiltersToolbarProps {
  /** Decide POR CUÁL de los dos flujos entra la mercadería (ver
   * metodoIngresoStock): remito en indumentaria, planilla en electro. */
  rubro: Rubro;
  view: "table" | "grid";
  onViewChange: (view: "table" | "grid") => void;
  showViewToggle?: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  categoriaActiva: string;
  onCategoriaChange: (categoria: string) => void;
  categoriasDisponibles: CategoriaToolbar[];
  /** `undefined` mientras el catálogo se está cargando: el chip "Todas" sale
   * sin número en vez de decir "(0)", que sería un dato equivocado y no uno
   * que falta. Lo usa el POS, que ahora monta la barra antes que el catálogo. */
  totalProductos?: number;
  hayFiltrosActivos: boolean;
  propiedadesGlobales: Record<string, string[]>;
  filtrosVariantes: Record<string, string | string[]>;
  onFiltroVarianteChange: (propiedad: string, valor: string) => void;
  isAdmin: boolean;
  onLimpiarFiltros: () => void;
  slugCategoriaActiva?: string | null;
  nombreCategoriaActiva?: string;
  nombreComercio?: string;
  /** Búsqueda transversal: cuántos resultados matchean búsqueda/variante
   * FUERA de la categoría activa — "ver N más en todo el stock/catálogo". */
  resultadosFueraDeCategoria?: number;
  /** Si viene, "Carga rápida" deja de navegar a /stock/carga-rapida y llama
   * a esto — el POS la abre como cambio de vista, sin salir de la venta. */
  onCargaRapida?: () => void;
  /** Marca visualmente el botón cuando esa vista está activa. */
  cargaRapidaActiva?: boolean;
  /** Si viene, la barra ofrece "Cobrar deuda" al lado de Carga rápida. Solo lo
   * manda el POS: es donde está parada la vendedora cuando la clienta viene a
   * pagar la cuenta. En Inventario no tiene sentido. */
  onCobrarCuentaCorriente?: () => void;
  searchPlaceholder?: string;
  /** Enter en el buscador. En Vender no hace nada (el filtrado es en vivo);
   * en Cargar es lo que agrega la línea a la lista. */
  onSearchEnter?: (value: string) => void;
  /** Teclas del buscador que la pantalla quiera manejar además de Enter. El
   * POS lo usa para que la flecha abajo salte del campo al catálogo: ese
   * caso no puede ir por `useAtajosTeclado`, que ignora las teclas sueltas
   * mientras se escribe —y hace bien, porque el lector de códigos de barras
   * escribe acá— así que la excepción va acotada a ESTE input en vez de
   * levantar la regla para toda la pantalla. */
  onSearchKeyDown?: (evento: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Tecla que le da el foco al buscador, para mostrarla como badge adentro
   * del campo. Solo la manda la pantalla que REGISTRA el atajo (hoy el POS):
   * un badge en Inventario, donde la tecla no hace nada, sería una promesa
   * que el teclado no cumple. */
  atajoBusqueda?: string;
  searchDisabled?: boolean;
  /** Reemplaza la fila de pills de categoría. Lo usa el POS en la vista de
   * Carga rápida, donde filtrar por categoría no significa nada. */
  filaSecundaria?: React.ReactNode;
  /** Productos cargados en el negocio, para el tope del plan. NO es
   * `totalProductos`, que es lo que quedó después de los filtros y de la
   * paginación: filtrar por categoría no le devuelve cupo a nadie. */
  productosDelNegocio?: number;
}

export function StockFiltersToolbar({
  rubro,
  view,
  onViewChange,
  showViewToggle = true,
  searchQuery,
  onSearchChange,
  categoriaActiva,
  onCategoriaChange,
  categoriasDisponibles,
  totalProductos,
  hayFiltrosActivos,
  propiedadesGlobales,
  filtrosVariantes,
  onFiltroVarianteChange,
  isAdmin,
  onLimpiarFiltros,
  slugCategoriaActiva,
  nombreCategoriaActiva,
  nombreComercio = "Tienda",
  resultadosFueraDeCategoria = 0,
  onCargaRapida,
  cargaRapidaActiva = false,
  onCobrarCuentaCorriente,
  searchPlaceholder = "Buscar producto...",
  onSearchEnter,
  onSearchKeyDown,
  searchInputRef,
  atajoBusqueda,
  searchDisabled = false,
  filaSecundaria,
  productosDelNegocio,
}: Readonly<StockFiltersToolbarProps>) {
  // Tope de productos del plan. Apaga TODAS las puertas de alta —manual,
  // carga rápida, remito y planilla— y no solo el botón principal: el límite
  // es del catálogo, no de un camino en particular. Lo ya cargado se sigue
  // vendiendo y editando; la base lo frena igual (trg_limite_productos), esto
  // evita que el freno llegue después de abrir el formulario.
  const { lleno: catalogoLleno, avisar: avisarCatalogoLleno } = useLimiteLleno(
    "max_productos",
    productosDelNegocio,
    "productos",
  );

  const abrirAltaProducto = () => {
    if (catalogoLleno) {
      avisarCatalogoLleno();
      return;
    }
    setIsCrearProductoOpen(true);
  };
  // El link del catálogo necesita el negocio, no solo el origen: cada
  // comercio tiene su propia tienda.
  const slugNegocio = useSlugNegocioActivo() ?? "";
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  // El sheet de carga manual se monta UNA vez y se abre desde dos botones
  // distintos según breakpoint (barra en desktop, dropdown en mobile).
  const [isCrearProductoOpen, setIsCrearProductoOpen] = useState(false);
  // UN solo punto de entrada para la mercadería, para todos los rubros. Lo que
  // cambia por rubro es la plantilla que se descarga, no el camino: los dos
  // orígenes —proveedor y planilla propia— terminan en la conciliación.
  const [isIngresoOpen, setIsIngresoOpen] = useState(false);
  // La fila de categorías se puede arrastrar con el mouse, como ya se
  // arrastra con el dedo. Se declara acá arriba y no adentro de la rama que
  // la dibuja porque esa rama es condicional (filaSecundaria) y un hook no
  // puede montarse a veces sí y a veces no.
  const { ref: filaCategoriasRef, dragProps: dragCategorias } =
    useDragScroll<HTMLDivElement>();
  const propiedadesVariantes = Object.entries(propiedadesGlobales);
  const hayFiltrosVariantesActivos = Object.values(filtrosVariantes).some(
    (valor) => (Array.isArray(valor) ? valor.length > 0 : valor !== "todos"),
  );

  const limpiarFiltrosVariantes = () => {
    propiedadesVariantes.forEach(([propiedad]) => {
      onFiltroVarianteChange(propiedad, "todos");
    });
    onLimpiarFiltros();
  };

  return (
    <>
      {/* 1. BARRA SUPERIOR: Buscador y Acciones */}
      <div className="flex flex-row gap-2 px-2 py-1.5 border-b border-border">
        {/* Los dos caminos de ingreso se montan SIEMPRE, sin importar el
            rubro: el modal unificado ofrece los dos y el rubro solo decide qué
            plantilla se baja. Antes se montaba uno solo —remito para
            indumentaria, planilla para electro— como si una tienda de ropa no
            pudiera tener una planilla propia. */}
        {/* Se montan recién cuando se abren. Los tres ya venían con `open`
            controlado desde afuera y trigger propio (`hideTrigger`), así que
            el único cambio es que el código llega en ese momento en vez de en
            cada carga de la barra — y de la terminal de venta, que la
            comparte. */}
        {isAdmin && isImportModalOpen && (
          <ImportarPedidoModal
            open
            onOpenChange={setIsImportModalOpen}
            hideTrigger
          />
        )}

        {isAdmin && isCrearProductoOpen && (
          <CrearProductoSheet
            open
            onOpenChange={setIsCrearProductoOpen}
            hideTrigger
            rubro={rubro}
          />
        )}

        {isAdmin && isIngresoOpen && (
          <IngresarMercaderiaModal
            open
            onOpenChange={setIsIngresoOpen}
            rubro={rubro}
            onAbrirRemitoProveedor={() => setIsImportModalOpen(true)}
          />
        )}

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder={searchPlaceholder}
              disabled={searchDisabled}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                onSearchKeyDown?.(e);
                if (e.defaultPrevented) return;
                if (e.key !== "Enter" || !onSearchEnter) return;
                e.preventDefault();
                onSearchEnter(searchQuery);
              }}
              className={`pl-9 h-10 text-sm rounded-lg border-border bg-muted w-full ${atajoBusqueda ? "pr-12" : ""}`}
            />
            {/* Se esconde con texto escrito: el badge no puede taparle a la
                vendedora lo que está buscando. */}
            {atajoBusqueda && !searchQuery && (
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {atajoBusqueda}
              </kbd>
            )}
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="relative h-10 w-10 p-0 shrink-0 border-border/60 bg-background"
                aria-label="Abrir filtros de variantes"
              >
                <Filter className="h-4 w-4" />
                {hayFiltrosVariantesActivos && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />
                )}
              </Button>
            </SheetTrigger>

            <SheetContent side="right" className="w-full sm:max-w-sm p-0 gap-0">
              <SheetHeader className="p-5 border-b border-border text-left">
                <SheetTitle>Filtros de Variantes</SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {propiedadesVariantes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay variantes disponibles para filtrar.
                  </p>
                ) : (
                  propiedadesVariantes.map(([propName, valores]) => (
                    <div key={propName} className="space-y-3">
                      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        {propName}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {["todos", ...valores].map((valor) => {
                          const seleccion = filtrosVariantes[propName];
                          const isActive = Array.isArray(seleccion)
                            ? valor === "todos"
                              ? seleccion.length === 0
                              : seleccion.includes(valor)
                            : (seleccion || "todos") === valor;
                          const label =
                            valor === "todos" ? "Cualquiera" : valor;

                          return (
                            <button
                              key={valor}
                              type="button"
                              onClick={() =>
                                onFiltroVarianteChange(propName, valor)
                              }
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                isActive
                                  ? "border-primary bg-primary text-white ring-2 ring-primary/30"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                              }`}
                            >
                              {isActive && valor !== "todos" && (
                                <Check className="inline w-3 h-3 mr-1 -mt-0.5" />
                              )}
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <SheetFooter className="border-t border-border bg-card p-4">
                <Button
                  variant="outline"
                  onClick={limpiarFiltrosVariantes}
                  className="w-full"
                >
                  Limpiar Filtros
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        {/* Controles y Botonera Admin (No se encoge nunca en mobile) */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Carga rápida — visible para todos los roles, no solo Admin. En
              mobile no vive acá sino dentro del dropdown de acciones: al lado
              del buscador no entraba sin comerle ancho. */}
          {/* Mismo botón de siempre; lo que cambia es el destino. Con
              onCargaRapida (POS) alterna la vista sin salir de la venta; sin
              él (Inventario) sigue navegando a su página. */}
          {onCargaRapida ? (
            <Button
              variant={cargaRapidaActiva ? "default" : "outline"}
              size="sm"
              onClick={onCargaRapida}
              className={`hidden sm:flex h-10 w-10 sm:w-auto p-0 sm:px-3 shrink-0 ${
                cargaRapidaActiva ? "" : "border-border/60 bg-background"
              }`}
              title="Cargar mercadería sin salir de la venta"
            >
              <ScanBarcode
                className={`h-4 w-4 sm:mr-2 ${cargaRapidaActiva ? "" : "text-muted-foreground"}`}
              />
              <span className="hidden sm:inline font-semibold">
                {cargaRapidaActiva ? "Volver a vender" : "Carga rápida"}
              </span>
            </Button>
          ) : (
            <Link href="/stock/carga-rapida" className="hidden sm:block">
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 sm:w-auto p-0 sm:px-3 shrink-0 border-border/60 bg-background"
                title="Carga rápida de mercadería"
              >
                <ScanBarcode className="h-4 w-4 sm:mr-2 text-muted-foreground" />
                <span className="hidden sm:inline font-semibold">
                  Carga rápida
                </span>
              </Button>
            </Link>
          )}

          {/* Cobrar deuda. Al lado de Carga rápida porque son las dos cosas
              que la vendedora hace SIN vender, sin salir de la venta. No es
              vista sino modal: un cobro son tres datos y termina. */}
          {onCobrarCuentaCorriente && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCobrarCuentaCorriente}
              className="hidden sm:flex h-10 w-10 sm:w-auto p-0 sm:px-3 shrink-0 border-border/60 bg-background"
              title="Cobrar un saldo de cuenta corriente"
            >
              <HandCoins className="h-4 w-4 sm:mr-2 text-muted-foreground" />
              <span className="hidden sm:inline font-semibold">
                Cobrar deuda
              </span>
            </Button>
          )}

          {/* Toggle View (Oculto en celular para ahorrar valioso espacio) */}
          {showViewToggle && (
            <div className="hidden sm:flex items-center bg-muted border border-border/80 p-0.5 rounded-lg shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewChange("table")}
                className={`h-8 px-2.5 rounded-md ${view === "table" ? "bg-background font-bold" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista de lista"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewChange("grid")}
                className={`h-8 px-2.5 rounded-md ${view === "grid" ? "bg-background font-bold" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista de grilla (agrupada)"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Botonera de Acciones. El dropdown NO está gateado por isAdmin
              porque en mobile es el único acceso a Carga rápida, que es para
              todos los roles; para un vendedor el menú tiene solo esa entrada
              y por eso se oculta en desktop (ahí ya tiene su botón propio). */}
          <div className="flex items-center gap-1.5 sm:gap-2 sm:ml-2 sm:pl-4 sm:border-l sm:border-border shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-10 w-10 sm:w-auto bg-background border-border/60 hover:bg-muted text-foreground p-0 sm:px-3 cursor-pointer shrink-0 ${
                    isAdmin ? "" : "sm:hidden"
                  }`}
                >
                  <MoreHorizontal className="h-4 w-4 sm:mr-2 text-muted-foreground" />
                  <span className="hidden sm:inline font-semibold">
                    Acciones
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 p-1.5 rounded-xl border-border/60 shadow-lg bg-card z-50"
              >
                <div className="flex flex-col gap-0.5 [&_button]:w-full [&_button]:justify-start [&_button]:h-9 [&_button]:px-2 [&_button]:bg-transparent [&_button]:border-0 [&_button]:shadow-none [&_button]:font-medium [&_button]:text-sm [&_button:hover]:bg-muted [&_button]:rounded-md [&_button_span.hidden]:!inline-block [&_button_svg]:mr-2 [&_button_svg]:w-4 [&_button_svg]:h-4 [&_button_svg]:shrink-0">
                  {/* Las dos cargas solo aparecen acá en mobile: en desktop
                      siguen siendo botones sueltos de la barra. */}
                  {onCargaRapida ? (
                    <button
                      type="button"
                      onClick={onCargaRapida}
                      className="w-full flex sm:hidden items-center justify-start h-9 px-2 text-sm font-medium cursor-pointer text-foreground hover:bg-muted rounded-md transition-colors"
                    >
                      <ScanBarcode className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
                      {cargaRapidaActiva ? "Volver a vender" : "Carga rápida"}
                    </button>
                  ) : (
                    <Link
                      href="/stock/carga-rapida"
                      className="w-full block sm:hidden"
                    >
                      <button className="w-full flex items-center justify-start h-9 px-2 text-sm font-medium cursor-pointer text-foreground hover:bg-muted rounded-md transition-colors">
                        <ScanBarcode className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
                        Carga rápida
                      </button>
                    </Link>
                  )}

                  {/* En mobile el dropdown es el único acceso, igual que
                      Carga rápida: en la barra no entra sin comerse el
                      buscador. */}
                  {onCobrarCuentaCorriente && (
                    <button
                      type="button"
                      onClick={onCobrarCuentaCorriente}
                      className="w-full flex sm:hidden items-center justify-start h-9 px-2 text-sm font-medium cursor-pointer text-foreground hover:bg-muted rounded-md transition-colors"
                    >
                      <HandCoins className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
                      Cobrar deuda
                    </button>
                  )}

                  {isAdmin && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        className="sm:hidden"
                        onClick={abrirAltaProducto}
                      >
                        {catalogoLleno ? (
                          <Lock className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
                        ) : (
                          <Plus className="w-4 h-4 mr-2 text-primary shrink-0" />
                        )}
                        <span>Carga manual</span>
                      </Button>
                      <DropdownMenuSeparator className="my-1 bg-border/60 sm:hidden" />
                    </>
                  )}

                  {isAdmin && (
                    <>
                      <UpdatePricesModal />
                      <PriceHistoryModal />
                      {/* Un solo ítem para todos los rubros: adentro se elige
                          el origen del archivo. */}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          catalogoLleno
                            ? avisarCatalogoLleno()
                            : setIsIngresoOpen(true)
                        }
                      >
                        {catalogoLleno ? (
                          <Lock className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
                        ) : (
                          <PackagePlus className="w-4 h-4 mr-2 text-success shrink-0" />
                        )}
                        <span>Ingresar mercadería</span>
                      </Button>
                      <DropdownMenuSeparator className="my-1 bg-border/60" />
                      <Link href="/stock/bajas" className="w-full block">
                        <button className="w-full flex items-center justify-start h-9 px-2 text-sm font-medium text-foreground hover:bg-warning/10 rounded-md hover:text-warning/90 transition-colors">
                          <ClipboardList className="w-4 h-4 mr-2 text-warning shrink-0" />
                          Bajas de Inventario
                        </button>
                      </Link>
                      <Link href="/stock/movimientos" className="w-full block">
                        <button className="w-full flex items-center justify-start h-9 px-2 text-sm font-medium text-foreground hover:bg-muted rounded-md transition-colors">
                          <ArrowRightLeft className="w-4 h-4 mr-2 text-primary shrink-0" />
                          Movimientos Stock
                        </button>
                      </Link>
                    </>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Carga manual en desktop: mismo sheet, otro disparador. */}
            {isAdmin && (
              <Button
                type="button"
                variant="ghost"
                onClick={abrirAltaProducto}
                className="hidden sm:flex h-10 px-4 shrink-0"
              >
                {catalogoLleno ? (
                  <Lock className="h-4 w-4 sm:mr-2" />
                ) : (
                  <Plus className="h-4 w-4 sm:mr-2" />
                )}
                <span>Nuevo Producto</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 2. BARRA DE CATEGORÍAS DINÁMICAS Y LIMPIEZA — tolerante a árbol
      mixto: si ningún elemento de categoriasDisponibles trae `hijos`, esto
      degrada exactamente a la fila plana de siempre. */}
      {filaSecundaria !== undefined ? (
        <div className="flex w-full min-w-0 items-center gap-2 mt-4 md:mt-2 px-2 pb-2">
          {filaSecundaria}
        </div>
      ) : (
        (() => {
          const padreEnVista = categoriasDisponibles.find((c) => {
            if (!c.hijos || c.hijos.length === 0) return false;
            if (c.value === categoriaActiva) return true;
            return c.hijos.some((h) => h.value === categoriaActiva);
          });

          return (
            <div className="flex w-full min-w-0 items-start gap-2 overflow-hidden mt-4 md:mt-2 px-2">
              <div
                ref={filaCategoriasRef}
                {...dragCategorias}
                // `touch-pan-x` deja el pan táctil en manos del navegador (con
                // su inercia) y solo evita que el gesto horizontal se lo robe
                // el scroll vertical de la página.
                className="flex min-w-0 flex-1 gap-2 overflow-x-auto touch-pan-x pb-2 scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-1 sm:px-0"
              >
                {padreEnVista ? (
                  <>
                    {/* La pill de volver es STICKY, así que las subcategorías le
                      pasan por debajo: su fondo tiene que ser 100% opaco. El
                      `dark:` es obligatorio — la variante outline trae
                      `dark:bg-input/30` y twMerge NO lo pisa con un
                      `bg-background` sin modificador, así que en modo oscuro
                      quedaba al 30% y el texto se volvía ilegible al deslizar. */}
                    <Button
                      variant="outline"
                      className="rounded-full h-10 px-4 text-xs font-semibold shrink-0 shadow-none border-border/60 sticky left-0 z-10 bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => onCategoriaChange("todos")}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {padreEnVista.nombre}
                    </Button>

                    {padreEnVista.hijos!.map((hijo) => {
                      const isActive = categoriaActiva === hijo.value;
                      return (
                        <Button
                          key={hijo.value}
                          variant={isActive ? "default" : "outline"}
                          className={`rounded-full bg-primary h-10 px-4 text-xs font-semibold shrink-0 transition-colors shadow-none border-border/60 ${
                            isActive
                              ? "bg-foreground text-background border-transparent"
                              : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          onClick={() => onCategoriaChange(hijo.value)}
                        >
                          {hijo.nombre} ({hijo.count})
                        </Button>
                      );
                    })}

                    <Button
                      variant={
                        categoriaActiva === padreEnVista.value
                          ? "default"
                          : "outline"
                      }
                      className={`rounded-full bg-red-500 h-10 px-4 text-xs font-semibold shrink-0 transition-colors shadow-none border-border/60 ${
                        categoriaActiva === padreEnVista.value
                          ? "bg-foreground text-background border-transparent"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      onClick={() => onCategoriaChange(padreEnVista.value)}
                    >
                      Todo {padreEnVista.nombre}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant={
                        categoriaActiva === "todos" ? "default" : "outline"
                      }
                      className={`rounded-full bg-green-500 h-10 px-4 text-xs font-semibold shrink-0 shadow-none border-border/60 ${
                        categoriaActiva === "todos"
                          ? "bg-foreground text-background border-transparent"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      onClick={() => onCategoriaChange("todos")}
                    >
                      {totalProductos === undefined
                        ? "Todas"
                        : `Todas (${totalProductos})`}
                    </Button>

                    {categoriasDisponibles.map((categoria) => {
                      const esPadre = (categoria.hijos?.length ?? 0) > 0;
                      const isActive =
                        categoriaActiva.toLowerCase() ===
                        categoria.value.toLowerCase();

                      return (
                        <Button
                          key={categoria.value}
                          variant="outline"
                          className={`rounded-full h-10 px-4 text-xs font-semibold bg-primary shrink-0 transition-colors shadow-none gap-1.5 ${
                            esPadre
                              ? "border-primary/30 bg-background text-foreground font-bold hover:bg-primary/10"
                              : isActive
                                ? "bg-foreground text-background border-transparent"
                                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground border-border/60"
                          }`}
                          onClick={() => onCategoriaChange(categoria.value)}
                        >
                          {/* {esPadre && <FolderOpen className="w-3.5 h-3.5 text-primary" />} */}
                          {categoria.nombre} ({categoria.count})
                        </Button>
                      );
                    })}
                  </>
                )}
              </div>

              {resultadosFueraDeCategoria > 0 &&
                categoriaActiva !== "todos" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCategoriaChange("todos")}
                    className="h-8 mt-0 text-xs font-semibold text-muted-foreground hover:text-foreground shrink-0 hidden sm:flex items-center"
                  >
                    Ver {resultadosFueraDeCategoria} más
                  </Button>
                )}

              {slugCategoriaActiva && (
                <ShareButton
                  url={construirUrlCategoria(slugNegocio, slugCategoriaActiva)}
                  label="Compartir esta categoría"
                  variant="outline"
                  size="sm"
                  className="h-8 mt-0 text-xs font-bold shrink-0 hidden sm:flex items-center bg-background"
                />
              )}

              {/* Botón de limpiar filtros si están activos */}
              {hayFiltrosActivos && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLimpiarFiltros}
                  className="h-8 mt-0 text-xs font-bold text-muted-foreground hover:text-foreground shrink-0 hidden sm:flex items-center"
                >
                  <FilterX className="w-3.5 h-3.5 mr-1.5" /> Limpiar
                </Button>
              )}
            </div>
          );
        })()
      )}
    </>
  );
}
