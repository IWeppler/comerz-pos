"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/shared/config/supabase/client";

/** Cómo se llama el topic de un negocio. Tiene que decir lo mismo que el
 * trigger `pedidos_broadcast_cambio` y la policy `pedidos_broadcast_miembros`
 * (migración 20260916120000). */
export const topicPedidos = (negocioId: string) => `pedidos:${negocioId}`;

/**
 * Se suscribe a los cambios de `pedidos` del negocio activo y llama
 * `onCambio` en cada uno. La SEÑAL viene por Supabase Realtime Broadcast; los
 * DATOS no: el llamador invalida su query y los vuelve a pedir por el camino
 * de siempre. Así el payload del mensaje puede cambiar (o no venir) sin que la
 * pantalla se desincronice.
 *
 * Aislamiento: el canal es PRIVADO y solo se puede unir quien pasa la policy
 * de `realtime.messages` — pertenencia directa en `usuarios_negocios` al
 * negocio del topic, o super admin. No pasa por `current_negocio_id()`, que
 * en Realtime no tiene header y para quien tiene dos negocios devuelve null.
 *
 * Un solo canal por negocio y por pestaña: el efecto depende SOLO de
 * `negocioId`, y `onCambio` viaja por ref para que un render con una función
 * nueva no cierre y reabra el websocket. Al cambiar de negocio o desmontar,
 * el cleanup lo saca con `removeChannel`; con StrictMode el doble montaje
 * pasa por ese mismo cleanup.
 *
 * SI EL WEBSOCKET SE CAE: supabase-js reintenta solo con backoff. Mientras
 * tanto no llega ninguna señal —por eso el llamador mantiene un polling lento
 * y `refetchOnReconnect`—, y cuando el canal vuelve a `SUBSCRIBED` se llama
 * `onCambio` una vez, para recuperar lo que haya pasado en el medio sin
 * esperar al próximo intervalo. Un canal que no logra unirse (policy que
 * rechaza, sesión vencida) queda en CHANNEL_ERROR: se loguea y la pantalla
 * sigue viva por el polling. Nunca se cae a un error visible: la señal es un
 * atajo, no un requisito.
 */
export function usePedidosRealtime(
  negocioId: string | null,
  onCambio: () => void,
) {
  const onCambioRef = useRef(onCambio);
  useEffect(() => {
    onCambioRef.current = onCambio;
  }, [onCambio]);

  useEffect(() => {
    if (!negocioId) return;

    const supabase = createClient();
    const topic = topicPedidos(negocioId);
    // Al primer SUBSCRIBED no hace falta refrescar: la query recién montó y
    // ya está pidiendo. A partir del segundo (reconexión) sí.
    let yaEstuvoSuscripto = false;
    let cancelado = false;

    const canal = supabase
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "*" }, () => {
        onCambioRef.current();
      });

    // El canal privado se autoriza con el JWT del usuario: hay que pasárselo
    // al cliente de Realtime ANTES de unirse. supabase-js lo hace solo al
    // cambiar la sesión, pero si este efecto corre antes de que llegue
    // `INITIAL_SESSION` el join saldría con la publishable key y la policy lo
    // rechazaría. Llamarlo explícito cierra esa carrera.
    void supabase.realtime.setAuth().then(() => {
      if (cancelado) return;
      canal.subscribe((estado, err) => {
        if (estado === "SUBSCRIBED") {
          if (yaEstuvoSuscripto) onCambioRef.current();
          yaEstuvoSuscripto = true;
          return;
        }
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
          console.warn(`[PEDIDOS REALTIME] canal ${topic}: ${estado}`, err);
        }
      });
    });

    return () => {
      cancelado = true;
      void supabase.removeChannel(canal);
    };
  }, [negocioId]);
}
