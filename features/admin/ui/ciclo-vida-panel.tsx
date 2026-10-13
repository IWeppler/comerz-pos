"use client";

import { useState, useTransition } from "react";
import { Eye, Mail, MailCheck, MailX } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import {
  esAccionDeVersionVieja,
  MENSAJE_VERSION_VIEJA,
} from "@/shared/lib/accion-de-version-vieja";
import {
  enviarMailDeNegocioAction,
  previsualizarMailDeNegocioAction,
} from "@/features/admin/actions/ciclo-negocios";
import {
  campanaQueCorresponde,
  claveDeEnvio,
  diasParaVencer,
  diasSinVender,
  ETIQUETA_CAMPANA_NEGOCIO,
  type ClaveCampanaNegocio,
  type NegocioEnCiclo,
} from "@/features/admin/lib/campanas-negocio";
import { MailsDePrueba } from "./mails-de-prueba";

/**
 * Qué mail le toca hoy a cada comercio, y el botón para mandarlo.
 *
 * Cliente entero —y no Server Component con islas, como `EmbudoAltaPanel`—
 * porque acá casi todo es interactivo: la fila que no tiene campaña se esconde
 * al tildar el filtro, y el estado de "ya se mandó" tiene que cambiar sin
 * recargar.
 *
 * La decisión de QUÉ mail corresponde se recalcula en el server antes de
 * mandar (`enviarMailDeNegocioAction`): lo de acá es para mostrar. Una
 * pantalla abierta veinte minutos puede estar ofreciendo un recordatorio de
 * pago a alguien que ya pagó.
 */
export function CicloVidaPanel({
  negocios,
  yaEnviadas,
  hayLinkDePago,
  emailPropio,
}: Readonly<{
  negocios: NegocioEnCiclo[];
  /** Claves de `envios_email` ya usadas, por usuario dueño. */
  yaEnviadas: Record<string, string[]>;
  hayLinkDePago: boolean;
  emailPropio: string;
}>) {
  const ahora = new Date();

  const filas = negocios
    .map((n) => ({ negocio: n, clave: campanaQueCorresponde(n, ahora) }))
    .sort((a, b) => {
      // Los que tienen algo que mandar, primero.
      if (Boolean(a.clave) !== Boolean(b.clave)) return a.clave ? -1 : 1;
      return a.negocio.nombre.localeCompare(b.negocio.nombre);
    });

  const conMail = filas.filter((f) => f.clave !== null).length;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-white/90">
          Ciclo de vida · a quién escribirle hoy
        </h2>
        <p className="text-xs text-white/40">
          Fin de prueba, recuperación, cobro e inactividad. Los comercios{" "}
          <code className="text-white/60">demo</code> y los dados de baja no
          reciben nada.
          {conMail > 0 && ` Hoy hay ${conMail} con mail pendiente.`}
        </p>
      </div>

      {!hayLinkDePago && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5 text-[11px] text-amber-200/70">
          No hay link de pago de respaldo. Los avisos de cobro salen igual para
          los planes que tengan cargado su{" "}
          <code>planes.link_suscripcion</code>; los que no, no se pueden mandar
          porque el mail no tendría cómo pagar.
        </p>
      )}

      <ul className="divide-y divide-white/5 rounded-lg border border-white/10 bg-white/5">
        {filas.map(({ negocio, clave }) => (
          <FilaNegocio
            key={negocio.negocioId}
            negocio={negocio}
            clave={clave}
            ahora={ahora}
            yaEnviado={
              clave !== null &&
              (yaEnviadas[negocio.duenioId ?? ""] ?? []).includes(
                claveDeEnvio(clave, negocio),
              )
            }
            hayLinkDePago={hayLinkDePago}
          />
        ))}
      </ul>

      <MailsDePrueba emailPorDefecto={emailPropio} />
    </div>
  );
}

function FilaNegocio({
  negocio,
  clave,
  ahora,
  yaEnviado,
  hayLinkDePago,
}: Readonly<{
  negocio: NegocioEnCiclo;
  clave: ClaveCampanaNegocio | null;
  ahora: Date;
  yaEnviado: boolean;
  hayLinkDePago: boolean;
}>) {
  const [pendiente, startTransition] = useTransition();
  const [enviado, setEnviado] = useState(yaEnviado);
  const [preview, setPreview] = useState<{ asunto: string; html: string } | null>(
    null,
  );

  const dias = diasParaVencer(negocio, ahora);
  const sinVender = diasSinVender(negocio, ahora);
  const esDeCobro =
    clave === "aviso_cobro" || clave === "recordatorio_cobro";
  // El link del PLAN alcanza solo: el de respaldo es para el plan que todavía
  // no tiene el suyo cargado.
  const bloqueadoSinLink = esDeCobro && !hayLinkDePago && !negocio.planLink;

  return (
    <>
      <li className="flex items-center gap-2 p-2.5 text-[11px]">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-white/80">{negocio.nombre}</span>
          <span className="block truncate text-white/35">
            {negocio.duenioEmail ?? "sin dueño con mail"} · {negocio.estado}
            {dias !== null &&
              ` · ${dias >= 0 ? `vence en ${dias}d` : `venció hace ${Math.abs(dias)}d`}`}
            {sinVender !== null && ` · ${sinVender}d sin vender`}
          </span>
        </span>

        {clave === null ? (
          <span className="shrink-0 text-white/25">—</span>
        ) : (
          <>
            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-white/60">
              {ETIQUETA_CAMPANA_NEGOCIO[clave]}
            </span>

            {bloqueadoSinLink ? (
              <span
                title="Falta MERCADOPAGO_LINK_PAGO"
                className="shrink-0 cursor-help text-white/20"
              >
                <MailX className="h-3.5 w-3.5" />
              </span>
            ) : (
              <>
                <button
                  type="button"
                  title="Ver el mail"
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const m = await previsualizarMailDeNegocioAction(
                          negocio.negocioId,
                          clave,
                        );
                        if (m) setPreview({ asunto: m.asunto, html: m.html });
                        else toast.error("No se pudo armar la preview.");
                      } catch (e) {
                        toast.error(
                          esAccionDeVersionVieja(e)
                            ? MENSAJE_VERSION_VIEJA
                            : "No se pudo armar la preview.",
                        );
                      }
                    });
                  }}
                  className="shrink-0 rounded p-0.5 text-white/20 hover:text-white/60"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  disabled={pendiente || enviado || !negocio.duenioEmail}
                  title={enviado ? "Ya se le mandó" : "Mandar este mail"}
                  onClick={() => {
                    startTransition(async () => {
                      // Ver `accion-de-version-vieja.ts`: sin este catch, una
                      // pestaña vieja termina en pantalla negra.
                      try {
                        const res = await enviarMailDeNegocioAction(
                          negocio.negocioId,
                          clave,
                        );
                        if (res.ok) {
                          setEnviado(true);
                          toast.success(`Mail enviado a ${negocio.duenioEmail}`);
                        } else {
                          if (res.error?.startsWith("Ya se le mandó")) {
                            setEnviado(true);
                          }
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
                  className={`shrink-0 rounded p-0.5 disabled:cursor-default ${
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
              </>
            )}
          </>
        )}
      </li>

      {preview && (
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
