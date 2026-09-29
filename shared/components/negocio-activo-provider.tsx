"use client";

import { createContext, useContext } from "react";

export interface NegocioActivo {
  id: string;
  slug: string;
  nombre: string;
  /** Llave del módulo de presupuestos (solo la prende el super admin). */
  moduloPresupuestos: boolean;
}

const NegocioActivoContext = createContext<NegocioActivo | null>(null);

/**
 * Negocio en el que está trabajando el usuario, para el backoffice. Lo resuelve
 * el layout en el server (desde la membresía) y lo consumen los componentes que
 * arman links al catálogo público: sin el slug no hay a qué tienda apuntar, y
 * adivinar una sería mostrar la de otro comercio.
 */
export function NegocioActivoProvider({
  negocio,
  children,
}: Readonly<{ negocio: NegocioActivo | null; children: React.ReactNode }>) {
  return (
    <NegocioActivoContext.Provider value={negocio}>
      {children}
    </NegocioActivoContext.Provider>
  );
}

export function useNegocioActivo(): NegocioActivo | null {
  return useContext(NegocioActivoContext);
}

/** Slug del negocio activo, o null si todavía no se resolvió. */
export function useSlugNegocioActivo(): string | null {
  return useContext(NegocioActivoContext)?.slug ?? null;
}

/** ¿Se muestra el módulo de presupuestos? Fail-closed: sin negocio, no. Solo
 * esconde links y botones: la base lo exige por su cuenta
 * (`modulo_presupuestos_habilitado()` en la RPC). */
export function useModuloPresupuestos(): boolean {
  return useContext(NegocioActivoContext)?.moduloPresupuestos === true;
}
