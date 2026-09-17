import { create } from "zustand";

/**
 * Abre el renglón de venta libre del ticket desde cualquier parte del POS.
 *
 * Mismo patrón que `cobro-cc-store`: el formulario vive UNA vez, adentro del
 * ticket (`VentaLibreInline`), y tiene tres disparadores que no son sus
 * padres — la tecla V, el botón de la grilla cuando la búsqueda no encuentra
 * nada ("Vender 'X' sin cargarlo") y el botón del propio ticket. La grilla y
 * el ticket son hermanos en el layout, así que sin un store el texto buscado
 * no tendría por dónde llegar al formulario.
 */
interface VentaLibreState {
  abierto: boolean;
  /** Con qué descripción arranca el formulario (lo que se buscó y no
   * estaba). Se consume al abrir y se borra al cerrar. */
  descripcionInicial: string;
  /** Sube en cada `abrir`: es lo que le avisa al formulario que tiene que
   * volver a tomar `descripcionInicial` aunque ya estuviera abierto. */
  apertura: number;
  abrir: (descripcionInicial?: string) => void;
  cerrar: () => void;
}

export const useVentaLibreStore = create<VentaLibreState>((set) => ({
  abierto: false,
  descripcionInicial: "",
  apertura: 0,
  abrir: (descripcionInicial = "") =>
    set((s) => ({
      abierto: true,
      descripcionInicial,
      apertura: s.apertura + 1,
    })),
  cerrar: () => set({ abierto: false, descripcionInicial: "" }),
}));
