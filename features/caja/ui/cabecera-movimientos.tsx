"use client";

import { Search } from "lucide-react";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export type OpcionFiltroMovimientos = {
  valor: string;
  etiqueta: string;
};

export type FiltroCabeceraMovimientos = {
  valor: string;
  onChange: (valor: string) => void;
  valorTodos: string;
  etiquetaTodos: string;
  opciones: OpcionFiltroMovimientos[];
  ariaLabel: string;
  visible?: boolean;
};

/**
 * Cabecera compartida por las dos tablas que explican movimientos de caja.
 * Solo resuelve composición y responsive; búsqueda y filtros siguen siendo
 * estado del consumidor porque una tabla filtra en memoria y la otra en SQL.
 */
export function CabeceraMovimientos({
  titulo,
  cantidad,
  totalNeto,
  descripcion,
  busqueda,
  onBusquedaChange,
  placeholder = "Buscar movimiento…",
  filtros,
}: Readonly<{
  titulo: string;
  cantidad: number;
  totalNeto?: string;
  descripcion: string;
  busqueda: string;
  onBusquedaChange: (valor: string) => void;
  placeholder?: string;
  filtros: FiltroCabeceraMovimientos[];
}>) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-lg font-semibold">{titulo}</h3>
          <span className="font-mono text-lg font-medium text-foreground">
            ({cantidad})
          </span>
          {totalNeto !== undefined && (
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              · Neto: {totalNeto}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 min-w-0 w-full sm:w-52 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(evento) => onBusquedaChange(evento.target.value)}
            placeholder={placeholder}
            aria-label="Buscar movimientos"
            className="h-11 pl-8 text-xs"
          />
        </div>

        {filtros
          .filter((filtro) => filtro.visible !== false)
          .map((filtro) => (
            <Select
              key={filtro.ariaLabel}
              value={filtro.valor}
              onValueChange={filtro.onChange}
            >
              <SelectTrigger
                className="h-11 min-w-0 w-full justify-between text-xs sm:h-9 sm:w-auto"
                aria-label={filtro.ariaLabel}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={filtro.valorTodos}>
                  {filtro.etiquetaTodos}
                </SelectItem>
                {filtro.opciones.map((opcion) => (
                  <SelectItem key={opcion.valor} value={opcion.valor}>
                    {opcion.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
      </div>
    </div>
  );
}
