"use client";

import { useEffect } from "react";
import { toast } from "@/shared/ui/toast";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useVentasPendientesStore } from "@/shared/store/ventas-pendientes-store";

/** Cada cuánto se reintenta con la app abierta. Un minuto es suficiente: el
 * evento `online` ya cubre la vuelta de la señal, y esto es la red de
 * seguridad para el caso más común del local — wifi "conectado" que no llega a
 * ningún lado, donde `online` nunca se dispara. */
const REINTENTO_MS = 60 * 1000;

/**
 * Sube las ventas cobradas sin señal, sin que nadie tenga que pedirlo.
 *
 * Se monta UNA vez en el layout del panel, igual que la paleta de comandos y
 * el modal de caja: dos instancias serían dos sincronizaciones compitiendo.
 *
 * Corre al abrir la app, cuando vuelve la conexión y cada minuto. No hay
 * Background Sync en iOS, así que esto es todo lo que hay: **con la app
 * cerrada no sube nada**. De ahí la regla de no poder cerrar el turno con
 * ventas pendientes — el cierre es el momento del día en que alguien está
 * seguro mirando la pantalla.
 */
export function SincronizadorVentas() {
  const negocioId = useNegocioActivo()?.id ?? null;
  const refrescar = useVentasPendientesStore((s) => s.refrescar);
  const sincronizar = useVentasPendientesStore((s) => s.sincronizar);

  useEffect(() => {
    if (!negocioId) return;

    let vivo = true;

    const intentar = async () => {
      if (!vivo) return;
      const subidas = await sincronizar(negocioId);
      if (!vivo || subidas === 0) return;

      toast.success(
        subidas === 1
          ? "Se sincronizó 1 venta que estaba pendiente"
          : `Se sincronizaron ${subidas} ventas que estaban pendientes`,
      );
    };

    void refrescar(negocioId).then(intentar);

    const reloj = setInterval(intentar, REINTENTO_MS);
    window.addEventListener("online", intentar);

    return () => {
      vivo = false;
      clearInterval(reloj);
      window.removeEventListener("online", intentar);
    };
  }, [negocioId, refrescar, sincronizar]);

  return null;
}
