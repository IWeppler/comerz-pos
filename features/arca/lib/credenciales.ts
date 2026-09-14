import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { cifrar, claveMaestraConfigurada, descifrar } from "./cifrado";
import { normalizarAmbiente, type AmbienteArca } from "./codigos-arca";
import { generarClaveYCsr, inspeccionarCertificado } from "./csr";
import { pedirTicketAcceso, type TicketAcceso } from "./wsaa";

/**
 * Lectura y escritura de `arca_credenciales`.
 *
 * TODO pasa por el cliente service_role, porque la tabla no tiene policies
 * (ver la migración): ni supabase-js del navegador ni el cliente de sesión
 * pueden leerla. Eso convierte a este módulo en la ÚNICA puerta, y por eso
 * cada función recibe el `negocioId` ya resuelto por `negocio_actual()` —
 * nunca de un parámetro del cliente— y los server actions chequean
 * `configuracion.facturacion` antes de llamar.
 *
 * Solo desde server actions: la service key no tiene prefijo NEXT_PUBLIC_,
 * así que en el navegador `createAdminClient` no existe.
 */

interface FilaCredenciales {
  negocio_id: string;
  ambiente: string;
  clave_privada_cifrada: string;
  csr_pem: string;
  certificado_pem: string | null;
  certificado_vencimiento: string | null;
  certificado_subject: string | null;
  ta_cifrado: string | null;
  ta_expira_en: string | null;
  actualizado_en: string;
}

/** Lo que el panel puede ver. Sin clave, sin token. */
export interface EstadoCredenciales {
  ambiente: AmbienteArca;
  tieneClave: boolean;
  csrPem: string | null;
  tieneCertificado: boolean;
  certificadoVencimiento: string | null;
  certificadoSubject: string | null;
  certificadoVencido: boolean;
  taVigenteHasta: string | null;
  cifradoConfigurado: boolean;
}

const COLUMNAS_ESTADO =
  "ambiente, csr_pem, certificado_pem, certificado_vencimiento, certificado_subject, ta_expira_en";

/** El negocio activo, validado por la base (no por la cookie). */
export async function negocioActualId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase.rpc("negocio_actual");
  return (data as string | null) ?? null;
}

export async function leerEstadoCredenciales(
  negocioId: string,
  ambiente: AmbienteArca,
): Promise<EstadoCredenciales> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("arca_credenciales")
    .select(COLUMNAS_ESTADO)
    .eq("negocio_id", negocioId)
    .eq("ambiente", ambiente)
    .maybeSingle();

  const fila = data as Pick<
    FilaCredenciales,
    | "ambiente"
    | "csr_pem"
    | "certificado_pem"
    | "certificado_vencimiento"
    | "certificado_subject"
    | "ta_expira_en"
  > | null;

  const vencimiento = fila?.certificado_vencimiento ?? null;
  return {
    ambiente,
    tieneClave: Boolean(fila),
    csrPem: fila?.csr_pem ?? null,
    tieneCertificado: Boolean(fila?.certificado_pem),
    certificadoVencimiento: vencimiento,
    certificadoSubject: fila?.certificado_subject ?? null,
    certificadoVencido: vencimiento ? new Date(vencimiento) < new Date() : false,
    taVigenteHasta: fila?.ta_expira_en ?? null,
    cifradoConfigurado: claveMaestraConfigurada(),
  };
}

/**
 * Genera clave + CSR y los guarda, PISANDO lo que hubiera para ese ambiente.
 * Regenerar invalida el certificado anterior (era de la otra clave), así que
 * el certificado se borra junto con el TA.
 */
export async function generarYGuardarCsr(datos: {
  negocioId: string;
  ambiente: AmbienteArca;
  cuit: string;
  razonSocial: string;
}): Promise<string> {
  const par = generarClaveYCsr({
    cuit: datos.cuit,
    razonSocial: datos.razonSocial,
    alias: `comerz-${datos.ambiente.toLowerCase()}`,
  });

  const admin = createAdminClient();
  const { error } = await admin.from("arca_credenciales").upsert(
    {
      negocio_id: datos.negocioId,
      ambiente: datos.ambiente,
      clave_privada_cifrada: cifrar(par.clavePrivadaPem),
      csr_pem: par.csrPem,
      certificado_pem: null,
      certificado_vencimiento: null,
      certificado_subject: null,
      ta_cifrado: null,
      ta_expira_en: null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "negocio_id,ambiente" },
  );
  if (error) throw new Error(`No se pudo guardar el CSR: ${error.message}`);

  return par.csrPem;
}

