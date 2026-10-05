"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { conNegocio, queryKeys } from "@/shared/lib/query-keys";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import {
  getAvisosCcAction,
  marcarAvisoCcEnviadoAction,
} from "../actions/avisos-cc";

/** El ciclo cambia como mucho una vez por día y con cada marca (que
 * invalida): un minuto alcanza para no pedirlo en cada render de la tabla. */
const AVISOS_STALE_MS = 60 * 1000;

function diaMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)}/${Number(mes)}`;
}

/**
 * El ciclo de cobro del día (comercios con cierre mensual): quiénes tienen
 * que abonar y a quiénes ya se les mandó el resumen en este ciclo.
 *
 * Lo usa la tabla de clientes para dos cosas: el filtro "A abonar" y la marca
 * de "resumen enviado" en la columna de WhatsApp. Sin cierre mensual
 * `aviso` es null y la tabla queda como siempre.
 *
 * `marcar` registra el envío en `cc_avisos` SOLO si el cliente está en el
 * ciclo y todavía no estaba marcado: un resumen mandado a mitad de mes a
 * alguien que no debe nada del ciclo es un mensaje suelto, no un aviso.
 */
export function useAvisosCc() {
  const negocioActivo = useNegocioActivo();
  const queryClient = useQueryClient();
  const clave = conNegocio(queryKeys.clientes.avisos, negocioActivo?.id);
  const { data } = useQuery({
    queryKey: clave,
    queryFn: getAvisosCcAction,
    staleTime: AVISOS_STALE_MS,
  });

  // Marcados en esta sesión, para que el ícono cambie al instante sin
  // esperar la recarga. La fuente de verdad sigue siendo `cc_avisos`.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const aviso = data?.aviso ?? null;

  const enCiclo = useMemo(() => {
    const mapa = new Map<string, { monto: number; enviado: boolean }>();
    for (const c of aviso?.clientes ?? []) {
      mapa.set(c.clienteId, {
        monto: c.monto,
        enviado: c.enviado || marcados.has(c.clienteId),
      });
    }
    return mapa;
  }, [aviso, marcados]);

  const marcar = useCallback(
    async (clienteId: string) => {
      const fila = enCiclo.get(clienteId);
      if (!aviso || !fila || fila.enviado) return;
      const { ok, error } = await marcarAvisoCcEnviadoAction({
        clienteId,
        tipo: aviso.tipo,
        venceEl: aviso.venceEl,
        monto: fila.monto,
      });
      if (!ok) {
        toast.error(error ?? "No se pudo registrar el envío.");
        return;
      }
      setMarcados((prev) => new Set(prev).add(clienteId));
      queryClient.invalidateQueries({ queryKey: clave });
    },
    [aviso, enCiclo, queryClient, clave],
  );

  // "A abonar 15/10" mientras se puede pagar; desde el día siguiente al
  // vencimiento, los que quedaron debiendo.
  const etiquetaFiltro = aviso
    ? aviso.tipo === "MORA"
      ? `Impagos ${diaMes(aviso.venceEl)}`
      : `A abonar ${diaMes(aviso.venceEl)}`
    : null;

  return { aviso, enCiclo, marcar, etiquetaFiltro };
}
