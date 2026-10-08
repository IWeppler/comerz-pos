import { create } from "zustand";

/**
 * Abre el modal de caja desde cualquier parte de la app.
 *
 * El modal vive dentro de CajaStatusButton (el chip "Caja abierta / Caja
 * cerrada" del navbar), que es el único lugar donde se abre y se cierra el
 * turno. Antes su estado era local, así que nada fuera del navbar podía
 * disparar ese modal, y todo lo que quería mandar a "abrí la caja" terminaba
 * navegando a /caja — que muestra el historial y los arqueos, pero NO es donde
 * se abre el turno. El usuario llegaba a una pantalla que no tenía el botón
 * que le prometieron.
 *
 * El estado sube al store en vez de duplicar el modal: dos instancias serían
 * dos turnos abriéndose en paralelo, cada una con su copia del formulario.
 */
interface CajaModalState {
  abierto: boolean;
  abrir: () => void;
  setAbierto: (abierto: boolean) => void;
  /**
   * Hay un modal montado que responda a `abrir()`. El chip del navbar solo se
   * monta para quien opera caja; sin él, `abrir()` no muestra nada. Quien
   * quiera mandar a abrir la caja pregunta esto primero, para decirle a la
   * vendedora sin permiso que se lo pida a otra persona en vez de prometerle
   * un modal que no va a aparecer.
   */
  disponible: boolean;
  setDisponible: (disponible: boolean) => void;
}

export const useCajaModalStore = create<CajaModalState>((set) => ({
  abierto: false,
  abrir: () => set({ abierto: true }),
  setAbierto: (abierto) => set({ abierto }),
  disponible: false,
  setDisponible: (disponible) => set({ disponible }),
}));
