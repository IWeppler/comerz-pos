"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { EstadoCliente } from "../lib/clasificar-estado-cliente";

/** "a_abonar": los que tienen que pagar en el ciclo de cobro (solo comercios
 * con cierre mensual; ver `useAvisosCc`). */
export type ClientStatusFilter = "todos" | EstadoCliente | "a_abonar";

type Opcion = {
  value: ClientStatusFilter;
  label: string;
  activeClassName: string;
  hoverClassName: string;
};

const OPTIONS: Opcion[] = [
  {
    value: "todos",
    label: "Todos",
    activeClassName: "bg-background text-foreground",
    hoverClassName: "hover:text-foreground",
  },
  {
    value: "al_dia",
    label: "Al día",
    activeClassName: "bg-background text-success",
    hoverClassName: "hover:text-success/90",
  },
  {
    value: "con_deuda",
    label: "Con deuda",
    activeClassName: "bg-background text-warning",
    hoverClassName: "hover:text-warning",
  },
  {
    value: "vencido",
    label: "Vencido",
    activeClassName: "bg-background text-danger",
    hoverClassName: "hover:text-danger/90",
  },
];

interface ClientStatusFilterControlProps {
  value: ClientStatusFilter;
  onChange: (value: ClientStatusFilter) => void;
  /** La opción del ciclo de cobro ("A abonar 15/10"). Sin ella, el control
   * es el de siempre: solo existe en comercios con cierre mensual. */
  etiquetaCiclo?: string | null;
}

export function ClientStatusFilterControl({
  value,
  onChange,
  etiquetaCiclo,
}: Readonly<ClientStatusFilterControlProps>) {
  const opciones: Opcion[] = etiquetaCiclo
    ? [
        ...OPTIONS,
        {
          value: "a_abonar",
          label: etiquetaCiclo,
          activeClassName: "bg-background text-primary",
          hoverClassName: "hover:text-primary",
        },
      ]
    : OPTIONS;

  return (
    <>
      {/* Desktop/tablet: segmented control */}
      <div className="hidden sm:flex sm:gap-1 sm:bg-muted sm:p-1 sm:rounded-xl sm:border sm:border-border/50 sm:w-auto sm:items-center">
        {opciones.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-2 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
              value === option.value
                ? option.activeClassName
                : `text-muted-foreground ${option.hoverClassName}`
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Mobile: select (4 o 5 opciones no entran cómodas en tabs) */}
      <div className="sm:hidden w-full">
        <Select
          value={value}
          onValueChange={(next) => onChange(next as ClientStatusFilter)}
        >
          <SelectTrigger className="h-10 w-full bg-muted border border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {opciones.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
