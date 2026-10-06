"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { obtenerLinkResumenAction } from "../actions/manage-clients";
import {
  construirMensajeDeuda,
  type DatosMensajeDeuda,
} from "../lib/mensaje-deuda";
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";

/** Lo que hace falta para mandarle el recordatorio a una clienta. */
export interface DatosRecordatorioCc
  extends Omit<DatosMensajeDeuda, "urlResumen" | "nombreComercio"> {
  clienteId: string;
  telefono: string | null | undefined;
  /** Comercios con cierre mensual: el capital que vence hasta el ciclo
   * vigente (`enCiclo` de `useAvisosCc`). Si viene, el mensaje cobra ESO y no
   * el saldo entero: lo comprado después del cierre vence el mes que viene
   * (ver `corteResumenCc`). undefined = el saldo entero, como siempre. */
  montoCiclo?: number;
}

/**
 * Abre WhatsApp con el recordatorio de deuda de una clienta.
 *
 * Es UNO para el botón "Recordar" del detalle y para la lista de avisos: el
 * mismo link, la misma plantilla y el mismo total (saldo + mora, de
 * `calcularSaldoConRecargo`). Dos copias de esto terminarían mandando dos
 * mensajes distintos para la misma deuda.
 *
 * El link se pide ANTES de abrir WhatsApp: si el token no existe todavía se
 * genera acá. Si falla, el mensaje sale igual pero sin detalle — un
 * recordatorio sin link es peor que ninguno, pero mucho mejor que un botón
 * que no hace nada.
 */
export function useRecordatorioCc({
  nombreComercio,
  plantilla,
}: {
  nombreComercio: string | null | undefined;
  plantilla: string | null | undefined;
}) {
  return useCallback(
    async (datos: DatosRecordatorioCc) => {
      const { url, error } = await obtenerLinkResumenAction(datos.clienteId);
      if (error) toast.error("No se pudo generar el link del resumen.");

      // La mora es toda del ciclo: solo existe sobre lo vencido, y lo vencido
      // vence a más tardar en el ciclo vigente. Por eso se suma entera.
      const recortar =
        datos.montoCiclo !== undefined && datos.montoCiclo < datos.saldo;
      const saldo = recortar ? datos.montoCiclo! : datos.saldo;
      const saldoConRecargo = recortar
        ? Math.round((saldo + datos.montoRecargo) * 100) / 100
        : datos.saldoConRecargo;

      const mensaje = construirMensajeDeuda(
        {
          nombreCliente: datos.nombreCliente,
          saldo,
          montoRecargo: datos.montoRecargo,
          saldoConRecargo,
          fechaVencimiento: datos.fechaVencimiento,
          diasVencido: datos.diasVencido,
          urlResumen: url,
          nombreComercio,
        },
        plantilla,
      );
      window.open(linkWhatsapp(datos.telefono, mensaje), "_blank");
    },
    [nombreComercio, plantilla],
  );
}
