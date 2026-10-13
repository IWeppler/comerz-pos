"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useNotificacionesStore } from "@/features/notificaciones/store/notificaciones-store";

/**
 * Refresca el contador de la campana AL NAVEGAR (decisión 4 de
 * docs/notificaciones.md: sin polling ni Realtime, por egress). Una consulta
 * liviana por cambio de pantalla. Montado UNA vez en el layout.
 */
export function SincronizadorNotificaciones() {
  const pathname = usePathname();
  const refrescar = useNotificacionesStore((s) => s.refrescar);

  useEffect(() => {
    void refrescar();
  }, [pathname, refrescar]);

  return null;
}
