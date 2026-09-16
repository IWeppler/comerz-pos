import { create } from "zustand";
import type { ReciboCobroCC } from "@/features/clients/lib/recibo-cc";

/**
 * El recibo del último cobro de cuenta corriente, para mostrarlo e imprimirlo.
 *
 * Mismo patrón que `cobro-cc-store`, y por el mismo motivo: el cobro se
 * confirma desde DOS modales distintos (el global del POS/caja y el de la
 * ficha del cliente), y el papel es el mismo. El sheet del recibo se monta UNA
 * vez en el layout del panel y cualquiera de los dos lo abre poniendo acá el
 * recibo que le devolvió el server.
 */
interface ReciboCcState {
  recibo: ReciboCobroCC | null;
  mostrar: (recibo: ReciboCobroCC) => void;
  cerrar: () => void;
}

export const useReciboCcStore = create<ReciboCcState>((set) => ({
  recibo: null,
  mostrar: (recibo) => set({ recibo }),
  cerrar: () => set({ recibo: null }),
}));
