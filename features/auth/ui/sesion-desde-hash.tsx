"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/shared/config/supabase/client";

/**
 * Red de seguridad para los links de mail viejos.
 *
 * Con el template anterior (`{{ .ConfirmationURL }}`) GoTrue deja la sesión en
 * el HASH de la URL (`#access_token=…&type=invite`), y esta página no tenía
 * quién lo leyera: el server action de la contraseña corría sin sesión y
 * fallaba. El template nuevo va por `/auth/confirm` y llega con cookies, pero
 * un mail ya enviado sigue trayendo el hash — y una invitación dura 7 días.
 *
 * Esto monta el cliente de navegador SOLO si hay un hash con token: auth-js lo
 * detecta al inicializar (`detectSessionInUrl`), lo guarda en las cookies, y
 * acá se limpia la URL y se refresca el árbol de servidor para que el form ya
 * corra con sesión. Sin hash no hace nada.
 */
export function SesionDesdeHash({ children }: { children: React.ReactNode }) {
  // `useSyncExternalStore` con snapshot de servidor en `false`: el server no
  // ve el hash, y así la hidratación no discute con el cliente.
  const procesando = useSyncExternalStore(
    suscribirNada,
    hayTokenEnHash,
    () => false,
  );

  useEffect(() => {
    if (!procesando) return;

    // Link vencido: GoTrue lo dice en el hash (`#error_code=otp_expired`).
    // No hay sesión que rescatar; al login con el mismo aviso que /auth/confirm.
    if (window.location.hash.includes("error_code=")) {
      window.location.replace(
        `/auth?error=${encodeURIComponent("Enlace expirado o inválido")}`,
      );
      return;
    }

    const supabase = createClient();
    void supabase.auth.getSession().then(() => {
      // Sin el hash en la URL: ya está en las cookies y no tiene que quedar
      // en el historial ni volver a procesarse en un reload.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      // Recarga completa, no `router.refresh()`: el form se envía con las
      // cookies del documento, y el documento actual se pidió sin ellas.
      window.location.reload();
    });
  }, [procesando]);

  // Mientras se canjea el hash no se muestra el form: enviarlo en ese
  // instante sería el mismo fallo de antes.
  if (procesando) {
    return (
      <p className="text-sm text-muted-foreground">Verificando el enlace…</p>
    );
  }
  return <>{children}</>;
}

function suscribirNada(): () => void {
  return () => {};
}

function hayTokenEnHash(): boolean {
  const hash = window.location.hash;
  return hash.includes("access_token=") || hash.includes("error_code=");
}
