"use client";

import { useSyncExternalStore } from "react";

/**
 * ¿La pantalla es de celular? Mismo corte que el layout del POS
 * (`isPhoneLayout` en cart-panel-admin.tsx: hasta 639px).
 *
 * `useSyncExternalStore` y no estado + efecto: no hay un render intermedio
 * con el valor equivocado al montar, y en el server responde `false` (el
 * primer render del cliente se corrige solo).
 */
const CONSULTA = "(max-width: 639px)";

function suscribir(avisar: () => void) {
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

export function useEsCelular(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
}
