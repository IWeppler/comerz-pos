"use client";
import { create } from "zustand";

const clave = (id: string) => `comerz:wizard-inicio:${id}`;
interface WizardInicioState {
  negocioId: string | null;
  activo: boolean;
  ticketConLineas: boolean;
  ventaExitosa: boolean;
  cargar: (id: string) => void;
  iniciar: (id: string) => void;
  salir: () => void;
  actualizarTicket: (conLineas: boolean, ventaExitosa: boolean) => void;
}
export const useWizardInicioStore = create<WizardInicioState>((set, get) => ({
  negocioId: null,
  activo: false,
  ticketConLineas: false,
  ventaExitosa: false,
  cargar: (id) => {
    if (get().negocioId === id) return;
    let activo = false;
    try {
      activo = localStorage.getItem(clave(id)) === "1";
    } catch {}
    set({ negocioId: id, activo, ticketConLineas: false, ventaExitosa: false });
  },
  iniciar: (id) => {
    try {
      localStorage.setItem(clave(id), "1");
    } catch {}
    set({ negocioId: id, activo: true, ventaExitosa: false });
  },
  salir: () => {
    const id = get().negocioId;
    if (id) {
      try {
        localStorage.removeItem(clave(id));
      } catch {}
    }
    set({ activo: false });
  },
  actualizarTicket: (ticketConLineas, ventaExitosa) =>
    set({ ticketConLineas, ventaExitosa }),
}));
