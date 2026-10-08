import { create } from "zustand";
export const useElegirCaminoStore = create<{
  abierto: boolean;
  setAbierto: (abierto: boolean) => void;
  refrescarNegocioId: string | null;
  pedirRefresco: (negocioId: string) => void;
  consumirRefresco: () => void;
}>((set) => ({
  abierto: false,
  setAbierto: (abierto) => set({ abierto }),
  refrescarNegocioId: null,
  pedirRefresco: (refrescarNegocioId) => set({ refrescarNegocioId }),
  consumirRefresco: () => set({ refrescarNegocioId: null }),
}));
