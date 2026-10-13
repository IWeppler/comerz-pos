"use client";

import type { ReactNode } from "react";
import { create } from "zustand";
import {
  AnimatedToastStack,
  type AnimatedToast,
  type ToastStatus,
} from "@/shared/ui/animated-toast-stack";

/**
 * Los avisos de la app (13/10/2026: reemplazan a Sonner por el
 * `animated-toast-stack` de beui).
 *
 * La API es la MISMA que se usaba de Sonner —`toast.success("…")`,
 * `toast.error("…", { description, duration, action, cancel, id })`— para que
 * los ~110 archivos que avisan algo no cambien más que el import. El componente
 * de beui no trae una función global (solo un hook con estado local), así que
 * el estado vive acá, en un store, y `<Toaster />` lo dibuja una sola vez.
 *
 * Lo de Sonner que se acepta y se ignora: `closeButton` (todo aviso tiene su
 * cruz), `style` y `position` (todos van abajo al medio).
 */

type Accion = { label: ReactNode; onClick: (evento?: unknown) => void };

export type OpcionesToast = {
  /** Mismo id = reemplaza al aviso anterior en vez de apilar otro. */
  id?: string | number;
  description?: ReactNode;
  /** En ms. `Infinity` (o 0) = queda hasta que lo cierren. */
  duration?: number;
  action?: Accion;
  cancel?: Accion;
  closeButton?: boolean;
  style?: unknown;
  position?: unknown;
};

// Un error se lee más despacio que un "Guardado": queda más tiempo.
const DURACION: Record<ToastStatus, number> = {
  neutral: 4000,
  info: 4000,
  loading: 0,
  success: 4000,
  warning: 6000,
  error: 6000,
};

// Más de tres apilados ya no se leen; los más viejos se van.
const MAXIMO = 3;

interface ToastState {
  toasts: AnimatedToast[];
  mostrar: (t: AnimatedToast) => void;
  cerrar: (id?: string) => void;
}

const timers = new Map<string, number>();

function programarCierre(id: string, duracion: number | undefined, cerrar: (id: string) => void) {
  const anterior = timers.get(id);
  if (anterior) window.clearTimeout(anterior);
  timers.delete(id);
  if (!duracion || !Number.isFinite(duracion) || duracion <= 0) return;
  timers.set(id, window.setTimeout(() => cerrar(id), duracion));
}

const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  mostrar: (t) => {
    set((estado) => {
      const existe = estado.toasts.some((x) => x.id === t.id);
      const siguiente = existe
        ? estado.toasts.map((x) => (x.id === t.id ? t : x))
        : [...estado.toasts, t];
      return { toasts: siguiente.slice(-MAXIMO) };
    });
    programarCierre(t.id, t.duration, (id) => get().cerrar(id));
  },
  cerrar: (id) => {
    if (id === undefined) {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      set({ toasts: [] });
      return;
    }
    const timer = timers.get(id);
    if (timer) window.clearTimeout(timer);
    timers.delete(id);
    set((estado) => ({ toasts: estado.toasts.filter((x) => x.id !== id) }));
  },
}));

let semilla = 0;

function crear(status: ToastStatus, titulo: ReactNode, opciones: OpcionesToast = {}): string {
  const id = opciones.id !== undefined ? String(opciones.id) : `t-${Date.now()}-${semilla++}`;
  const { cerrar, mostrar } = useToastStore.getState();
  // Un botón del aviso hace lo suyo y cierra el aviso, como en Sonner.
  const envolver = (accion?: Accion) =>
    accion && {
      label: accion.label,
      onClick: () => {
        accion.onClick();
        cerrar(id);
      },
    };
  const duracion = opciones.duration ?? DURACION[status];
  mostrar({
    id,
    title: titulo,
    description: opciones.description,
    status,
    action: envolver(opciones.action),
    cancel: envolver(opciones.cancel),
    duration: Number.isFinite(duracion) ? duracion : 0,
    dismissible: true,
    createdAt: Date.now(),
  });
  return id;
}

type ToastFn = ((titulo: ReactNode, opciones?: OpcionesToast) => string) & {
  success: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  error: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  warning: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  info: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  message: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  loading: (titulo: ReactNode, opciones?: OpcionesToast) => string;
  dismiss: (id?: string | number) => void;
};

export const toast: ToastFn = Object.assign(
  (titulo: ReactNode, opciones?: OpcionesToast) => crear("neutral", titulo, opciones),
  {
    success: (titulo: ReactNode, opciones?: OpcionesToast) => crear("success", titulo, opciones),
    error: (titulo: ReactNode, opciones?: OpcionesToast) => crear("error", titulo, opciones),
    warning: (titulo: ReactNode, opciones?: OpcionesToast) => crear("warning", titulo, opciones),
    info: (titulo: ReactNode, opciones?: OpcionesToast) => crear("info", titulo, opciones),
    message: (titulo: ReactNode, opciones?: OpcionesToast) => crear("neutral", titulo, opciones),
    loading: (titulo: ReactNode, opciones?: OpcionesToast) => crear("loading", titulo, opciones),
    dismiss: (id?: string | number) => useToastStore.getState().cerrar(id === undefined ? undefined : String(id)),
  },
);

/**
 * Dónde se dibujan. Montado UNA vez, en el layout raíz.
 *
 * Abajo al medio, como estaba con Sonner: es donde mira la vendedora después
 * de tocar "Cobrar". En la esquina derecha el aviso de "venta registrada"
 * pasaba desapercibido y se cobraba dos veces.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const cerrar = useToastStore((s) => s.cerrar);
  return (
    <AnimatedToastStack
      toasts={toasts}
      onDismiss={cerrar}
      position="bottom-center"
      placement="fixed"
      maxVisible={MAXIMO}
    />
  );
}
