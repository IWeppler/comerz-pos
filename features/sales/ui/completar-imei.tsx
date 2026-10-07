"use client";

import { useEffect, useMemo, useState } from "react";
import { Barcode, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { normalizarImei } from "@/entities/ventas/imei";
import type { TicketData } from "@/entities/ventas/types";
import {
  completarImeiAction,
  getRenglonesImeiPendienteAction,
} from "../actions/imei-pendiente";

/**
 * Aparatos de un ticket del historial que salieron sin IMEI y lo llevan, y el
 * ticket con los que se completen acá ya aplicados.
 *
 * Solo para tickets con `ventaId` (los que abre el historial): el del POS
 * recién cobrado ya pasó por el modal que lo pide.
 */
export function useImeisPendientes(ticketRecibido: TicketData | null) {
  const ventaId = ticketRecibido?.ventaId ?? null;
  // Resultado por venta: cambiar de ticket no muestra los pendientes del
  // anterior mientras vuelve la consulta.
  const [consulta, setConsulta] = useState<{ ventaId: string; itemIds: string[] } | null>(
    null,
  );
  const [completados, setCompletados] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ventaId) return;
    let cancelado = false;
    getRenglonesImeiPendienteAction(ventaId).then((res) => {
      if (cancelado) return;
      if (res.error) console.error("[IMEI PENDIENTE]", res.error);
      setConsulta({ ventaId, itemIds: res.itemIds });
    });
    return () => {
      cancelado = true;
    };
  }, [ventaId]);

  const pendientes = useMemo(() => {
    if (!ventaId || consulta?.ventaId !== ventaId) return new Set<string>();
    return new Set(consulta.itemIds.filter((id) => !completados[id]));
  }, [consulta, completados, ventaId]);

  const ticket = useMemo(() => {
    if (!ticketRecibido) return null;
    if (Object.keys(completados).length === 0) return ticketRecibido;
    return {
      ...ticketRecibido,
      items: ticketRecibido.items.map((item) =>
        item.itemId && completados[item.itemId]
          ? { ...item, imei: completados[item.itemId] }
          : item,
      ),
    };
  }, [ticketRecibido, completados]);

  const completar = (itemId: string, imei: string) =>
    setCompletados((prev) => ({ ...prev, [itemId]: imei }));

  return { ticket, pendientes, completar };
}

/** "Agregar IMEI" en un renglón que salió sin número. Se guarda al momento. */
export function CompletarImeiRenglon({
  itemId,
  onCompletar,
}: Readonly<{
  itemId: string;
  onCompletar: (itemId: string, imei: string) => void;
}>) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const imei = normalizarImei(valor);
    if (!imei || guardando) return;
    setGuardando(true);
    const res = await completarImeiAction(itemId, imei);
    setGuardando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("IMEI guardado. Ya sale en el ticket.");
    onCompletar(itemId, res.imei);
  };

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-11 px-3 text-xs shadow-none border-warning/40 text-warning"
        onClick={() => setAbierto(true)}
      >
        <Barcode className="w-4 h-4 mr-1.5" />
        Agregar IMEI
      </Button>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          // El lector termina con Enter: guarda el número, no hace otra cosa.
          if (e.key === "Enter") {
            e.preventDefault();
            void guardar();
          }
        }}
        placeholder="Escaneá o escribí el IMEI"
        aria-label="IMEI del aparato"
        className="h-11 font-mono text-sm"
        autoComplete="off"
        autoFocus
      />
      <Button
        type="button"
        className="h-11 shrink-0"
        onClick={() => void guardar()}
        disabled={guardando || !normalizarImei(valor)}
      >
        {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
      </Button>
    </div>
  );
}
