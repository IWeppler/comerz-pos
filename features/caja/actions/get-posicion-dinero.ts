"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { PosicionDinero } from "@/entities/caja/types";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";

export async function getPosicionDineroAction(
  periodo: PeriodoCalendario = "mes",
): Promise<{ data: PosicionDinero | null; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // ─────────────────────────────────────────────────────────────────────────
  // UNA LECTURA QUE ESCRIBE, Y POR QUÉ
  //
  // Un cobro diferido vive en el puente POR_ACREDITAR hasta su fecha pactada.
  // Sin esto, ahí se quedaría para siempre: quien lo saca es
  // `registrar_acreditacion_financiera`, que es la conciliación MANUAL contra
  // el extracto, y nadie va a tildar 593 cobros para que un número deje de
  // mentir. Es el mismo criterio que la mora de cuenta corriente: no se
  // aplica sola al día 31, se materializa cuando importa. Acá importa cuando
  // alguien abre esta pantalla.
  //
  // No se agrega un cron (`pg_cron` está disponible pero sin instalar): un
  // comercio que nadie mira no acumula nada que le importe a nadie.
  //
  // Es idempotente por el unique de `acreditaciones_financieras_pagos`, así
  // que dos pestañas abiertas a la vez no duplican nada. Y si falla, la
  // lectura sigue: un número desactualizado es mejor que una pantalla caída.
  // ─────────────────────────────────────────────────────────────────────────
  const { error: errorAcreditacion } = await supabase.rpc(
    "acreditar_cobros_vencidos",
  );
  if (errorAcreditacion && errorAcreditacion.code !== "PGRST202") {
    console.error(
      "No se pudieron acreditar los cobros vencidos:",
      errorAcreditacion,
    );
  }

  let { data, error } = await supabase.rpc("posicion_dinero_ledger", {
    p_desde: null,
    p_hasta: null,
    p_periodo: periodo,
  });

  // Compatibilidad de despliegue: la app puede salir antes que la migración
  // de Etapa 7. Mientras la RPC nueva no exista, la pestaña Dinero conserva
  // el reporte anterior en vez de quedar inutilizable.
  if (error?.code === "PGRST202") {
    console.warn(
      "posicion_dinero_ledger todavía no está disponible; usando posicion_dinero.",
    );
    ({ data, error } = await supabase.rpc("posicion_dinero", {
      p_desde: null,
      p_hasta: null,
      p_periodo: periodo,
    }));
  }

  if (error) {
    if (error.code === "42501") {
      return { data: null, error: "No tenés permiso para ver esta vista." };
    }
    console.error("Error obteniendo la posición de dinero:", error);
    return { data: null, error: "No se pudo cargar la posición de dinero." };
  }

  return { data: data as PosicionDinero, error: null };
}
