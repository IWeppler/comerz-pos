import type { Rubro } from "@/entities/config/types";
import { normalizarClaveColumna } from "./columnas-archivo-ingreso";

/** Capacidad y tamaño ya significaban memoria y talle en otros rubros. */
export const ALIAS_CAPACIDAD = ["capacidad", "litros", "lts", "contenido", "tamaño"] as const;

export function esColumnaCapacidad(header: string, rubro?: Rubro): boolean {
  const clave = normalizarClaveColumna(header);
  return (rubro === "pintureria" && ALIAS_CAPACIDAD.some((a) => normalizarClaveColumna(a) === clave))
    || clave === "LITROS" || clave === "LTS";
}
