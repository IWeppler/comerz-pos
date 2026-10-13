"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import {
  esAccionDeVersionVieja,
  MENSAJE_VERSION_VIEJA,
} from "@/shared/lib/accion-de-version-vieja";
import {
  enviarMailDePruebaAction,
  type ClaveDeMail,
} from "@/features/admin/actions/mail-de-prueba";
import { ETIQUETA_CAMPANA_NEGOCIO } from "@/features/admin/lib/campanas-negocio";

/**
 * Mandarse cualquiera de los mails a una casilla propia.
 *
 * La preview del panel muestra el HTML en un navegador, y lo que rompe un mail
 * no es el navegador: es Gmail borrando estilos, Outlook ignorando bordes y el
 * filtro de spam. Eso solo se ve mandándolo.
 *
 * La dirección es un campo libre a propósito: la prueba que sirve es la misma
 * campaña a Gmail, a Outlook y a Hotmail, que es donde están los clientes
 * (`maxi_l93@hotmail.com`).
 */

const OPCIONES: ReadonlyArray<{ clave: ClaveDeMail; etiqueta: string }> = [
  { clave: "REGISTRADO", etiqueta: "Alta · no confirmó el mail" },
  { clave: "CONFIRMADO", etiqueta: "Alta · confirmó y no entró" },
  { clave: "SESION", etiqueta: "Alta · no creó su negocio" },
  { clave: "VIO_FORMULARIO", etiqueta: "Alta · abandonó el formulario" },
  { clave: "fin_de_prueba", etiqueta: ETIQUETA_CAMPANA_NEGOCIO.fin_de_prueba },
  {
    clave: "fin_de_prueba_sin_uso",
    etiqueta: ETIQUETA_CAMPANA_NEGOCIO.fin_de_prueba_sin_uso,
  },
  { clave: "prueba_vencida", etiqueta: ETIQUETA_CAMPANA_NEGOCIO.prueba_vencida },
  { clave: "aviso_cobro", etiqueta: ETIQUETA_CAMPANA_NEGOCIO.aviso_cobro },
  {
    clave: "recordatorio_cobro",
    etiqueta: ETIQUETA_CAMPANA_NEGOCIO.recordatorio_cobro,
  },
  { clave: "inactividad", etiqueta: ETIQUETA_CAMPANA_NEGOCIO.inactividad },
];

export function MailsDePrueba({
  emailPorDefecto,
}: Readonly<{ emailPorDefecto: string }>) {
  const [pendiente, startTransition] = useTransition();
  const [clave, setClave] = useState<ClaveDeMail>("SESION");
  const [destino, setDestino] = useState(emailPorDefecto);

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold text-white/80">
        Probar un mail
      </p>
      <p className="text-[11px] text-white/40">
        Sale con datos de ejemplo y el asunto marcado{" "}
        <code className="text-white/60">[PRUEBA]</code>. No ocupa el lugar de
        ningún envío real.
      </p>

      <div className="flex flex-wrap gap-2">
        <select
          value={clave}
          onChange={(e) => setClave(e.target.value as ClaveDeMail)}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-white/80"
        >
          {OPCIONES.map((o) => (
            <option key={o.clave} value={o.clave}>
              {o.etiqueta}
            </option>
          ))}
        </select>

        <input
          type="email"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          placeholder="a qué casilla"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 text-xs text-white/80"
        />

        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            startTransition(async () => {
              // El try/catch NO es de rutina: una pestaña abierta desde antes
              // del último deploy manda un ID de Server Action que ya no
              // existe, y ese error no lo puede devolver el action —ocurre
              // antes de que corra. Sin esto sube al error boundary y la
              // pantalla se pone negra por algo que se arregla recargando.
              try {
                const res = await enviarMailDePruebaAction(clave, destino);
                if (res.ok) {
                  toast.success(`Mail de prueba enviado a ${destino}`);
                  if (res.aviso) toast.warning(res.aviso);
                } else {
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
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-semibold text-white/90 hover:bg-white/20 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          {pendiente ? "Mandando…" : "Mandar"}
        </button>
      </div>
    </div>
  );
}
