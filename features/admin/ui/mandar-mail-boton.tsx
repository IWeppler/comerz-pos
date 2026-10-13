"use client";

import { useState, useTransition } from "react";
import { Mail, MailCheck, MailX, Eye } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import {
  esAccionDeVersionVieja,
  MENSAJE_VERSION_VIEJA,
} from "@/shared/lib/accion-de-version-vieja";
import {
  enviarMailDeEtapaAction,
  previsualizarMailDeEtapaAction,
} from "@/features/admin/actions/mails-de-etapa";
import {
  ETIQUETA_NO_ENVIAR,
  type MotivoNoEnviar,
} from "@/features/admin/lib/campanas-email";
import type { EtapaAlta } from "@/features/admin/lib/embudo-alta";

/**
 * Manda el mail que le corresponde a la etapa donde quedó esta persona.
 *
 * Es cliente por el mismo motivo que `MarcarPruebaBoton`, y vive aparte para
 * que `EmbudoAltaPanel` siga siendo Server Component.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS COSAS QUE NO SON ADORNO
 *
 * 1. LA PREVIEW VA ANTES. El ojo abre el mail exacto que saldría, con el CTA
 *    y el pie puestos. Un mail es irreversible: mandado está mandado, y no hay
 *    "deshacer". Poder leerlo antes es lo que evita el envío con un error de
 *    tipeo a un cliente real.
 * 2. NO HAY OPTIMISMO. `MarcarPruebaBoton` puede pintar el estado antes de que
 *    el server conteste porque marcar es reversible. Acá no: el botón se queda
 *    en "mandando" hasta que el proveedor confirma. Decir "listo" sobre un
 *    envío que rebotó es exactamente la clase de éxito silencioso que este
 *    proyecto ya pagó caro.
 */
export function MandarMailBoton({
  usuarioId,
  email,
  etapa,
  motivoNoEnviar,
}: Readonly<{
  usuarioId: string;
  email: string;
  etapa: EtapaAlta;
  /** `null` = se le puede escribir. Si no, por qué no. */
  motivoNoEnviar: MotivoNoEnviar | null;
}>) {
  const [pendiente, startTransition] = useTransition();
  const [enviado, setEnviado] = useState(motivoNoEnviar === "YA_ENVIADO");
  const [preview, setPreview] = useState<{
    asunto: string;
    html: string;
  } | null>(null);

  // Sin campaña no hay nada que ofrecer: la persona ya está adentro.
  if (motivoNoEnviar === "SIN_CAMPANA") return null;

  const bloqueado =
    motivoNoEnviar === "DADO_DE_BAJA" || motivoNoEnviar === "ES_PRUEBA";

  if (bloqueado) {
    return (
      <span
        title={ETIQUETA_NO_ENVIAR[motivoNoEnviar]}
        className="shrink-0 cursor-help text-white/20"
      >
        <MailX className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="Ver el mail que saldría"
          onClick={() => {
            startTransition(async () => {
              try {
                const m = await previsualizarMailDeEtapaAction(etapa);
                if (m) setPreview({ asunto: m.asunto, html: m.html });
              } catch (e) {
                toast.error(
                  esAccionDeVersionVieja(e)
                    ? MENSAJE_VERSION_VIEJA
                    : "No se pudo armar la preview.",
                );
              }
            });
          }}
          className="rounded p-0.5 text-white/20 transition-colors hover:text-white/60"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          disabled={pendiente || enviado}
          title={
            enviado
              ? "Ya se le mandó este mail"
              : `Mandar el mail de "${etapa}" a ${email}`
          }
          onClick={() => {
            startTransition(async () => {
              // Ver el comentario de `accion-de-version-vieja.ts`: una pestaña
              // abierta desde antes del último deploy llama a un Server Action
              // que ya no existe, y sin este catch eso termina en pantalla
              // negra en vez de en un aviso.
              try {
                const res = await enviarMailDeEtapaAction(
                  usuarioId,
                  email,
                  etapa,
                );

                if (res.ok) {
                  setEnviado(true);
                  toast.success(`Mail enviado a ${email}`);
                } else {
                  // Si el motivo es que ya se le mandó, el botón tiene que
                  // quedar apagado igual: el estado del panel estaba viejo.
                  if (res.error?.startsWith("Ya se le mandó")) setEnviado(true);
                  toast.error(res.error ?? "No se pudo mandar.");
                }
              } catch (e) {
                toast.error(
                  esAccionDeVersionVieja(e)
                    ? MENSAJE_VERSION_VIEJA
                    : "No se pudo mandar. Probá de nuevo.",
                );
              }
            });
          }}
          className={`rounded p-0.5 transition-colors disabled:cursor-default ${
            enviado
              ? "text-emerald-400/70"
              : "text-white/20 hover:text-white/60 disabled:opacity-40"
          }`}
        >
          {enviado ? (
            <MailCheck className="h-3.5 w-3.5" />
          ) : (
            <Mail className="h-3.5 w-3.5" />
          )}
        </button>
      </span>

      {preview && (
        // Modal a mano y no un Dialog: es una pantalla de lectura para una
        // sola persona, y meterle el sistema de diálogos entero no le agrega
        // nada.
        <div
          role="dialog"
          aria-label="Previsualización del mail"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-black/10 p-3">
              <p className="min-w-0 truncate text-sm font-semibold text-black/80">
                {preview.asunto}
              </p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="shrink-0 text-xs text-black/40 hover:text-black"
              >
                Cerrar
              </button>
            </div>
            {/* `srcDoc` en un iframe aislado: el HTML del mail trae su propio
                <body> y sus estilos, y montarlo en la página los mezclaría con
                los del panel. */}
            <iframe
              title="Mail"
              srcDoc={preview.html}
              sandbox=""
              className="h-[70vh] w-full border-0 bg-white"
            />
          </div>
        </div>
      )}
    </>
  );
}
