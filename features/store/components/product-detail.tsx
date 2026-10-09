"use client";

import { useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Producto } from "@/entities/productos/types";
import {
  ShoppingBag,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  ChevronDown,
  Info,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useCartStore } from "@/shared/store/cart-store";
import { useRutaCatalogo, useSlugNegocio } from "@/shared/lib/use-negocio";
import { ShareButton } from "@/shared/components/share-button";
import { construirUrlProducto } from "@/shared/utils/compartir-catalogo";
import { PrecioConDescuento } from "./precio-con-descuento";
import { ConfiguracionPOS } from "@/entities/config/types";
import { resolverAtributosVariante } from "@/entities/productos/lib/build-propiedades-filtro";
import { compararTalles } from "@/entities/productos/lib/comparar-talles";
import { normalizarParaComparar } from "@/entities/productos/lib/parse-variant-attributes";

interface ProductDetailProps {
  producto: Producto;
  baseUrl?: string;
  numeroWhatsApp?: string;
  config?: ConfiguracionPOS | null;
}

export function ProductDetail({
  producto,
  config,
}: Readonly<ProductDetailProps>) {
  const rutaDelCatalogo = useRutaCatalogo();
  const slugNegocio = useSlugNegocio();
  const searchParams = useSearchParams();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [descOpen, setDescOpen] = useState(false);
  const mobileGalleryRef = useRef<HTMLDivElement>(null);

  // Miniaturas verticales visibles sin scroll junto a la imagen principal
  // (calculado para el tamaño de imagen y miniatura definidos más abajo).
  const MAX_VISIBLE_THUMBS = 4;

  const [selecciones, setSelecciones] = useState<Record<string, string>>({});
  // Un solo aviso para los dos motivos por los que "Añadir al carrito" no
  // agrega: falta elegir una opción, o la combinación elegida está agotada.
  // Va inline y no como toast: en mobile el toast (abajo al medio) cae justo
  // sobre la barra fija del botón, o sea tapa lo que el cliente acaba de
  // tocar. Acá el mensaje queda pegado a lo que hay que corregir.
  const [errorSeleccion, setErrorSeleccion] = useState<string | null>(null);

  const addItem = useCartStore((state) => state.addItem);

  const imagenes = useMemo(() => {
    if (Array.isArray(producto.imagen_url)) return producto.imagen_url;
    if (typeof producto.imagen_url === "string") {
      try {
        const parsed = JSON.parse(producto.imagen_url);
        return Array.isArray(parsed) ? parsed : [producto.imagen_url];
      } catch {
        return [producto.imagen_url];
      }
    }
    return [];
  }, [producto.imagen_url]);

  // Solo para las miniaturas de los carriles — la imagen principal
  // (gallery mobile y el display grande de desktop) sigue usando
  // `imagenes` (la versión completa). Cae a `imagenes[i]` cuando el
  // producto todavía no tiene thumbnail (viejo o no backfilleado).
  const miniaturas = useMemo(() => {
    if (Array.isArray(producto.thumbnail_url)) return producto.thumbnail_url;
    if (typeof producto.thumbnail_url === "string") {
      try {
        const parsed = JSON.parse(producto.thumbnail_url);
        return Array.isArray(parsed) ? parsed : [producto.thumbnail_url];
      } catch {
        return [producto.thumbnail_url];
      }
    }
    return [];
  }, [producto.thumbnail_url]);

  // 1. UNIFICAR LECTURA DE VARIANTES (Agregamos la extracción de los 'atributos' JSONB)
  const variantesArray = useMemo(() => {
    const list: Array<{
      variante: string;
      cantidad: number;
      id_real: string;
      atributos?: Record<string, string>;
      precio: number | null;
    }> = [];

    let tieneAtributosEstructurados = false;
    producto.producto_variantes?.forEach((v) => {
      const atributos = resolverAtributosVariante(v);
      if (Object.keys(atributos).length > 0) tieneAtributosEstructurados = true;
      list.push({
        variante: v.nombre_display,
        cantidad: v.stock_disponible ?? v.stock,
        id_real: v.id,
        atributos,
        precio: v.precio,
      });
    });

    // Solo se recurre al stock legacy si el producto nunca se migró a
    // producto_variantes.atributos — si no, se duplican los grupos porque
    // ambas fuentes describen las mismas variantes.
    if (!tieneAtributosEstructurados) {
      producto.stock?.forEach((s) => {
        list.push({
          variante: s.variante,
          cantidad: s.cantidad,
          id_real: s.id,
          precio: null,
        });
      });
    }
    return list;
  }, [producto.producto_variantes, producto.stock]);

  const stockTotal = useMemo(
    () => variantesArray.reduce((acc, s) => acc + s.cantidad, 0),
    [variantesArray],
  );
  const estaAgotado = stockTotal === 0;

  // 2. PARSER DE VARIANTES: Puro JSONB Directo
  const parsedVariants = useMemo(() => {
    const props: Record<string, Set<string>> = {};

    variantesArray.forEach((s) => {
      if (s.cantidad <= 0 && config?.mostrar_sin_stock === false) return;

      if (s.atributos && Object.keys(s.atributos).length > 0) {
        Object.entries(s.atributos).forEach(([key, val]) => {
          if (!props[key]) props[key] = new Set();
          props[key].add(val.trim());
        });
      } else {
        const v = s.variante || "";
        if (v.toLowerCase() !== "unico" && v.toLowerCase() !== "único") {
          if (!props["Opción"]) props["Opción"] = new Set();
          props["Opción"].add(v.trim());
        }
      }
    });

    const result: Record<string, string[]> = {};
    Object.keys(props).forEach((k) => {
      const valores = Array.from(props[k]);
      result[k] =
        normalizarParaComparar(k) === "talle"
          ? valores.sort(compararTalles)
          : valores;
    });
    return { properties: result };
  }, [variantesArray, config]);

  const isUnico = Object.keys(parsedVariants.properties).length === 0;

  //  3. LÓGICA DE DISPONIBILIDAD CRUZADA (JSONB Nativo)
  const isOptionAvailable = (propName: string, val: string) => {
    const testSelections = { ...selecciones, [propName]: val };

    return variantesArray.some((s) => {
      if (s.cantidad <= 0) return false;

      if (s.atributos && Object.keys(s.atributos).length > 0) {
        return Object.entries(testSelections).every(
          ([k, selVal]) => s.atributos![k] === selVal,
        );
      }

      return propName === "Opción" && s.variante === val;
    });
  };

  const handleAddToCart = () => {
    if (estaAgotado) return;

    if (
      !isUnico &&
      Object.keys(parsedVariants.properties).length !==
        Object.keys(selecciones).length
    ) {
      setErrorSeleccion("Faltan opciones por seleccionar");
      return;
    }
    setErrorSeleccion(null);

    // 🚀 4. BUSCADOR DE STOCK (JSONB Nativo)
    const stockDeVariante = variantesArray.find((s) => {
      if (isUnico) return true;

      if (s.atributos && Object.keys(s.atributos).length > 0) {
        return Object.entries(selecciones).every(
          ([k, selVal]) => s.atributos![k] === selVal,
        );
      }

      return s.variante === selecciones["Opción"];
    });

    const stockMaximo = stockDeVariante ? stockDeVariante.cantidad : 0;

    if (stockMaximo <= 0) {
      setErrorSeleccion("Esta combinación se encuentra agotada");
      return;
    }

    addItem({
      productoId: producto.id,
      preciosPorCantidad: producto.precios_por_cantidad,
      sugeridoCatalogo: searchParams.get("origen") === "sugerencia-carrito",
      nombre: producto.nombre || "Sin nombre",
      tipo: producto.tipo || "",
      variante: stockDeVariante ? stockDeVariante.variante : "Unico",
      varianteId: producto.producto_variantes?.find(v => v.id === stockDeVariante?.id_real)?.id,
      atributosVariante: stockDeVariante?.atributos,
      precio: stockDeVariante?.precio ?? producto.precio,
      cantidad: 1,
      unidadMedida: producto.unidad_medida,
      imagenUrl: imagenes[0] || null,
      stockMaximo: stockMaximo,
    });
  };

  const handlePrevImage = () =>
    setCurrentImageIndex((prev) =>
      prev === 0 ? imagenes.length - 1 : prev - 1,
    );
  const handleNextImage = () =>
    setCurrentImageIndex((prev) =>
      prev === imagenes.length - 1 ? 0 : prev + 1,
    );

  const handleThumbnailClick = (index: number) => {
    setCurrentImageIndex(index);
    const el = mobileGalleryRef.current;
    if (el) {
      el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
    }
  };

  const handleMobileGalleryScroll = () => {
    const el = mobileGalleryRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setCurrentImageIndex(index);
  };

  return (
    <div className="flex flex-col md:flex-row items-start mx-4 pb-8 md:pb-0 relative">
      {/* LADO IZQUIERDO: IMÁGENES */}
      <div className="w-full md:w-auto md:shrink-0 flex flex-col md:pr-8 md:sticky md:top-32">
        {/* Breadcrumb Oculto en Mobile, visible en Desktop */}
        <nav className="hidden md:flex items-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-6">
          <Link
            href={rutaDelCatalogo}
            className="hover:text-foreground transition-colors"
          >
            Catálogo
          </Link>
          <span className="mx-2 opacity-50">/</span>
          {producto.tipo && (
            <>
              <Link
                href={`${rutaDelCatalogo}?q=${producto.tipo}`}
                className="hover:text-foreground transition-colors"
              >
                {producto.tipo}
              </Link>
              <span className="mx-2 opacity-50">/</span>
            </>
          )}
          <span className="text-foreground truncate max-w-50">
            {producto.nombre}
          </span>
        </nav>

        {/* Breadcrumb visible solo en Mobile */}
        <nav className="flex md:hidden items-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground my-4">
          <Link href={rutaDelCatalogo} className="hover:text-foreground">
            Catálogo
          </Link>
          <span className="mx-2 opacity-50">/</span>
          {producto.tipo && (
            <span className="text-foreground truncate max-w-50">
              {producto.tipo}
            </span>
          )}
        </nav>

        {/* Galería Mobile (Swipeable) */}
        <div
          ref={mobileGalleryRef}
          onScroll={handleMobileGalleryScroll}
          className="md:hidden flex overflow-x-auto snap-x snap-mandatory scrollbar-hide w-full bg-[#f7f7f7]"
        >
          {imagenes.length > 0 ? (
            imagenes.map((img, i) => (
              <div
                key={i}
                className="snap-center shrink-0 w-full aspect-4/5 relative"
              >
                <Image
                  src={img}
                  alt={`${producto.nombre} ${i}`}
                  fill
                  className="object-cover"
                  priority={i === 0}
                  sizes="100vw"
                />
                {imagenes.length > 1 && (
                  <div className="absolute bottom-4 left-0 w-full flex justify-center gap-1.5">
                    {imagenes.map((_, dotIdx) => (
                      <div
                        key={dotIdx}
                        className={`w-1.5 h-1.5 rounded-full ${dotIdx === i ? "bg-black" : "bg-black/20"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="snap-center shrink-0 w-full aspect-4/5 flex flex-col items-center justify-center text-muted-foreground/30">
              <ShoppingBag className="w-16 h-16 mb-2" strokeWidth={1} />
            </div>
          )}
        </div>

        {/* Miniaturas Mobile: carril horizontal debajo de la imagen principal */}
        {imagenes.length > 1 && (
          <div className="md:hidden flex gap-2 overflow-x-auto scrollbar-hide px-4 -mx-4 py-3">
            {imagenes.map((img, index) => (
              <button
                key={`mobile-thumb-${index}`}
                type="button"
                onClick={() => handleThumbnailClick(index)}
                className={`relative w-14 aspect-4/5 shrink-0 bg-background transition-all border cursor-pointer ${
                  currentImageIndex === index
                    ? "border-foreground opacity-100"
                    : "border-transparent opacity-60"
                }`}
              >
                <Image
                  src={miniaturas[index] || img}
                  alt={`Miniatura ${index + 1}`}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </button>
            ))}
          </div>
        )}

        {/* Galería Desktop (Miniaturas verticales + Imagen principal) */}
        <div className="hidden md:flex gap-3">
          {imagenes.length > 1 && (
            <div className="flex flex-col gap-2 w-16 shrink-0">
              {imagenes.slice(0, MAX_VISIBLE_THUMBS).map((img, index) => {
                const hiddenCount = imagenes.length - MAX_VISIBLE_THUMBS;
                const isOverflowSlot =
                  hiddenCount > 0 && index === MAX_VISIBLE_THUMBS - 1;
                const isActive = currentImageIndex === index;

                return (
                  <button
                    key={`thumb-${index}`}
                    type="button"
                    onClick={() => handleThumbnailClick(index)}
                    className={`relative w-16 aspect-4/5 shrink-0 bg-background transition-all border cursor-pointer ${
                      isActive
                        ? "border-foreground opacity-100"
                        : "border-transparent opacity-60 hover:opacity-100 hover:border-border"
                    }`}
                  >
                    <Image
                      src={miniaturas[index] || img}
                      alt={`Miniatura ${index + 1}`}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                    {isOverflowSlot && (
                      <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">
                          +{hiddenCount + 1}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative aspect-4/5 w-full md:w-[400px] lg:w-[500px] xl:w-[600px] bg-card flex items-center justify-center group overflow-hidden border border-border/60 shrink-0">
            {" "}
            {imagenes.length > 0 ? (
              <Image
                src={imagenes[currentImageIndex]}
                alt={producto.nombre || ""}
                fill
                className="object-cover transition-opacity duration-300"
                priority
                sizes="(max-width: 1200px) 60vw, 650px"
              />
            ) : (
              <ShoppingBag
                className="w-20 h-20 text-muted-foreground/30"
                strokeWidth={1}
              />
            )}
            {imagenes.length > 1 && (
              <>
                <button
                  onClick={handlePrevImage}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white hover:bg-neutral-100 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 border border-border cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
                </button>
                <button
                  onClick={handleNextImage}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white hover:bg-neutral-100 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 border border-border cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* LADO DERECHO: INFORMACIÓN Y CTA */}
      <div className="w-full md:flex-1 md:max-w-lg flex flex-col pt-4 sm:px-0">
        <div className="flex items-start justify-between gap-3 mb-2 md:mb-4">
          <h1 className="text-2xl md:text-4xl font-semibold text-foreground uppercase tracking-tight">
            {producto.nombre}
          </h1>
          {/* El link se arma con urlDeCatalogo, no con la URL de la pestaña:
              en modo path (preview desde el panel) la pestaña no es el link
              público que tiene que quedar pegado en el chat. */}
          {slugNegocio && producto.slug && (
            <ShareButton
              url={construirUrlProducto(slugNegocio, producto.slug)}
              variant="ghost"
              size="icon-sm"
              className="shrink-0 mt-1 text-muted-foreground hover:text-foreground"
            />
          )}
        </div>

        {config?.mostrar_precios !== false && (
          <div className="mb-6 md:mb-8">
            <PrecioConDescuento
              precio={producto.precio || 0}
              categoria={producto.tipo}
              classNamePrecio="text-xl md:text-2xl font-medium text-foreground"
              tamano="ficha"
            />
            {!!producto.precios_por_cantidad?.length && (
              <div className="mt-3 text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Precios por cantidad</p>
                {producto.precios_por_cantidad.map(tramo => <p key={tramo.desde}>
                  Desde {tramo.desde}: ${tramo.precio.toLocaleString("es-AR")} por unidad
                </p>)}
                <p className="text-xs">Se aplica a todas las unidades de la misma variante.</p>
              </div>
            )}
          </div>
        )}

        {config?.pedidos_whatsapp !== false ? (
          <>
            {!isUnico && (
              <div className="mb-6 space-y-5">
                {Object.entries(parsedVariants.properties).map(
                  ([propName, values]) => (
                    <div key={propName}>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
                        Selecciona {propName}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {values.map((val) => {
                          const isSelected = selecciones[propName] === val;
                          const hasStock = isOptionAvailable(propName, val);

                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                setSelecciones((prev) => ({
                                  ...prev,
                                  [propName]: val,
                                }));
                                setErrorSeleccion(null);
                              }}
                              className={`min-w-16 px-4 py-3 text-[10px] sm:text-xs font-semibold uppercase transition-all border cursor-pointer ${
                                isSelected
                                  ? "border-foreground bg-foreground text-background"
                                  : hasStock
                                    ? "border-border/60 bg-transparent text-foreground hover:border-foreground"
                                    : "border-border/30 bg-transparent text-muted-foreground opacity-40 line-through decoration-muted-foreground/40"
                              }`}
                            >
                              {val}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )}

                {errorSeleccion && (
                  <p className="text-danger text-xs font-medium tracking-wide flex items-center animate-in fade-in slide-in-from-top-1">
                    <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
                    {errorSeleccion}
                  </p>
                )}
              </div>
            )}

            {producto.descripcion && (
              <div className="border-t border-border/60 py-4 mt-2">
                <button
                  onClick={() => setDescOpen(!descOpen)}
                  className="flex justify-between items-center w-full text-[10px] font-bold uppercase tracking-widest text-foreground cursor-pointer"
                >
                  <span>Descripción del Producto</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-300 ${descOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${descOpen ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {producto.descripcion}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="hidden md:block border-t border-border/60 pt-6 mt-4">
              <button
                onClick={handleAddToCart}
                disabled={estaAgotado}
                className={`w-full flex items-center justify-center gap-3 py-4 rounded-none font-bold text-xs uppercase tracking-widest transition-colors cursor-pointer ${
                  estaAgotado
                    ? "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                    : "bg-foreground text-background hover:bg-foreground/90"
                }`}
              >
                <ShoppingCart className="w-4 h-4" />
                {estaAgotado ? "Agotado" : "Añadir al carrito"}
              </button>
            </div>
          </>
        ) : (
          /* MODO SOLO VISUALIZACIÓN */
          <>
            {producto.descripcion && (
              <div className="border-t border-border/60 py-4 mt-2">
                <button
                  onClick={() => setDescOpen(!descOpen)}
                  className="flex justify-between items-center w-full text-[10px] font-bold uppercase tracking-widest text-foreground cursor-pointer"
                >
                  <span>Descripción del Producto</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-300 ${descOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${descOpen ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {producto.descripcion}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border/60 py-6 mt-2">
              <div className="bg-muted/50 border border-border/50 p-4 flex flex-col items-center justify-center gap-2">
                <Info className="w-5 h-5 text-muted-foreground mb-1" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">
                  Modo Catálogo
                </span>
                <span className="text-xs text-muted-foreground text-center max-w-60">
                  Para consultar stock o realizar un pedido, contactanos
                  directamente.
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {config?.pedidos_whatsapp !== false && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-background backdrop-blur-md border-t border-border z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          {/* El aviso también acá: en mobile el botón de esta barra es el que
              se toca, y el mensaje de arriba puede quedar fuera de pantalla. */}
          {errorSeleccion && (
            <p className="text-danger text-xs font-medium tracking-wide flex items-center mb-2 animate-in fade-in slide-in-from-bottom-1">
              <AlertCircle className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              {errorSeleccion}
            </p>
          )}
          <button
            onClick={handleAddToCart}
            disabled={estaAgotado}
            className={`w-full flex items-center justify-center gap-3 py-4 rounded-none font-bold text-xs uppercase tracking-widest transition-colors cursor-pointer ${
              estaAgotado
                ? "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {estaAgotado ? "Agotado" : "Añadir al carrito"}
          </button>
        </div>
      )}
    </div>
  );
}
