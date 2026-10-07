"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { contarFiltrosAplicados } from "../../lib/filtros-url";
import { BOTON_CATALOGO } from "../../lib/estilos-catalogo";
import { FiltrosPanel } from "./filtros-panel";
import type { OrdenOption } from "../../lib/filtros-url";

/**
 * Barra que va arriba de la grilla.
 *
 * Desktop: cantidad de resultados a la izquierda y el orden a la derecha. Los
 * filtros no están acá — viven en el aside.
 *
 * Mobile: un solo botón "Filtros" que abre un panel desde arriba con TODO
 * adentro, incluido el orden. Meter el orden adentro del panel en vez de al
 * lado del botón libera media fila de pantalla, que en un catálogo es espacio
 * de producto.
 */
export function BarraCatalogo({
  totalResultados,
  propiedadesGlobales,
  filtrosVariantes,
  onToggleValor,
  onLimpiarFiltros,
  hayFiltrosActivos,
  orden,
  ordenOptions,
  onOrdenChange,
}: Readonly<{
  totalResultados: number;
  propiedadesGlobales: Record<string, string[]>;
  filtrosVariantes: Record<string, string[]>;
  onToggleValor: (propiedad: string, valor: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  orden: string;
  ordenOptions: OrdenOption[];
  onOrdenChange: (orden: string) => void;
}>) {
  const [panelAbierto, setPanelAbierto] = useState(false);
  const totalAplicados = contarFiltrosAplicados(filtrosVariantes);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {totalResultados}{" "}
        {totalResultados === 1 ? "producto" : "productos"}
      </p>

      {/* Disparador de mobile */}
      <Sheet open={panelAbierto} onOpenChange={setPanelAbierto}>
        <Button
          variant="outline"
          onClick={() => setPanelAbierto(true)}
          className="lg:hidden h-10 gap-2 text-xs font-semibold"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Filtros y orden
          {totalAplicados > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[10px] font-bold tabular-nums text-background">
              {totalAplicados}
            </span>
          )}
        </Button>

        {/* Mismo esquema que el panel del carrito: encabezado fijo con la X a
            la derecha, cuerpo que scrollea, y acciones fijas abajo. Sube desde
            abajo porque es donde está el pulgar.

            `showCloseButton={false}` porque el Sheet trae su propia X flotante
            arriba a la derecha, y ahí es donde chocaba con "Limpiar". Acá la X
            es parte del encabezado y "Limpiar" bajó al pie, junto a la acción
            principal. */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex max-h-[85dvh] flex-col rounded-t-2xl p-0"
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-5 py-4">
            <SheetTitle className="text-base">
              Filtros y orden
              {totalAplicados > 0 && (
                <span className="ml-1.5 text-sm font-medium text-muted-foreground tabular-nums">
                  ({totalAplicados})
                </span>
              )}
            </SheetTitle>
            <SheetClose asChild>
              <button
                type="button"
                aria-label="Cerrar filtros"
                className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </SheetClose>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            <FiltrosPanel
              propiedadesGlobales={propiedadesGlobales}
              filtrosVariantes={filtrosVariantes}
              onToggleValor={onToggleValor}
              onLimpiarFiltros={onLimpiarFiltros}
              hayFiltrosActivos={hayFiltrosActivos}
              orden={orden}
              ordenOptions={ordenOptions}
              onOrdenChange={onOrdenChange}
              mostrarOrden
              conEncabezado={false}
            />
          </div>

          {/* pb con safe-area: sin esto la barra de gestos de iOS se come el
              botón. */}
          <div className="shrink-0 border-t border-border bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-3">
              {hayFiltrosActivos && (
                <Button
                  variant="outline"
                  onClick={onLimpiarFiltros}
                  className="h-12 flex-1 text-sm font-semibold"
                >
                  Limpiar
                </Button>
              )}
              <Button
                onClick={() => setPanelAbierto(false)}
                className={`h-12 flex-1 text-sm font-semibold ${BOTON_CATALOGO}`}
              >
                Ver {totalResultados}{" "}
                {totalResultados === 1 ? "producto" : "productos"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Orden de desktop */}
      <div className="hidden lg:flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Ordenar por</span>
        <Select value={orden} onValueChange={onOrdenChange}>
          <SelectTrigger className="h-10 w-48 text-sm">
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent align="end">
            {ordenOptions.map((opcion) => (
              <SelectItem
                key={opcion.value}
                value={opcion.value}
                className="text-sm"
              >
                {opcion.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