export async function guardarCertificado(datos: {
  negocioId: string;
  ambiente: AmbienteArca;
  certificadoPem: string;
}): Promise<{ vencimiento: string; subject: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("arca_credenciales")
    .select("clave_privada_cifrada")
    .eq("negocio_id", datos.negocioId)
    .eq("ambiente", datos.ambiente)
    .maybeSingle();

  if (!data) {
    throw new Error(
      "Primero hay que generar el CSR: el certificado se valida contra esa clave.",
    );
  }

  const clavePem = descifrar(
    (data as Pick<FilaCredenciales, "clave_privada_cifrada">)
      .clave_privada_cifrada,
  );
  const info = inspeccionarCertificado(datos.certificadoPem, clavePem);

  if (new Date(info.vencimiento) < new Date()) {
    throw new Error(`Ese certificado venció el ${info.vencimiento.slice(0, 10)}.`);
  }

  const { error, data: filas } = await admin
    .from("arca_credenciales")
    .update({
      certificado_pem: datos.certificadoPem.trim(),
      certificado_vencimiento: info.vencimiento,
      certificado_subject: info.subject,
      // Certificado nuevo, TA viejo: se descarta para que el próximo login
      // firme con el que corresponde.
      ta_cifrado: null,
      ta_expira_en: null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("negocio_id", datos.negocioId)
    .eq("ambiente", datos.ambiente)
    .select("negocio_id");

  if (error || !filas?.length) {
    throw new Error(
      `No se pudo guardar el certificado: ${error?.message ?? "sin filas"}`,
    );
  }

  return { vencimiento: info.vencimiento, subject: info.subject };
}

export async function borrarCredenciales(
  negocioId: string,
  ambiente: AmbienteArca,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("arca_credenciales")
    .delete()
    .eq("negocio_id", negocioId)
    .eq("ambiente", ambiente);
  if (error) throw new Error(`No se pudieron borrar: ${error.message}`);
}

export interface CredencialesListas {
  ambiente: AmbienteArca;
  clavePrivadaPem: string;
  certificadoPem: string;
  taCifrado: string | null;
  taExpiraEn: string | null;
}

/** Las credenciales completas, o null si falta clave o certificado. */
async function leerCredencialesCompletas(
  negocioId: string,
  ambiente: AmbienteArca,
): Promise<CredencialesListas | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("arca_credenciales")
    .select("clave_privada_cifrada, certificado_pem, ta_cifrado, ta_expira_en")
    .eq("negocio_id", negocioId)
    .eq("ambiente", ambiente)
    .maybeSingle();

  const fila = data as Pick<
    FilaCredenciales,
    "clave_privada_cifrada" | "certificado_pem" | "ta_cifrado" | "ta_expira_en"
  > | null;
  if (!fila?.certificado_pem) return null;

  return {
    ambiente,
    clavePrivadaPem: descifrar(fila.clave_privada_cifrada),
    certificadoPem: fila.certificado_pem,
    taCifrado: fila.ta_cifrado,
    taExpiraEn: fila.ta_expira_en,
  };
}

/** Si ESTE negocio puede pedir un CAE hoy, sin ir a ARCA. */
export async function tieneCredencialesListas(
  negocioId: string,
  ambiente: unknown,
): Promise<boolean> {
  if (!claveMaestraConfigurada()) return false;
  const estado = await leerEstadoCredenciales(
    negocioId,
    normalizarAmbiente(ambiente),
  );
  return estado.tieneCertificado && !estado.certificadoVencido;
}

/** Margen antes del vencimiento del TA para no usar uno que muere en el
 * medio de la venta. */
const MARGEN_TA_MS = 5 * 60 * 1000;

/**
 * El ticket de acceso vigente, del cache o pidiéndolo a WSAA.
 *
 * ARCA no deja pedir uno mientras hay otro vivo, así que el cache no es una
 * optimización: es lo que hace que la segunda venta funcione. Se cifra con
 * la misma clave que la privada — vale 12 horas de poder facturar.
 */
export async function obtenerTicketAcceso(
  negocioId: string,
  ambiente: AmbienteArca,
): Promise<{ ticket: TicketAcceso; credenciales: CredencialesListas }> {
  const credenciales = await leerCredencialesCompletas(negocioId, ambiente);
  if (!credenciales) {
    throw new Error(
      `No hay certificado de ARCA cargado para ${ambiente.toLowerCase()}.`,
    );
  }

  if (
    credenciales.taCifrado &&
    credenciales.taExpiraEn &&
    new Date(credenciales.taExpiraEn).getTime() - MARGEN_TA_MS > Date.now()
  ) {
    const ticket = JSON.parse(descifrar(credenciales.taCifrado)) as TicketAcceso;
    return { ticket, credenciales };
  }

  const ticket = await pedirTicketAcceso(
    ambiente,
    credenciales.clavePrivadaPem,
    credenciales.certificadoPem,
  );

  const admin = createAdminClient();
  const { error } = await admin
    .from("arca_credenciales")
    .update({
      ta_cifrado: cifrar(JSON.stringify(ticket)),
      ta_expira_en: ticket.expiraEn,
      actualizado_en: new Date().toISOString(),
    })
    .eq("negocio_id", negocioId)
    .eq("ambiente", ambiente);

  // Si el cache no se pudo escribir, el TA sirve igual para ESTA llamada;
  // la próxima va a chocar con alreadyAuthenticated y lo va a decir.
  if (error) {
    console.error("[ARCA] No se pudo cachear el TA", { negocioId, ambiente, error });
  }

  return { ticket, credenciales };
}
