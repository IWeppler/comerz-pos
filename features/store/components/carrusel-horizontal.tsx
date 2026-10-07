"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Fila scrollable con flechas en desktop.
 *
 * En mobile no se renderizan las flechas: ahí el gesto de arrastrar es
 * natural y unos botones encima de las tarjetas sólo tapan contenido. En
 * desktop, en cambio, un overflow horizontal sin control visible se pierde —
 * mucha gente no descubre que puede scrollear de costado con un mouse sin
 * rueda horizontal.
 *
 * Las flechas se ocultan solas en los extremos, así no queda un botón que no
 * hace nada, y desaparecen enteras si el contenido entra sin scroll.
 */
export function CarruselHorizontal({
  children,
  ariaLabel,
  compacto = false,
}: Readonly<{ children: React.ReactNode; ariaLabel: string; compacto?: boolean }>) {
  const pistaRef = useRef<HTMLDivElement>(null);
  const [puedeIzquierda, setPuedeIzquierda] = useState(false);
  const [puedeDerecha, setPuedeDerecha] = useState(false);

  const recalcular = useCallback(() => {
    const pista = pistaRef.current;
    if (!pista) return;
    const { scrollLeft, scrollWidth, clientWidth } = pista;
    // Margen de 1px: con zoom o anchos fraccionarios, scrollLeft nunca llega
    // exacto al máximo y la flecha derecha quedaba encendida para siempre.
    setPuedeIzquierda(scrollLeft > 1);
    setPuedeDerecha(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    const pista = pistaRef.current;
    if (!pista) return;

    recalcular();
    pista.addEventListener("scroll", recalcular, { passive: true });

    // Las tarjetas pueden cambiar de cantidad (otro negocio, otra categoría) o
    // de ancho (resize), y en ambos casos cambia si hay scroll disponible.
    const observer = new ResizeObserver(recalcular);
    observer.observe(pista);
    for (const hijo of Array.from(pista.children)) observer.observe(hijo);

    return () => {
      pista.removeEventListener("scroll", recalcular);
      observer.disconnect();
    };
  }, [recalcular, children]);

  const desplazar = (direccion: -1 | 1) => {
    const pista = pistaRef.current;
    if (!pista) return;
    // Casi una pantalla, dejando un pedazo de la tarjeta del borde a la vista
    // para no perder la referencia de dónde se estaba.
    pista.scrollBy({ left: direccion * pista.clientWidth * 0.8, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  const flechaBase =
    "hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full border border-border bg-foreground text-background shadow-md backdrop-blur transition-opacity hover:bg-foreground/95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:pointer-events-none disabled:opacity-0";

  return (
    <div className="relative group/carrusel">
      <button
        type="button"
        onClick={() => desplazar(-1)}
        disabled={!puedeIzquierda}
        aria-label={`Ver anteriores en ${ariaLabel}`}
        className={`${flechaBase} ${compacto ? "left-0" : "-left-2 lg:-left-5"}`}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <div
        ref={pistaRef}
        className={`flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1 ${compacto ? "mx-0 px-0" : "-mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"}`}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => desplazar(1)}
        disabled={!puedeDerecha}
        aria-label={`Ver siguientes en ${ariaLabel}`}
        className={`${flechaBase} ${compacto ? "right-0" : "-right-2 lg:-right-5"}`}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
