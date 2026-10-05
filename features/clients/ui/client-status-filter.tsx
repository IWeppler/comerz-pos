"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { EstadoCliente } from "../lib/clasificar-estado-cliente";

export type ClientStatusFilter = "todos" | EstadoCliente;

const OPTIONS: { value: ClientStatusFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "al_dia", label: "Al día" },
  { value: "con_deuda", label: "Con deuda" },
  { value: "vencido", label: "Vencido" },
];

interface ClientStatusFilterControlProps {
  value: ClientStatusFilter;
  onChange: (value: ClientStatusFilter) => void;
}

/**
 * El estado del cliente, como select en todos los tamaños (antes eran tabs
 * en desktop). El ciclo de cobro ("A abonar") va aparte, en
 * `FiltroCicloCobro`: se combina con este, no es un estado más.
 */
export function ClientStatusFilterControl({
  value,
  onChange,
}: Readonly<ClientStatusFilterControlProps>) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ClientStatusFilter)}
    >
      <SelectTrigger
        aria-label="Estado del cliente"
        className="h-10 w-full sm:w-40 bg-muted border border-border rounded-xl"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
