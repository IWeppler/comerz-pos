"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { Producto } from "@/entities/productos/types";
import { getIndiceCatalogoPublicoAction } from "@/shared/actions/indice-catalogo-publico";

interface CatalogoPublicoContexto {
  indice: Producto[] | null;
  error: string | null;
  cargarIndice: () => Promise<void>;
}

const CatalogoPublicoContext = createContext<CatalogoPublicoContexto | null>(null);

/** Una sola descarga por tienda, compartida por grilla y buscador. En la ficha
 * se descarga recién al abrir la búsqueda. No hay cache global entre tenants. */
export function CatalogoPublicoProvider({ children }: { children: React.ReactNode }) {
  const [indice, setIndice] = useState<Producto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pedido = useRef<Promise<void> | null>(null);
  const cargado = useRef(false);

  const cargarIndice = useCallback(() => {
    if (cargado.current) return Promise.resolve();
    if (pedido.current) return pedido.current;
    setError(null);
    pedido.current = getIndiceCatalogoPublicoAction()
      .then((res) => {
        if (res.error || !res.data) throw new Error(res.error || "Sin índice");
        cargado.current = true;
        setIndice(res.data);
      })
      .catch(() => setError("No pudimos cargar los productos. Intentá de nuevo."))
      .finally(() => { pedido.current = null; });
    return pedido.current;
  }, []);

  return (
    <CatalogoPublicoContext.Provider value={{ indice, error, cargarIndice }}>
      {children}
    </CatalogoPublicoContext.Provider>
  );
}

export function useCatalogoPublico() {
  const contexto = useContext(CatalogoPublicoContext);
  if (!contexto) throw new Error("Falta CatalogoPublicoProvider");
  return contexto;
}
