"use client";

import { useEffect } from "react";
import { createClient } from "@/shared/config/supabase/client";
import { reportarErrorCliente } from "@/shared/lib/reportar-error-cliente";
import { salirPorSesionMuerta } from "@/shared/lib/sesion-muerta-cliente";

/**
 * Se monta una vez en el layout del panel. Saca de la app a una pestaña cuya
 * sesión murió, en vez de dejarla corriendo como anónima.
 *
 * Es la señal SEMÁNTICA de la sesión zombie del 12/9/2026 (ver
 * `sesion-muerta-cliente.ts` para el incidente): el 401 de PostgREST es la red
 * de seguridad, pero lo primero que hay que escuchar es lo que auth-js sabe.
 *
 *  - `SIGNED_OUT`: auth-js borró la sesión, sea porque un refresh fue
 *    rechazado con el access token ya vencido (logout en otra ventana, sesión
 *    revocada) o porque `signOut()` corrió en esta pestaña. En los dos casos el
 *    lugar correcto es el login, y `/auth/salir` es el que limpia cookies.
 *
 *  - `visibilitychange` → visible: la PWA de iOS vuelve del fondo con timers
 *    frenados y, a veces, con las cookies borradas por otra ventana del mismo
 *    frasco. `getSession()` acá refresca si hace falta (red) y devuelve null si
 *    no hay nada que refrescar. Se chequea al VOLVER, no en cada navegación:
 *    el logout voluntario redirige a /auth desde una pestaña que ya está al
 *    frente, y no tiene que cruzarse con esto.
 *
 * `salirPorSesionMuerta` se cuida solo de no correr dos veces ni desde /auth.
 */
export function VigilanteSesion() {
  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento) => {
      if (evento !== "SIGNED_OUT") return;
      if (salirPorSesionMuerta()) {
        reportarErrorCliente({
          tipo: "sesion-muerta",
          mensaje: "SIGNED_OUT de auth-js con el panel abierto: se sale por /auth/salir.",
        });
      }
    });

    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) return;
        if (salirPorSesionMuerta()) {
          reportarErrorCliente({
            tipo: "sesion-muerta",
            mensaje:
              "Sin sesión al volver al frente (PWA en segundo plano): se sale por /auth/salir.",
          });
        }
      });
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  return null;
}
