"use client";

import { Check } from "lucide-react";
import { familiaPorEtiqueta } from "@/entities/productos/lib/color-familias";
import { estaSeleccionado } from "../lib/filtros-url";

/**
 * Selector de color por muestra, en vez de una lista de nombres.
 *
 * Las opciones que llegan acá ya son FAMILIAS (ver color-familias.ts), no los
 * valores crudos del catálogo — si no, esto sería una grilla de trescientos
 * cuadraditos.
 *
 * Accesibilidad: la muestra nunca comunica sola. Cada botón lleva su
 * `aria-label` y su `title` con el nombre de la familia, el estado
 * seleccionado se marca además con una tilde (no sólo con el anillo de
 * color), y se usan botones reales para que funcione con teclado.
 */
export function ColorSwatches({
  valores,
  seleccion,
  onToggle,
  tamano = "normal",
}: Readonly<{
  valores: string[];
  /** Familias elegidas. Vacío = sin filtro de color. */
  seleccion: string[];
  onToggle: (valor: string) => void;
  tamano?: "normal" | "compacto";
}>) {
  const caja = tamano === "compacto" ? "h-7 w-7" : "h-9 w-9";

  return (
    <div className="flex flex-wrap gap-2.5">
      {valores.map((etiqueta) => {
        const familia = familiaPorEtiqueta(etiqueta);
        const seleccionado = estaSeleccionado(seleccion, etiqueta);

        // Blanco y los tonos muy claros necesitan un borde propio: sin eso la
        // muestra desaparece contra el fondo de la tarjeta.
        const estiloMuestra = familia?.hex
          ? { backgroundColor: familia.hex }
          : {
              // Multicolor (Estampado / Otros): rueda de color, para que se
              // lea como "varios" y no como un color puntual.
              backgroundImage:
                "conic-gradient(#dc2626, #facc15, #16a34a, #2563eb, #7c3aed, #dc2626)",
            };

        return (
          <button
            key={etiqueta}
            type="button"
            onClick={() => onToggle(etiqueta)}
            aria-pressed={seleccionado}
            aria-label={etiqueta}
            title={etiqueta}
            className={`relative ${caja} shrink-0 rounded-full border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${
              seleccionado
                ? "border-foreground ring-2 ring-foreground ring-offset-2 ring-offset-background"
                : "border-border/70"
            }`}
            style={estiloMuestra}
          >
            {seleccionado && (
              <Check
                className={`absolute inset-0 m-auto h-4 w-4 drop-shadow ${
                  esClaro(familia?.hex) ? "text-black" : "text-white"
                }`}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ¿La tilde tiene que ser negra sobre esta muestra?
 *
 * Luminancia relativa aproximada (coeficientes de percepción del canal): un
 * amarillo y un blanco son claros aunque uno sea "de color", y sobre ellos
 * una tilde blanca no se ve. Sin hex (multicolor) se asume oscuro, que es lo
 * que promedia la rueda.
 */
function esClaro(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const limpio = hex.replace("#", "");
  if (limpio.length !== 6) return false;
  const r = parseInt(limpio.slice(0, 2), 16);
  const g = parseInt(limpio.slice(2, 4), 16);
  const b = parseInt(limpio.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}
