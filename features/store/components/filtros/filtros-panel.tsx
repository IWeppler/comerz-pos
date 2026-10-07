"use client";

import { Accordion } from "radix-ui";
import { Button } from "@/shared/ui/button";
import { esPropiedadColor } from "@/entities/productos/lib/color-familias";
import { normalizarParaComparar } from "@/entities/productos/lib/parse-variant-attributes";
import {
  contarFiltrosAplicados,
  estaSeleccionado,
  ordenarSeccionesFiltro,
} from "../../lib/filtros-url";
import { ColorSwatches } from "../color-swatches";
import { SeccionFiltro } from "./seccion-filtro";
import type { OrdenOption } from "../../lib/filtros-url";

/**
 * Panel de filtros del catálogo. Es el MISMO componente para el aside de
 * desktop y el panel de mobile — si fueran dos, se irían separando solos.
 *
 * Reemplaza a los dropdowns anteriores: cada propiedad es una persiana
 * desplegable y se pueden elegir VARIOS valores por propiedad (varios colores,
 * varios talles), no uno solo como antes.
 *
 * El orden de las secciones lo decide ordenarSeccionesFiltro: Talle va último
 * porque es la lista más larga y arriba empujaba todo fuera de la pantalla.
 */
export function FiltrosPanel({
  propiedadesGlobales,
  filtrosVariantes,
  onToggleValor,
  onLimpiarFiltros,
  hayFiltrosActivos,
  orden,
  ordenOptions,
  onOrdenChange,
  mostrarOrden = false,
  conEncabezado = true,
}: Readonly<{
  propiedadesGlobales: Record<string, string[]>;
  filtrosVariantes: Record<string, string[]>;
  onToggleValor: (propiedad: string, valor: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  orden: string;
  ordenOptions: OrdenOption[];
  onOrdenChange: (orden: string) => void;
  /** En mobile el orden entra como una sección más del panel, para no gastar
   * una fila entera de pantalla en un selector. En desktop vive arriba de la
   * grilla y acá no se muestra. */
  mostrarOrden?: boolean;
  /** En mobile el encabezado ya lo pone el panel deslizable — repetirlo acá
   * daba dos títulos pegados ("Filtros y orden" arriba de "Filtros (1)"). */
  conEncabezado?: boolean;
}>) {
  const secciones = ordenarSeccionesFiltro(Object.entries(propiedadesGlobales));
  const totalAplicados = contarFiltrosAplicados(filtrosVariantes);

  // Arrancan abiertas las secciones cortas y las que ya tienen algo elegido.
  // Talle arranca cerrada salvo que esté en uso: abierta ocupa media pantalla.
  const abiertasPorDefecto = [
    ...(mostrarOrden ? ["__orden"] : []),
    ...secciones
      .filter(([nombre, valores]) => {
        if ((filtrosVariantes[nombre] ?? []).length > 0) return true;
        return valores.length <= 12;
      })
      .map(([nombre]) => nombre),
  ];

  return (
    <div>
      {conEncabezado && (
        <div className="flex items-center justify-between gap-3 pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            Filtros
            {totalAplicados > 0 && (
              <span className="ml-1.5 font-medium text-muted-foreground tabular-nums">
                ({totalAplicados})
              </span>
            )}
          </h2>
          {hayFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLimpiarFiltros}
              className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </Button>
          )}
        </div>
      )}

      <Accordion.Root
        type="multiple"
        defaultValue={abiertasPorDefecto}
        className="border-t border-border/60"
      >
        {mostrarOrden && (
          <SeccionFiltro valor="__orden" titulo="Ordenar por" cantidadAplicada={0}>
            <div className="flex flex-col gap-1">
              {ordenOptions.map((opcion) => {
                const activo = orden === opcion.value;
                return (
                  <button
                    key={opcion.value}
                    type="button"
                    onClick={() => onOrdenChange(opcion.value)}
                    aria-pressed={activo}
                    className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      activo
                        ? "bg-muted font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    {opcion.label}
                  </button>
                );
              })}
            </div>
          </SeccionFiltro>
        )}

        {secciones.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            No hay filtros disponibles para esta selección.
          </p>
        )}

        {secciones.map(([propiedad, valores]) => {
          const seleccion = filtrosVariantes[propiedad] ?? [];

          return (
            <SeccionFiltro
              key={propiedad}
              valor={propiedad}
              titulo={propiedad}
              cantidadAplicada={seleccion.length}
            >
              {esPropiedadColor(propiedad) ? (
                <ColorSwatches
                  valores={valores}
                  seleccion={seleccion}
                  onToggle={(valor) => onToggleValor(propiedad, valor)}
                />
              ) : esPropiedadTalle(propiedad) ? (
                <PillsOpciones
                  valores={valores}
                  seleccion={seleccion}
                  onToggle={(valor) => onToggleValor(propiedad, valor)}
                />
              ) : (
                <ListaOpciones
                  valores={valores}
                  seleccion={seleccion}
                  onToggle={(valor) => onToggleValor(propiedad, valor)}
                />
              )}
            </SeccionFiltro>
          );
        })}
      </Accordion.Root>
    </div>
  );
}

function esPropiedadTalle(nombrePropiedad: string): boolean {
  return normalizarParaComparar(nombrePropiedad).includes("talle");
}

/**
 * Talles en grilla de pills, 3 por fila.
 *
 * Los valores son cortos ("S", "M", "38") y son muchos: en lista vertical con
 * checkbox ocupaban una pantalla entera y el área clickeable era la del
 * cuadradito. Como pill, cada opción es un blanco táctil de 44px de alto y
 * entran tres por fila.
 */
function PillsOpciones({
  valores,
  seleccion,
  onToggle,
}: Readonly<{
  valores: string[];
  seleccion: string[];
  onToggle: (valor: string) => void;
}>) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {valores.map((valor) => {
        const marcado = estaSeleccionado(seleccion, valor);
        return (
          <button
            key={valor}
            type="button"
            onClick={() => onToggle(valor)}
            aria-pressed={marcado}
            className={`h-11 rounded-lg border px-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 ${
              marcado
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground hover:border-foreground/40 hover:bg-muted"
            }`}
          >
            <span className="block truncate">{valor}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Opciones no-color. Son checkboxes de verdad (input type=checkbox) y no
 * botones con `aria-pressed`: la multiselección con lector de pantalla se
 * anuncia mejor como un grupo de casillas.
 */
function ListaOpciones({
  valores,
  seleccion,
  onToggle,
}: Readonly<{
  valores: string[];
  seleccion: string[];
  onToggle: (valor: string) => void;
}>) {
  return (
    <div className="flex flex-col gap-0.5">
      {valores.map((valor) => {
        const marcado = estaSeleccionado(seleccion, valor);
        return (
          <label
            key={valor}
            className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-muted/60"
          >
            <input
              type="checkbox"
              checked={marcado}
              onChange={() => onToggle(valor)}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-foreground"
            />
            <span
              className={`text-sm ${marcado ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {valor}
            </span>
          </label>
        );
      })}
    </div>
  );
}
