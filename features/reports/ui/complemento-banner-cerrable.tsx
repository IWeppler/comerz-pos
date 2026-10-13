"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";

const CLAVE = "complemento-banner-cerrado";

/** Respaldo cuando no hay localStorage (modo privado): dura hasta recargar. */
let cerradoEnMemoria: string | null = null;

/** Avisa a los suscriptores cuando esta pestaña cierra el banner. */
const suscriptores = new Set<() => void>();

function suscribir(avisar: () => void) {
  suscriptores.add(avisar);
  // Otra pestaña que lo cierra también lo esconde acá.
  window.addEventListener("storage", avisar);
  return () => {
    suscriptores.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function leerCerrado(): string | null {
  try {
    return localStorage.getItem(CLAVE) ?? cerradoEnMemoria;
  } catch {
    return cerradoEnMemoria;
  }
}

/**
 * El banner de asociaciones del panel, con una X para sacarlo. Recuerda QUÉ
 * sugerencia se cerró (`sugerencia`, el par de productos): esa no vuelve, y el
 * banner reaparece solo cuando el análisis sugiere un par distinto.
 */
export function ComplementoBannerCerrable({
  sugerencia,
  children,
}: {
  sugerencia: string;
  children: ReactNode;
}) {
  // En el servidor no hay localStorage: no se pinta, y al hidratar se decide.
  // Así quien ya lo cerró no lo ve aparecer y desaparecer.
  const cerrado = useSyncExternalStore(suscribir, leerCerrado, () => sugerencia);
  if (cerrado === sugerencia) return null;

  const cerrar = () => {
    cerradoEnMemoria = sugerencia;
    try {
      localStorage.setItem(CLAVE, sugerencia);
    } catch {
      // Sin almacenamiento (modo privado): igual se esconde hasta recargar.
    }
    suscriptores.forEach((avisar) => avisar());
  };

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar sugerencia de asociación"
        className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
