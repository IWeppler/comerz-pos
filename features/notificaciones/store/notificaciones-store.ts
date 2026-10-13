import { create } from "zustand";
import { getNotificacionesSinLeerAction } from "@/features/notificaciones/actions/notificaciones";

/**
 * El contador de la campana, compartido. Hay DOS campanas montadas a la vez
 * (la del navbar de compu y la del header del celular; una de las dos está
 * oculta por CSS) y las dos leen este número: así se pide una vez y no dos.
 */
interface NotificacionesState {
  sinLeer: number;
  setSinLeer: (n: number) => void;
  /** Pide el contador a la base. Si ya hay un pedido en vuelo, no pide otro. */
  refrescar: () => Promise<void>;
}

let enVuelo: Promise<void> | null = null;

export const useNotificacionesStore = create<NotificacionesState>((set) => ({
  sinLeer: 0,
  setSinLeer: (n) => set({ sinLeer: Math.max(0, n) }),
  refrescar: () => {
    if (enVuelo) return enVuelo;
    enVuelo = getNotificacionesSinLeerAction()
      .then((n) => set({ sinLeer: n }))
      .catch(() => {
        // Sin red o sin sesión: el número que había queda como estaba.
      })
      .finally(() => {
        enVuelo = null;
      });
    return enVuelo;
  },
}));
