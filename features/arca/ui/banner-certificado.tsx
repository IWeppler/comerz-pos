import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { negocioActualId, leerEstadoCredenciales } from "../lib/credenciales";
import { normalizarAmbiente } from "../lib/codigos-arca";
import { estadoCertificado } from "../lib/estado-certificado";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";

/**
 * "El certificado de ARCA vence en N días" / "venció", arriba de todo el
 * panel, solo para ADMIN y solo con modo ARCA. Server component: la lectura
 * de credenciales pasa por service_role y no puede vivir en el cliente.
 *
 * No cuesta nada al que no factura: `leerConfigPos` ya está cacheada en el
 * request, y las credenciales se miran únicamente si el modo es ARCA.
 */
export async function BannerCertificadoArca() {
  const config = await leerConfigPos();
  if (config?.modo_facturacion !== "ARCA") return null;

  const cookieStore = await cookies();
  const negocioId = await negocioActualId(createClient(cookieStore));
  if (!negocioId) return null;

  const ambiente = normalizarAmbiente(config.arca_ambiente);
  let estado;
  try {
    estado = await leerEstadoCredenciales(negocioId, ambiente);
  } catch {
    // Sin service key o sin clave de cifrado: el panel de facturación ya lo
    // dice; acá no hay nada que avisar.
    return null;
  }

  if (!estado.tieneCertificado) return null;
  const vencimiento = estadoCertificado(estado.certificadoVencimiento);
  if (!vencimiento || vencimiento.estado === "vigente") return null;

  const vencido = vencimiento.estado === "vencido";
  const etiquetaAmbiente = ambiente === "PRODUCCION" ? "" : " de homologación";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm ${
        vencido
          ? "border-danger/20 bg-danger/10 text-danger"
          : "border-warning/20 bg-warning/10 text-warning-foreground"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="size-4 shrink-0" />
        <p className="min-w-0">
          <span className="font-semibold">
            {vencido
              ? `El certificado de ARCA${etiquetaAmbiente} venció`
              : `El certificado de ARCA${etiquetaAmbiente} vence en ${vencimiento.dias} día${vencimiento.dias === 1 ? "" : "s"}`}
          </span>{" "}
          <span className="opacity-90">
            {vencido
              ? "La caja está emitiendo ticket interno. Renovalo en ARCA y cargá el nuevo."
              : "Pedí el certificado nuevo en ARCA y cargalo antes de que venza para no dejar de facturar."}
          </span>
        </p>
      </div>
      <Link
        href="/configuracion?tab=ticket"
        className="shrink-0 rounded-md border border-current/30 px-3 py-1 text-xs font-semibold hover:bg-background/50"
      >
        Ir a Facturación
      </Link>
    </div>
  );
}
