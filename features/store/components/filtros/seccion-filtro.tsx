"use client";

import { ChevronDown } from "lucide-react";
import { Accordion } from "radix-ui";

/**
 * Una persiana del panel de filtros.
 *
 * El encabezado muestra cuántos filtros hay puestos en esta sección
 * ("Colores (2)"), que es lo que permite entender el estado sin abrirla. La
 * flecha rota 180° al abrir, así que la dirección comunica el estado sin
 * depender del color.
 *
 * Se apoya en el Accordion de Radix para no reimplementar el manejo de foco y
 * teclado: `aria-expanded`, navegación con flechas y Home/End vienen de fábrica.
 */
export function SeccionFiltro({
  valor,
  titulo,
  cantidadAplicada,
  children,
}: Readonly<{
  /** Identificador de la sección dentro del Accordion. */
  valor: string;
  titulo: string;
  cantidadAplicada: number;
  children: React.ReactNode;
}>) {
  return (
    <Accordion.Item
      value={valor}
      className="border-b border-border/60 last:border-b-0"
    >
      <Accordion.Header>
        <Accordion.Trigger className="group flex w-full items-center justify-between gap-3 py-4 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">
              {titulo}
            </span>
            {cantidadAplicada > 0 && (
              <span className="shrink-0 text-sm font-medium text-muted-foreground tabular-nums">
                ({cantidadAplicada})
              </span>
            )}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Accordion.Trigger>
      </Accordion.Header>

      {/* Las animaciones de alto salen de las variables que expone Radix. */}
      <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="pb-5">{children}</div>
      </Accordion.Content>
    </Accordion.Item>
  );
}
