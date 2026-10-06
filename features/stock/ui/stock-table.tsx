"use client";

import { Fragment, useState } from "react";
import { useSlugNegocioActivo } from "@/shared/components/negocio-activo-provider";
import Image from "next/image";
import { ProductoIndice } from "@/entities/productos/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Button } from "@/shared/ui/button";
import { formatearNumeroCantidad } from "@/shared/lib/unidad-venta";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import {
  Edit2,
  ImageIcon,
  MinusCircle,
  MoreVertical,
  Trash2,
  Merge,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Check,
  Star,
  SearchX,
} from "lucide-react";
import { ShareButton } from "@/shared/components/share-button";
import {
  construirUrlProducto,
  esVisibleEnCatalogo,
} from "@/shared/utils/compartir-catalogo";
import { ProductEditDetailSheet } from "./edit-sheet";
import { EliminarProductoModal } from "./delete-modal";
import { FusionarProductoModal } from "./fusionar-modal";
import { BajaModal } from "@/features/baja/ui/baja-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { COLOR_NIVEL_STOCK, nivelStock } from "../lib/inventario";
import { formatearMoneda } from "@/shared/utils/formatters";
import { useStockCartActions } from "../hooks/use-stock-cart-actions";
import {
  getTotalStock,
  getVariantesVisibles,
  obtenerPrimeraImagen as getPrimeraImagen,
} from "../lib/stock-product-utils";
import {
  resolverCategoriaDisplayPartes,
  type CategoriaBase,
} from "@/shared/utils/category-tree";
import { badgesIdentidad } from "../lib/identidad-por-rubro";
import { precioMostrable } from "../lib/precio-efectivo-producto";
import type { Rubro } from "@/entities/config/types";
import type { SeleccionProductos } from "../hooks/use-seleccion-productos";

interface StockTableProps {
  productos: ProductoIndice[];
  userRole: string;
  nombreComercio: string;
  mostrarSinStock: boolean;
  /** Ya viene ordenado por el padre (stock-view.tsx) — el sort corre sobre
   * todo el catálogo filtrado antes de paginar, no solo sobre esta página. */
  orden: string;
  onSort: (columna: string) => void;
  /** Categorías reales (con parent_id) para armar el label combinado
   * "Padre › Hijo" de cada producto — mismo fetch que ya usa stock-view.tsx
   * para los chips, no uno nuevo. Distinto de `categorias`
   * (useActiveCategories, más abajo) que solo trae raíces para el dropdown
   * de "mover a categoría". */
  categoriasArbol: CategoriaBase[];
  /** indumentaria -> badge "N var."; electro -> Modelo + EAN. */
  rubro: Rubro;
  /** La selección vive en stock-view (sobrevive a paginar y a cambiar de
   * vista). Acá solo se pinta y se togglea — las acciones masivas viven en
   * la barra de selección, no en la tabla. */
  seleccion: SeleccionProductos;
  /** Para la lista vacía: con filtros activos no es "no hay productos", es
   * "tu búsqueda no encontró nada", y tiene que ofrecer la salida. */
  hayFiltrosActivos?: boolean;
  busqueda?: string;
  onLimpiarFiltros?: () => void;
}

/** Lo que abrió el menú de una fila. Los modales viven AFUERA del menú: si
 * vivieran adentro, cerrar el menú al elegir el ítem los desmontaría. */
type AccionFila = {
  tipo: "baja" | "fusionar" | "eliminar";
  producto: ProductoIndice;
} | null;

const obtenerPrimeraImagen = (imagenUrl: unknown): string | null => {
  return getPrimeraImagen(imagenUrl);
};

/** En modo selección el tap sobre la fila selecciona/deselecciona, así que el
 * detalle NO debe abrirse: en vez de interceptar el click, directamente no se
 * monta el trigger del sheet (el click burbujea a la fila y listo). */
