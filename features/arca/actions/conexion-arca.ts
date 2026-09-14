"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { CBTE_TIPO, normalizarAmbiente, type AmbienteArca } from "../lib/codigos-arca";
import {
  borrarCredenciales,
  generarYGuardarCsr,
  guardarCertificado,
  leerEstadoCredenciales,
  negocioActualId,
  obtenerTicketAcceso,
  type EstadoCredenciales,
} from "../lib/credenciales";
import { feCompUltimoAutorizado, feDummy } from "../lib/wsfe";

/**
 * Server actions del panel de conexión con ARCA.
 *
 * Todas hacen lo mismo primero: permiso `configuracion.facturacion` y
 * negocio activo resuelto por la BASE. Un server action es un endpoint; que
 * el panel esté escondido para una vendedora no la frena de llamarlo.
 *
 * El ambiente viene del formulario porque el panel muestra homologación y
 * producción como dos tarjetas: se normaliza (desconocido = HOMOLOGACION,
 * nunca PRODUCCION) y nunca se usa para nada que no sea elegir la fila.
 */

type Resultado<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function contexto(): Promise<
  | { ok: true; supabase: SupabaseClient; negocioId: string }
  | { ok: false; error: string }
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!(await tienePermiso(supabase, PERMISOS.CONFIGURACION_FACTURACION))) {
    return { ok: false, error: "No tenés permiso para configurar ARCA." };
  }
  const negocioId = await negocioActualId(supabase);
  if (!negocioId) {
    return { ok: false, error: "No hay negocio activo." };
  }
  return { ok: true, supabase, negocioId };
}

export interface EstadoConexionArca {
  ambienteActivo: AmbienteArca;
  cuit: string | null;
  razonSocial: string | null;
  puntoVenta: number | null;
  homologacion: EstadoCredenciales;
  produccion: EstadoCredenciales;
}

export async function estadoConexionArcaAction(): Promise<
  Resultado<EstadoConexionArca>
> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;

  const { data: config } = await ctx.supabase
    .from("configuracion_pos")
    .select("arca_ambiente, cuit, razon_social, punto_venta")
    .single();

  try {
    const [homologacion, produccion] = await Promise.all([
      leerEstadoCredenciales(ctx.negocioId, "HOMOLOGACION"),
      leerEstadoCredenciales(ctx.negocioId, "PRODUCCION"),
    ]);
    return {
      ok: true,
      data: {
        ambienteActivo: normalizarAmbiente(config?.arca_ambiente),
        cuit: config?.cuit ?? null,
        razonSocial: config?.razon_social ?? null,
        puntoVenta: config?.punto_venta ?? null,
        homologacion,
        produccion,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function generarCsrArcaAction(
  ambienteCrudo: string,
): Promise<Resultado<{ csrPem: string }>> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const ambiente = normalizarAmbiente(ambienteCrudo);

  const { data: config } = await ctx.supabase
    .from("configuracion_pos")
    .select("cuit, razon_social")
    .single();

  if (!config?.cuit) {
    return {
      ok: false,
      error:
        "Cargá el CUIT del comercio en Configuración → Comercio antes de generar el CSR: ARCA lo valida contra el certificado.",
    };
  }

  try {
    const csrPem = await generarYGuardarCsr({
      negocioId: ctx.negocioId,
      ambiente,
      cuit: config.cuit,
      razonSocial: config.razon_social ?? "",
    });
    revalidatePath("/configuracion");
    return { ok: true, data: { csrPem } };
  } catch (e) {
    console.error("[ARCA] No se pudo generar el CSR", { ambiente, error: e });
    return { ok: false, error: (e as Error).message };
  }
}

export async function cargarCertificadoArcaAction(
  ambienteCrudo: string,
  certificadoPem: string,
): Promise<Resultado<{ vencimiento: string }>> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const ambiente = normalizarAmbiente(ambienteCrudo);

  if (!certificadoPem?.includes("BEGIN CERTIFICATE")) {
    return {
      ok: false,
      error:
        "Pegá el contenido del archivo .crt que descargaste de ARCA (empieza con -----BEGIN CERTIFICATE-----).",
    };
  }

  try {
    const info = await guardarCertificado({
      negocioId: ctx.negocioId,
      ambiente,
      certificadoPem,
    });
    revalidatePath("/configuracion");
    return { ok: true, data: { vencimiento: info.vencimiento } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface PruebaConexion {
  servidores: { appServer: string; dbServer: string; authServer: string };
  taVigenteHasta: string;
  /** Último número autorizado del comprobante de prueba, o null si no hay
   * punto de venta configurado. */
  ultimoAutorizado: { tipo: string; numero: number } | null;
}

/**
 * Prueba la cadena entera: WSFE vivo (FEDummy), login en WSAA con el
 * certificado (obtiene o reusa el TA), y una consulta real con ese TA
 * (FECompUltimoAutorizado). Si las tres pasan, la próxima venta va a poder
 * pedir un CAE.
 */
export async function probarConexionArcaAction(
  ambienteCrudo: string,
): Promise<Resultado<PruebaConexion>> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const ambiente = normalizarAmbiente(ambienteCrudo);

  const { data: config } = await ctx.supabase
    .from("configuracion_pos")
    .select("cuit, condicion_iva, punto_venta")
    .single();

  try {
    const servidores = await feDummy(ambiente);
    const { ticket } = await obtenerTicketAcceso(ctx.negocioId, ambiente);

    let ultimoAutorizado: PruebaConexion["ultimoAutorizado"] = null;
    if (config?.punto_venta && config.cuit) {
      const tipo =
        config.condicion_iva === "Responsable Inscripto" ? "FACTURA_B" : "FACTURA_C";
      const numero = await feCompUltimoAutorizado(
        ambiente,
        { ticket, cuit: config.cuit },
        config.punto_venta,
        CBTE_TIPO[tipo]!,
      );
      ultimoAutorizado = { tipo, numero };
    }

    return {
      ok: true,
      data: { servidores, taVigenteHasta: ticket.expiraEn, ultimoAutorizado },
    };
  } catch (e) {
    console.error("[ARCA] Prueba de conexión fallida", { ambiente, error: e });
    return { ok: false, error: (e as Error).message };
  }
}

export async function cambiarAmbienteArcaAction(
  ambienteCrudo: string,
): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const ambiente = normalizarAmbiente(ambienteCrudo);

  // Pasar a PRODUCCION sin certificado de producción dejaría al comercio
  // creyendo que factura. Se frena acá.
  if (ambiente === "PRODUCCION") {
    const estado = await leerEstadoCredenciales(ctx.negocioId, "PRODUCCION");
    if (!estado.tieneCertificado || estado.certificadoVencido) {
      return {
        ok: false,
        error:
          "Antes de pasar a producción cargá un certificado de producción vigente.",
      };
    }
  }

  // `.select("id")`: un UPDATE filtrado por RLS devuelve 0 filas y sin error.
  const { data, error } = await ctx.supabase
    .from("configuracion_pos")
    .update({ arca_ambiente: ambiente })
    .eq("negocio_id", ctx.negocioId)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, error: "No se pudo cambiar el ambiente." };
  }
  revalidatePath("/configuracion");
  return { ok: true, data: undefined };
}

export async function borrarCredencialesArcaAction(
  ambienteCrudo: string,
): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const ambiente = normalizarAmbiente(ambienteCrudo);

  // Borrar las de producción con producción activo dejaría modo ARCA sin
  // nada atrás. Vuelve a homologación primero.
  const { data: config } = await ctx.supabase
    .from("configuracion_pos")
    .select("arca_ambiente")
    .single();
  if (ambiente === "PRODUCCION" && normalizarAmbiente(config?.arca_ambiente) === "PRODUCCION") {
    return {
      ok: false,
      error: "Pasá el ambiente a homologación antes de borrar las credenciales de producción.",
    };
  }

  try {
    await borrarCredenciales(ctx.negocioId, ambiente);
    revalidatePath("/configuracion");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
