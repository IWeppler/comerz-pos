"use server";

import { revalidatePath } from "next/cache";
import { contextoCobros, MENSAJE_CONTEXTO } from "../lib/contexto-cobros";
import { leerConfigAppMp } from "../lib/cliente-oauth-mp";
import {
  borrarConexionMp,
  leerEstadoConexionMp,
  type EstadoConexionMp,
} from "../lib/repo-conexion-supabase";
import { validarCobros, type EntradaCobros } from "../lib/validar-cobros";

/**
 * Server actions de Configuración › Cobros online.
 *
 * Todas pasan por `contextoCobros()` (ADMIN + módulo prendido, contra la
 * base). Un server action es un endpoint: que la sección no se vea no impide
 * llamarlo.
 */

type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface EstadoCobrosOnline {
  conexion: EstadoConexionMp;
  /** Faltan las env vars de la app de MP: el botón de conectar no puede andar. */
  appMpConfigurada: boolean;
}

export async function estadoCobrosOnlineAction(): Promise<Resultado<EstadoCobrosOnline>> {
  const ctx = await contextoCobros();
  if (!ctx.ok) return { ok: false, error: MENSAJE_CONTEXTO[ctx.error] };

  try {
    const conexion = await leerEstadoConexionMp(ctx.negocioId);
    return { ok: true, data: { conexion, appMpConfigurada: leerConfigAppMp() !== null } };
  } catch (e) {
    console.error("[COBROS ONLINE] estado", (e as Error).message);
    return { ok: false, error: "No pudimos leer el estado de Mercado Pago. Probá de nuevo." };
  }
}

export async function guardarCobrosOnlineAction(
  entrada: EntradaCobros,
): Promise<Resultado> {
  const ctx = await contextoCobros();
  if (!ctx.ok) return { ok: false, error: MENSAJE_CONTEXTO[ctx.error] };

  // La conexión se mira en la BASE: prender un medio con la cuenta caída no
  // puede depender de lo que la pantalla tenía cargado.
  let conectado = false;
  try {
    conectado = (await leerEstadoConexionMp(ctx.negocioId)).conectado;
  } catch (e) {
    console.error("[COBROS ONLINE] conexión", (e as Error).message);
    return { ok: false, error: "No pudimos verificar tu Mercado Pago. Probá de nuevo." };
  }

  const validacion = validarCobros(entrada, { mercadoPagoConectado: conectado });
  if (!validacion.ok) return { ok: false, error: validacion.error };

  // `.select("id")` + chequeo de filas: un UPDATE que la RLS filtra vuelve
  // con error null y 0 filas, y acá eso sería decir "guardado" sin guardar.
  const { data, error } = await ctx.supabase
    .from("configuracion_pos")
    .update(validacion.valores)
    .eq("negocio_id", ctx.negocioId)
    .select("id");

  if (error) {
    console.error("[COBROS ONLINE] guardar", error.code, error.message);
    return { ok: false, error: "No se pudo guardar. Revisá los datos y probá de nuevo." };
  }
  if (!data?.length) {
    return { ok: false, error: "No se guardó nada: recargá la página y probá de nuevo." };
  }

  revalidatePath("/configuracion");
  return { ok: true, data: undefined };
}

/**
 * Borra la conexión (tokens incluidos) y apaga los dos medios: sin cuenta no
 * hay dónde cobrar, y dejarlos prendidos ofrecería en el catálogo algo que no
 * puede funcionar.
 */
export async function desconectarMercadoPagoAction(): Promise<Resultado> {
  const ctx = await contextoCobros();
  if (!ctx.ok) return { ok: false, error: MENSAJE_CONTEXTO[ctx.error] };

  const { error: errorConfig } = await ctx.supabase
    .from("configuracion_pos")
    .update({ cobro_online_transferencia: false, cobro_online_mp: false })
    .eq("negocio_id", ctx.negocioId)
    .select("id");
  if (errorConfig) {
    console.error("[COBROS ONLINE] apagar medios", errorConfig.code);
    return { ok: false, error: "No se pudo desconectar. Probá de nuevo." };
  }

  try {
    await borrarConexionMp(ctx.negocioId);
  } catch (e) {
    console.error("[COBROS ONLINE] desconectar", (e as Error).message);
    return { ok: false, error: "No se pudo desconectar. Probá de nuevo." };
  }

  revalidatePath("/configuracion");
  return { ok: true, data: undefined };
}