function AbrirDetalle({
  activo,
  producto,
  nombreComercio,
  mostrarSinStock,
  rubro,
  children,
}: Readonly<{
  activo: boolean;
  producto: ProductoIndice;
  nombreComercio: string;
  mostrarSinStock: boolean;
  rubro: Rubro;
  children: React.ReactNode;
}>) {
  if (!activo) return <>{children}</>;
  return (
    <ProductEditDetailSheet
      producto={producto}
      nombreComercio={nombreComercio}
      mostrarSinStock={mostrarSinStock}
      rubro={rubro}
    >
      {children}
    </ProductEditDetailSheet>
  );
}

type StockTableVariant = {
  id?: string;
  variante?: string;
  nombre_display?: string;
  stock?: number | string | null;
  cantidad?: number | string | null;
  precio?: number | string | null;
  costo?: number | string | null;
};

/** Costo/precio "efectivo" de una variante: el propio si está seteado, o el del producto si la variante lo hereda (precio/costo null). */
function precioEfectivoVariante(
  variante: StockTableVariant,
  campo: "precio" | "costo",
  fallback: number,
) {
  const valor = variante[campo];
  return valor === null || valor === undefined || valor === ""
    ? fallback
    : Number(valor);
}

export function StockTable({
  productos,
  userRole,
  nombreComercio,
  mostrarSinStock,
  orden,
  onSort,
  categoriasArbol,
  rubro,
  seleccion,
  hayFiltrosActivos = false,
  busqueda = "",
  onLimpiarFiltros,
}: Readonly<StockTableProps>) {
  const { isAdmin } = useStockCartActions(userRole);
  // El link del catálogo necesita el negocio, no solo el origen: cada
  // comercio tiene su propia tienda.
  const slugNegocio = useSlugNegocioActivo() ?? "";
  const [variantesAbiertas, setVariantesAbiertas] = useState<
    Record<string, boolean>
  >({});
  const [productoEnEdicion, setProductoEnEdicion] =
    useState<ProductoIndice | null>(null);
  const [accionFila, setAccionFila] = useState<AccionFila>(null);
  const cerrarAccion = (abierto: boolean) => {
    if (!abierto) setAccionFila(null);
  };

  const toggleVariantes = (id: string) => {
    setVariantesAbiertas((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // --- LÓGICA DE ORDENAMIENTO --- (el sort en sí corre en stock-view.tsx,
  // sobre todo el catálogo filtrado; acá solo se decide qué columna/sentido
  // pedir y cómo se ve el ícono)
  const handleSort = (columna: string) => {
    if (orden === `${columna}_asc`) {
      onSort(`${columna}_desc`);
    } else {
      onSort(`${columna}_asc`);
    }
  };

  const renderSortIcon = (columna: string) => {
    if (orden === `${columna}_asc`)
      return <ArrowUp className="w-3.5 h-3.5 shrink-0" />;
    if (orden === `${columna}_desc`)
      return <ArrowDown className="w-3.5 h-3.5 shrink-0" />;
    // Siempre visible (tenue): escondido detrás de un hover, en el celular
    // nadie sabía que las columnas se ordenan.
    return <ArrowUpDown className="w-3.5 h-3.5 shrink-0 opacity-40" />;
  };

  if (productos.length === 0) {
    const termino = busqueda.trim();
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
        <SearchX className="h-8 w-8 text-muted-foreground/40" />
        {hayFiltrosActivos ? (
          <>
            <p className="text-sm font-medium text-foreground">
              {termino
                ? `Sin resultados para «${termino}».`
                : "Ningún producto coincide con los filtros."}
            </p>
            {onLimpiarFiltros && (
              <Button variant="outline" onClick={onLimpiarFiltros}>
                Limpiar filtros
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Todavía no hay productos cargados.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 ">
      {productoEnEdicion && (
        <ProductEditDetailSheet
          producto={productoEnEdicion}
          nombreComercio={nombreComercio}
          mostrarSinStock={mostrarSinStock}
          open
          onOpenChange={(open) => {
            if (!open) setProductoEnEdicion(null);
          }}
          hideTrigger
        />
      )}

      {accionFila?.tipo === "baja" && (
        <BajaModal
          producto={accionFila.producto}
          open
          onOpenChange={cerrarAccion}
        />
      )}
      {accionFila?.tipo === "fusionar" && (
        <FusionarProductoModal
          id={accionFila.producto.id}
          nombre={accionFila.producto.nombre}
          open
          onOpenChange={cerrarAccion}
        />
      )}
      {accionFila?.tipo === "eliminar" && (
        <EliminarProductoModal
          id={accionFila.producto.id}
          nombre={accionFila.producto.nombre}
          tipo={accionFila.producto.tipo}
          open
          onOpenChange={cerrarAccion}
        />
      )}

      {/* --- CONTENEDOR DE LA TABLA --- */}
      <div className="overflow-hidden">
        <Table className="w-full sm:min-w-200 bg-card">
          <TableHeader>
            <TableRow className="bg-muted/30 border-b border-border/60 hover:bg-muted/30">
              {/* Columna Checkbox (oculta en mobile: ahí se selecciona con
                  long press sobre la fila) */}
              <TableHead className="w-12 pl-2 md:pl-4 pr-0 hidden sm:table-cell">
                <input
                  type="checkbox"
                  checked={seleccion.paginaCompleta}
                  onChange={seleccion.seleccionarPagina}
                  aria-label="Seleccionar todos los de esta página"
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary"
                />
              </TableHead>

              {/* 1. Unificamos Foto y Producto en una sola columna. Ancho fijo
                  en desktop: es la única columna elástica, así que sin esto se
                  come todo el sobrante y Categoría queda apretada. */}
              <TableHead className="text-muted-foreground pl-2 text-xs sm:text-sm sm:w-50 md:w-60">
                <button
                  onClick={() => handleSort("nombre")}
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors group font-semibold"
                >
                  Producto {renderSortIcon("nombre")}
                </button>
              </TableHead>
              <TableHead className="text-right hidden sm:table-cell text-muted-foreground w-24">
                <button
                  onClick={() => handleSort("categoria")}
                  className="flex items-center justify-start w-full gap-1.5 hover:text-foreground transition-colors group font-semibold"
                >
                  Categoría {renderSortIcon("categoria")}
                </button>
              </TableHead>
              {/* Stock Total (Oculto en móviles) */}
              <TableHead className="text-center hidden sm:table-cell text-muted-foreground w-16">
                <button
                  onClick={() => handleSort("stock")}
                  className="flex items-center justify-center w-full gap-1.5 hover:text-foreground transition-colors group font-semibold"
                >
                  Stock {renderSortIcon("stock")}
                </button>
              </TableHead>

              {/* Sin columna "Recargo": era 100% derivable de Costo y Precio.
                  El % vive ahora como badge al lado del Precio. */}
              {isAdmin && (
                <TableHead className="text-right hidden md:table-cell text-muted-foreground w-16">
                  <button
                    onClick={() => handleSort("costo")}
                    className="flex items-center justify-end w-full gap-1.5 hover:text-foreground transition-colors group font-semibold"
                  >
                    Costo {renderSortIcon("costo")}
                  </button>
                </TableHead>
              )}

              <TableHead className="text-right text-muted-foreground w-20 sm:w-20 text-xs sm:text-sm">
                <button
                  onClick={() => handleSort("precio")}
                  className="flex items-center justify-end w-full gap-1.5 hover:text-foreground transition-colors group font-semibold"
                >
                  Precio {renderSortIcon("precio")}
                </button>
              </TableHead>
              <TableHead className="text-right w-16 sm:w-24 pr-2 sm:pr-6 text-muted-foreground text-xs sm:text-sm hidden sm:table-cell">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {productos.map((producto, index) => {
              const primeraImagen =
                obtenerPrimeraImagen(producto.thumbnail_url) ??
                obtenerPrimeraImagen(producto.imagen_url);
              const totalUnidades = getTotalStock(producto);
              const categoriaPartes = resolverCategoriaDisplayPartes(
                categoriasArbol,
                producto.categoria_id,
              );
              const categoriaTitulo = categoriaPartes
                ? [categoriaPartes.padre, categoriaPartes.nombre]
                    .filter(Boolean)
                    .join(" › ")
                : undefined;
              const variantesVisibles = getVariantesVisibles(producto, isAdmin);

              const isSelected = seleccion.estaSeleccionado(producto.id);
              const hasVariantes = variantesVisibles.length > 1;
              const variantesEstanAbiertas = variantesAbiertas[producto.id];

              const urlProducto = producto.slug
                ? construirUrlProducto(slugNegocio, producto.slug)
                : null;
              const compartirDeshabilitado =
                !urlProducto ||
                !esVisibleEnCatalogo(
                  { publicado: producto.publicado, stockTotal: totalUnidades },
                  { mostrarSinStock },
                );
              const motivoCompartirDeshabilitado = !urlProducto
                ? "Este producto no tiene link público"
                : "Este producto no está visible en el catálogo";

              // Cálculos de Recargo (sobre costo, no sobre precio de venta)
              const costo = producto.precio_costo || 0;
              const precio = producto.precio || 0;

              // EL PRECIO QUE SE MUESTRA SALE DE LAS VARIANTES, no de la
              // cabecera. Antes se calculaba un rango solo cuando las
              // variantes NO eran uniformes y, cuando coincidían entre sí, se
              // caía a `producto.precio` — que es otro número. Uniforme no
              // quiere decir igual al producto: "Pantalon sastrero HHP" tenía
              // las 7 variantes en $20.000 y la cabecera en $52.000, y la
              // tabla mostraba $52.000. Ver `precio-efectivo-producto.ts`.
              const mostrableCosto = precioMostrable(
                costo,
                variantesVisibles.map((v: StockTableVariant) => v.costo),
              );
              const mostrablePrecio = precioMostrable(
                precio,
                variantesVisibles.map((v: StockTableVariant) => v.precio),
              );
              // El costo y el precio que de verdad tiene este producto: los que
              // usa el badge de recargo y el mensaje de compartir.
              const costoEfectivo = mostrableCosto.valor;
              const precioEfectivo = mostrablePrecio.valor;
              const gananciaEfectiva = precioEfectivo - costoEfectivo;
              const recargoEfectivo =
                costoEfectivo > 0
                  ? Math.round((gananciaEfectiva / costoEfectivo) * 100)
                  : 100;
              const preciosVarian =
                !mostrableCosto.uniforme || !mostrablePrecio.uniforme;

              // Mismo criterio para el producto y para sus variantes.
              const dotColor = COLOR_NIVEL_STOCK[nivelStock(totalUnidades)];
              const abreviaturaUnidad =
                ABREVIATURA_UNIDAD[normalizarUnidadMedida(producto.unidad_medida)];

              return (
                <Fragment key={producto.id}>
                  <TableRow
                    {...seleccion.propsSeleccionables(producto.id)}
                    className={`group transition-colors border-b border-border/40 select-none sm:select-auto [-webkit-touch-callout:none] ${
                      isSelected
                        ? "bg-primary/10 hover:bg-primary/15"
                        : variantesEstanAbiertas
                          ? "bg-muted"
                          : "hover:bg-muted/20"
                    }`}
                  >
                    {/* Checkbox (oculto en mobile: long press + tap) */}
                    <TableCell className="pl-2 md:pl-4 pr-0 hidden sm:table-cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={`Seleccionar ${producto.nombre}`}
                        // onClick y no onChange: el evento de change no trae
                        // shiftKey, y shift-click es lo que permite marcar un
                        // rango entero sin 40 clicks.
                        onClick={(e) => {
                          e.stopPropagation();
                          seleccion.toggle(producto.id, {
                            extenderRango: e.shiftKey,
                          });
                        }}
                        onChange={() => {}}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary"
                      />
                    </TableCell>

                    {/* 1. Celda Unificada: Flecha + Imagen + Producto (Más compacta en móviles) */}
                    <TableCell className="py-1.5 px-0 pl-1 sm:pl-2">
                      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                        <button
                          onClick={(e) => {
                            // Expandir variantes no debe contar como tap de
                            // selección sobre la fila.
                            e.stopPropagation();
                            if (hasVariantes) toggleVariantes(producto.id);
                          }}
                          aria-label={
                            variantesEstanAbiertas
                              ? "Ocultar variantes"
                              : "Ver variantes"
                          }
                          aria-expanded={
                            hasVariantes ? !!variantesEstanAbiertas : undefined
                          }
                          className={`flex size-(--control-h-sm) items-center justify-center rounded-lg hover:bg-muted transition-colors shrink-0 ${
                            !hasVariantes && "invisible"
                          }`}
                          disabled={!hasVariantes}
                        >
                          {variantesEstanAbiertas ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>

                        <AbrirDetalle
                          activo={!seleccion.modoSeleccion}
                          producto={producto}
                          rubro={rubro}
                          nombreComercio={nombreComercio}
                          mostrarSinStock={mostrarSinStock}
                        >
                          <button className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-md md:rounded-lg bg-muted/60 flex items-center justify-center overflow-hidden border border-border/80 cursor-pointer hover:opacity-85 transition-opacity shrink-0 shadow-none">
                            {primeraImagen ? (
                              <Image
                                src={primeraImagen}
                                alt={producto.nombre}
                                width={40}
                                height={40}
                                className="object-cover w-full h-full"
                                priority={index < 8}
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-muted-foreground/60" />
                            )}
                            {/* Marca de selección sobre la miniatura: en mobile
                                es el único indicador además del fondo, porque
                                ya no hay columna de checkbox. */}
                            {seleccion.modoSeleccion && isSelected && (
                              <span className="absolute inset-0 flex items-center justify-center bg-primary/85 text-primary-foreground">
                                <Check className="w-4 h-4" strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        </AbrirDetalle>

                        <div className="flex flex-col min-w-0 flex-1">
                          <AbrirDetalle
                            activo={!seleccion.modoSeleccion}
                            producto={producto}
                            rubro={rubro}
                            nombreComercio={nombreComercio}
                            mostrarSinStock={mostrarSinStock}
                          >
                            <button className="font-semibold text-foreground text-xs sm:text-sm text-left truncate block w-full max-w-50 md:max-w-60 cursor-pointer">
                              {producto.nombre}
                            </button>
                          </AbrirDetalle>
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                            {/* Uno de los 8 de la portada del catálogo. Misma
                                marca que la vista de grilla. */}
                            {producto.destacado_en && (
                              <Star
                                className="h-3 w-3 shrink-0 fill-warning text-warning"
                                aria-label="Destacado en la portada del catálogo"
                              />
                            )}
                            {producto.marca && (
                              <span className="text-xs uppercase font-medium tracking-wide bg-muted px-1.5 py-0.5 rounded text-muted-foreground border border-border/50 truncate max-w-24">
                                {producto.marca}
                              </span>
                            )}
                            {badgesIdentidad(
                              producto,
                              variantesVisibles,
                              rubro,
                            ).map((badge) => (
                              <span
                                key={badge.clave}
                                title={badge.titulo}
                                className="text-xs uppercase font-medium tracking-wide bg-muted px-1.5 py-0.5 rounded text-muted-foreground border border-border/50 truncate max-w-32"
                              >
                                {badge.texto}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* CATEGORÍA — padre e hijo apilados, no "Padre › Hijo" en
                        una línea: la versión horizontal se truncaba justo en la
                        parte específica ("COMPLEMENTOS › ..."). El ancho sale
                        de la columna Producto, no de Stock. */}
                    <TableCell className="py-1 hidden sm:table-cell text-muted-foreground text-sm max-w-56">
                      {categoriaPartes && (
                        <div
                          className="flex flex-col min-w-0"
                          title={categoriaTitulo}
                        >
                          {categoriaPartes.padre && (
                            <span className="truncate text-xs text-muted-foreground leading-tight">
                              {categoriaPartes.padre}
                            </span>
                          )}
                          <span className="truncate text-foreground text-xs sm:text-sm leading-tight">
                            {categoriaPartes.nombre}
                          </span>
                        </div>
                      )}
                    </TableCell>

                    {/* STOCK (Oculto en móviles) */}
                    <TableCell className="text-center py-1 hidden sm:table-cell">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                        <span className="font-mono font-medium text-foreground">
                          {/* La unidad ya no está clavada en "u.": en una
                              carnicería el inventario dice 12,5 kg, no 12. */}
                          {formatearNumeroCantidad(
                            totalUnidades,
                            producto.unidad_medida,
                          )}{" "}
                          <span className="text-xs font-medium opacity-70">
                            {abreviaturaUnidad}
                          </span>
                        </span>
                      </div>
                    </TableCell>

                    {/* COSTO */}
                    {isAdmin && (
                      <TableCell className="text-right font-mono text-muted-foreground hidden md:table-cell py-2.5">
                        {!mostrableCosto.uniforme ? (
                          <span title="Las variantes tienen costos distintos">
                            {formatearMoneda(mostrableCosto.min)} -{" "}
                            {formatearMoneda(mostrableCosto.max)}
                          </span>
                        ) : (
                          formatearMoneda(mostrableCosto.valor)
                        )}
                      </TableCell>
                    )}

                    {/* PRECIO + badge de recargo derivado de costo/precio.
                        El badge es solo para admin: el % de margen deja leer
                        el costo por diferencia, y Costo ya es columna admin. */}
                    <TableCell className="text-right font-mono font-medium text-xs sm:text-sm px-1 sm:px-0 py-1 whitespace-nowrap tabular-nums">
                      <div className="flex flex-col items-end gap-0.5">
                        {!mostrablePrecio.uniforme ? (
                          <span title="Las variantes tienen precios distintos">
                            {formatearMoneda(mostrablePrecio.min)} -{" "}
                            {formatearMoneda(mostrablePrecio.max)}
                          </span>
                        ) : (
                          <span>{formatearMoneda(mostrablePrecio.valor)}</span>
                        )}
                        {/* Solo cuando la tabla muestra UN número y ese número
                            no es el que tiene cargado el producto: ahí es
                            donde engaña. Con rango no hace falta — que haya
                            dos extremos ya dice que no hay un precio único, y
                            la ficha avisa igual al abrirla. */}
                        {mostrablePrecio.uniforme &&
                          mostrablePrecio.difiereDeCabecera && (
                            <span
                              title={`El producto tiene cargado ${formatearMoneda(precio)}, pero se vende al precio de sus variantes. Corregilo en cada variante, dentro de la ficha del producto.`}
                              className="text-xs font-sans font-medium leading-none px-1.5 py-0.5 rounded-full border bg-warning-subtle text-warning border-warning/25"
                            >
                              precio por variante
                            </span>
                          )}
                        {/* Stock en el celular: ahí la columna Stock no
                            entra, y sin esto el inventario no mostraba
                            cuántas unidades quedan. */}
                        <span className="flex items-center gap-1 font-sans text-xs text-muted-foreground sm:hidden">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
                          />
                          {formatearNumeroCantidad(
                            totalUnidades,
                            producto.unidad_medida,
                          )}{" "}
                          {abreviaturaUnidad}
                        </span>
                        {isAdmin && !preciosVarian && costoEfectivo > 0 && (
                          <span
                            title={`Recargo sobre el costo: +${formatearMoneda(gananciaEfectiva)}`}
                            className="text-xs font-sans font-medium leading-none px-1.5 py-0.5 rounded-full border bg-success-subtle text-success border-success/20"
                          >
                            +{recargoEfectivo}%
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* ACCIONES (oculta en mobile: cubierta por selección + barra flotante) */}
                    <TableCell className="text-right pl-0 pr-1 sm:pr-2 py-1 hidden sm:table-cell">
                      <div
                        className="flex items-center justify-end gap-0.5 md:gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ShareButton
                          url={urlProducto ?? ""}
                          disabled={compartirDeshabilitado}
                          disabledReason={motivoCompartirDeshabilitado}
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground shrink-0"
                        />
                        {isAdmin && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Acciones de ${producto.nombre}`}
                                className="text-muted-foreground hover:text-foreground shrink-0"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            {/* Íconos neutros: el color queda para lo que
                                significa algo (rojo = eliminar). */}
                            <DropdownMenuContent align="end" className="w-52 z-40">
                              <DropdownMenuItem
                                onSelect={() => setProductoEnEdicion(producto)}
                              >
                                <Edit2 className="text-muted-foreground" />
                                Editar producto
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setAccionFila({ tipo: "baja", producto })
                                }
                              >
                                <MinusCircle className="text-muted-foreground" />
                                Registrar baja
                              </DropdownMenuItem>
                              {/* Combinar va ANTES de Eliminar y separado de
                                  él: es lo que hay que hacer con un
                                  duplicado, y borrarlo se lleva puesto su
                                  stock. */}
                              <DropdownMenuItem
                                onSelect={() =>
                                  setAccionFila({ tipo: "fusionar", producto })
                                }
                              >
                                <Merge className="text-muted-foreground" />
                                Combinar con otro
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  setAccionFila({ tipo: "eliminar", producto })
                                }
                              >
                                <Trash2 />
                                Eliminar producto
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* SUB-FILA DE VARIANTES (Expansión) */}
                  {hasVariantes && variantesEstanAbiertas && (
                    <TableRow className="bg-muted/5 hover:bg-muted/5 border-b border-border/40">
                      {/* Usamos colSpan 100 para asegurar que ocupe todo sin importar cuántas columnas estén ocultas */}
                      <TableCell colSpan={100} className="p-0">
                        <div className="py-2 sm:py-3 pl-8 sm:pl-[4.5rem] pr-2 sm:pr-8">
                          <div className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider border-b border-border/40">
                                <tr>
                                  <th className="px-2 sm:px-4 py-2 sm:py-2.5 text-left font-semibold">
                                    Variante
                                  </th>
                                  <th className="px-2 sm:px-4 py-2 sm:py-2.5 text-center font-semibold w-20 sm:w-32">
                                    Stock
                                  </th>
                                  {isAdmin && (
                                    <th className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold w-24 sm:w-28">
                                      Costo
                                    </th>
                                  )}
                                  <th className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold w-24 sm:w-28">
                                    Precio
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {variantesVisibles.map(
                                  (v: StockTableVariant) => {
                                    const varStock = v.stock ?? v.cantidad ?? 0;
                                    const varCostoHeredado =
                                      v.costo === null || v.costo === undefined;
                                    const varPrecioHeredado =
                                      v.precio === null ||
                                      v.precio === undefined;
                                    const varCosto = precioEfectivoVariante(
                                      v,
                                      "costo",
                                      costo,
                                    );
                                    const varPrecio = precioEfectivoVariante(
                                      v,
                                      "precio",
                                      precio,
                                    );

                                    return (
                                      <tr
                                        key={v.id || v.variante}
                                        className="hover:bg-muted/30 transition-colors"
                                      >
                                        <td className="px-2 py-1 font-medium text-xs sm:text-sm text-foreground">
                                          {v.nombre_display || v.variante}
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                          <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                                            <div
                                              className={`w-1.5 h-1.5 rounded-full ${
                                                COLOR_NIVEL_STOCK[
                                                  nivelStock(Number(varStock))
                                                ]
                                              }`}
                                            />
                                            <span className="font-semibold text-xs sm:text-sm font-mono text-foreground">
                                              {formatearNumeroCantidad(
                                                Number(varStock),
                                                producto.unidad_medida,
                                              )}{" "}
                                              <span className="text-xs font-medium opacity-70">
                                                {abreviaturaUnidad}
                                              </span>
                                            </span>
                                          </div>
                                        </td>
                                        {isAdmin && (
                                          <td
                                            className={`px-2 font-mono py-1 text-right text-xs sm:text-sm ${
                                              varCostoHeredado
                                                ? "text-muted-foreground italic"
                                                : "font-medium text-foreground"
                                            }`}
                                            title={
                                              varCostoHeredado
                                                ? "Hereda el costo del producto"
                                                : undefined
                                            }
                                          >
                                            {formatearMoneda(varCosto)}
                                          </td>
                                        )}
                                        <td
                                          className={`px-2 font-mono py-1 text-right text-xs sm:text-sm ${
                                            varPrecioHeredado
                                              ? "text-muted-foreground italic"
                                              : "font-semibold text-foreground"
                                          }`}
                                          title={
                                            varPrecioHeredado
                                              ? "Hereda el precio del producto"
                                              : undefined
                                          }
                                        >
                                          {formatearMoneda(varPrecio)}
                                        </td>
                                      </tr>
                                    );
                                  },
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
