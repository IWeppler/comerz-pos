import { create } from "zustand";
import { getAlertasCajaPendientesAction } from "@/features/caja/actions/auditoria-caja";

/**
 * Cuántas alertas de caja hay sin revisar (/caja → Auditoría). Lo leen el
 * link de Caja del menú y la pestaña Auditoría; lo refresca el polling del
 * Sidebar y la propia pestaña cuando alguien marca una como revisada, así el
 * número del menú baja en el acto y no al minuto siguiente.
 */
interface AlertasCajaState {
  pendientes: number;
  refrescar: () => Promise<void>;
  setPendientes: (n: number) => void;
}

export const useAlertasCajaStore = create<AlertasCajaState>((set) => ({
  pendientes: 0,
  refrescar: async () => {
    try {
      set({ pendientes: await getAlertasCajaPendientesAction() });
    } catch {
      // Un aviso que no se pudo calcular no es un error para mostrar.
    }
  },
  setPendientes: (n) => set({ pendientes: n }),
}));
