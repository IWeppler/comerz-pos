"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowRight, Loader2, Search, X } from "lucide-react";
import { useRutaCatalogo } from "@/shared/lib/use-negocio";
import { useCatalogoPublico } from "@/features/store/components/catalogo-publico-provider";
import { buscarEnCatalogoPublico, puedeBuscarSinNavegar, rutaBusquedaPublica } from "@/features/store/lib/busqueda-publica";
import { ProductCard } from "@/features/store/components/product-card";
import type { CategoriaNavbar } from "./navbar";

export function SearchBar({ categorias = [], mostrarSinStock, onAbrir }: Readonly<{
  categorias?: CategoriaNavbar[];
  mostrarSinStock?: boolean;
  onAbrir?: () => void;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rutaDelCatalogo = useRutaCatalogo();
  const { indice, error, cargarIndice } = useCatalogoPublico();
  const currentQuery = searchParams.get("q") || "";
  const [term, setTerm] = useState(currentQuery);
  const [open, setOpen] = useState(false);
  const [posicion, setPosicion] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // El layout persiste al ir a una ficha o volver con Atrás. El borrador no
  // navega solo ni puede reenviar una búsqueda al abrir un producto.
  const navigationKey = `${pathname}?${searchParams}`;
  const [ultimaRuta, setUltimaRuta] = useState(navigationKey);
  if (ultimaRuta !== navigationKey) {
    setUltimaRuta(navigationKey);
    setTerm(currentQuery);
    setOpen(false);
  }

  const resultados = useMemo(() => buscarEnCatalogoPublico(indice ?? [], term, { mostrar_sin_stock: mostrarSinStock }), [indice, term, mostrarSinStock]);
  const hayConsulta = term.trim().length > 0;
  const totalCatalogo = useMemo(() => indice === null ? null : buscarEnCatalogoPublico(indice, "", { mostrar_sin_stock: mostrarSinStock }).total, [indice, mostrarSinStock]);
  const placeholder = totalCatalogo === null ? "Buscar productos" : `Buscá entre ${totalCatalogo.toLocaleString("es-AR")} productos`;

  const cambiarApertura = (valor: boolean) => {
    if (valor) {
      const rect = triggerRef.current?.getBoundingClientRect();
      const header = triggerRef.current?.closest("header")?.getBoundingClientRect();
      if (rect && header) setPosicion({
        "--buscador-top": `${rect.top}px`,
        // El campo abierto ocupa EXACTAMENTE el lugar del cerrado: misma
        // posición, ancho y alto. Antes se corría para dejar lugar a una X
        // de cerrar que iba afuera; ahora la X va adentro.
        "--buscador-left": `${rect.left}px`,
        "--buscador-width": `${rect.width}px`,
        "--buscador-panel-top": `${header.bottom}px`,
      } as CSSProperties);
      setTerm(currentQuery);
      onAbrir?.();
      void cargarIndice();
    }
    setOpen(valor);
  };

  const buscar = (consulta = term) => {
    const destino = rutaBusquedaPublica(rutaDelCatalogo, consulta);
    if (destino === "#") return;
    setOpen(false);
    if (puedeBuscarSinNavegar(pathname, rutaDelCatalogo, new URLSearchParams(searchParams.toString()))) {
      window.history.pushState(null, "", destino);
    } else {
      // Ficha, categoría o selección con metadata: acá SÍ hay una navegación.
      router.push(destino);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={cambiarApertura}>
      <Dialog.Trigger asChild>
        {/* Cerrado y abierto comparten forma (esquinas rectas, h-11, w-80 en
            desktop): al abrir, el campo se ilumina en el mismo lugar en vez de
            saltar. Sin redondeo: sobre el fondo oscuro, las esquinas de un
            campo redondeado dejaban ver el fondo claro de atrás. */}
        <button ref={triggerRef} type="button" aria-label="Buscar productos" className="flex h-11 w-11 shrink-0 touch-manipulation select-none items-center justify-center gap-3 text-foreground active:bg-muted lg:justify-start lg:border lg:border-border lg:bg-background lg:px-3 lg:w-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          <Search className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden truncate text-sm lg:block">{currentQuery || placeholder}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content style={posicion} aria-describedby={undefined}
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
          onPointerDown={(event) => {
            // La superficie transparente de desktop pertenece al Content para
            // que Radix atrape el foco; un clic en ella también cierra el panel.
            if (event.target === event.currentTarget && window.matchMedia("(min-width: 1024px)").matches) setOpen(false);
          }}
          className="catalogo-publico fixed inset-0 z-50 flex h-dvh flex-col bg-background text-foreground outline-none lg:pointer-events-none lg:bg-transparent">
          <Dialog.Title className="sr-only">Buscar en el catálogo</Dialog.Title>
          <form role="search" aria-label="Productos del catálogo" onSubmit={(event) => { event.preventDefault(); buscar(); }}
            className="flex shrink-0 items-center gap-1 bg-background px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:pointer-events-auto lg:absolute lg:left-(--buscador-left) lg:top-(--buscador-top) lg:w-(--buscador-width) lg:bg-transparent lg:p-0">
            <Dialog.Close asChild>
              <button type="button" aria-label="Cerrar búsqueda" className="flex h-11 w-11 shrink-0 touch-manipulation select-none items-center justify-center active:bg-muted focus-visible:outline-2 lg:hidden">
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
            <div className="flex h-12 min-w-0 flex-1 items-center border border-foreground bg-muted/40 focus-within:ring-1 focus-within:ring-foreground lg:h-11 lg:bg-background">
              <button type="submit" aria-label="Ver resultados de búsqueda" className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center active:bg-muted focus-visible:outline-2">
                <Search className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </button>
              <input ref={inputRef} type="search" aria-label="Buscar productos" enterKeyHint="search" autoComplete="off" spellCheck={false} value={term} onChange={(event) => setTerm(event.target.value)} placeholder={placeholder}
                className="h-full w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none" />
              {/* UNA sola X, adentro del campo: con texto lo borra; vacío, en
                  desktop cierra (en mobile cierra la flecha de la izquierda).
                  Esc y el clic afuera también cierran. */}
              {term ? (
                <button type="button" aria-label="Borrar búsqueda" onClick={() => { setTerm(""); inputRef.current?.focus(); }} className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center text-muted-foreground hover:text-foreground active:bg-muted focus-visible:outline-2">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <Dialog.Close asChild>
                  <button type="button" aria-label="Cerrar búsqueda" className="hidden h-11 w-11 shrink-0 touch-manipulation items-center justify-center text-muted-foreground hover:text-foreground active:bg-muted focus-visible:outline-2 lg:flex">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              )}
            </div>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:pointer-events-auto lg:absolute lg:top-(--buscador-panel-top) lg:w-full lg:max-h-[calc(100dvh-var(--buscador-panel-top))] lg:min-h-60">
            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-7">
              <div>
                <h2 className="mb-2 text-sm text-muted-foreground">{hayConsulta ? "Sugerencias" : "Explorá por categoría"}</h2>
                <ul>
                  {hayConsulta ? resultados.sugerencias.map((sugerencia) => <li key={sugerencia}>
                    <button type="button" onClick={() => buscar(sugerencia)} className="min-h-11 w-full touch-manipulation py-2 text-left text-sm font-semibold hover:underline active:opacity-70 focus-visible:outline-2">{sugerencia}</button>
                  </li>) : categorias.slice(0, 8).map((categoria) => <li key={categoria.id}>
                    <Link href={`${rutaDelCatalogo}?categoria=${encodeURIComponent(categoria.slug || categoria.id)}`} prefetch={false} onClick={() => setOpen(false)} className="flex min-h-11 items-center text-sm font-semibold hover:underline focus-visible:outline-2">{categoria.nombre}</Link>
                  </li>)}
                </ul>
                {!hayConsulta && categorias.length === 0 && <p className="text-sm text-muted-foreground">Buscá por nombre, marca o código.</p>}
                {!hayConsulta && <button type="button" onClick={() => buscar("")} className="mt-3 min-h-11 text-sm underline underline-offset-4 focus-visible:outline-2">Ver todo el catálogo</button>}
              </div>
              {hayConsulta && <div>
                {error ? <div role="alert" className="py-5 text-sm">
                  <p>{error}</p><button type="button" onClick={() => void cargarIndice()} className="mt-3 min-h-11 underline">Reintentar</button>
                </div> : indice === null ? <div role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando productos…</div> : <>
                  <h2 className="mb-4 text-sm text-muted-foreground" role="status">{resultados.total ? `Productos (${resultados.total})` : "No encontramos productos"}</h2>
                  {resultados.total ? <div className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }}>
                    {resultados.productos.map((producto) => <ProductCard key={producto.id} producto={producto} />)}
                  </div> : <p className="py-4 text-sm text-muted-foreground">Probá con otro nombre, marca o código.</p>}
                  {resultados.total > 0 && <button type="button" onClick={() => buscar()} className="mt-6 flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2">Ver todos los resultados <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
                </>}
              </div>}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
