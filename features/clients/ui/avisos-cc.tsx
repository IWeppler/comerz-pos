"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronRight, Loader2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { formatearMoneda } from "@/shared/utils/formatters";
import { conNegocio, queryKeys } from "@/shared/lib/query-keys";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import type { Cliente } from "@/entities/clientes/type";
import {
  getAvisosCcAction,
  marcarAvisoCcEnviadoAction,
  type AvisosCcDelDia,
} from "../actions/avisos-cc";
import {
  calcularSaldoConRecargo,
  type BasesMora,
  type RecargoMoraConfig,
} from "../lib/calcular-saldo-con-recargo";
import { calcularDiasVencido } from "../lib/calcular-dias-vencido";
import type { TipoAvisoCc } from "../lib/avisos-cc";
import { useRecordatorioCc } from "./use-recordatorio-cc";

/** El aviso cambia como mucho una vez por día y con cada marca (que
 * invalida): un minuto alcanza para no pedirlo en cada render de la tabla. */
const AVISOS_STALE_MS = 60 * 1000;

function diaMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)}/${Number(mes)}`;
}

/** La línea de arriba y el título del panel, por tipo de aviso. */
function textos(aviso: AvisosCcDelDia, pendientes: number) {
  const vence = diaMes(aviso.venceEl);
  const n = `${pendientes} ${pendientes === 1 ? "cliente" : "clientes"}`;
  const porTipo: Record<TipoAvisoCc, { linea: string; detalle: string }> = {
    CIERRE: {
      linea: `Cierre del ${diaMes(aviso.cierre)} · ${n} para avisar`,
      detalle: `Lo que deben vence el ${vence}.`,
    },
    PREVIO: {
      linea: `Vence el ${vence} · ${n} todavía deben`,
      detalle: `Un recordatorio antes de que corra la mora.`,
    },
    MORA: {
      linea: `Venció el ${vence} · ${n} en mora`,
      detalle: `El mensaje incluye el recargo por mora si corresponde.`,
    },
  };
  return porTipo[aviso.tipo];
}

/**
 * Los avisos de cuenta corriente del día (comercios con cierre mensual).
 *
 * Una línea discreta arriba de la tabla de clientes, que solo aparece si
 * queda alguien sin avisar; al tocarla, un panel con la lista de mayor a
 * menor deuda y un "Enviar" por fila que abre WhatsApp con el mismo mensaje
 * que el botón "Recordar" (`useRecordatorioCc`) y deja la fila marcada en
 * `cc_avisos`.
 *
 * El total del mensaje se calcula con los MISMOS datos que la tabla y el
 * detalle (`calcularSaldoConRecargo` con las bases de `deuda_cc_vencida`): la
 * clienta recibe el número que después se le cobra.
 */
export function AvisosCc({
  clientes,
  recargoMoraConfig,
  vencidoPorCliente,
  moraPreviaPorCliente,
  basesMoraPorCliente,
  nombreComercio,
  plantillaRecordatorio,
}: Readonly<{
  clientes: Cliente[];
  recargoMoraConfig: RecargoMoraConfig;
  vencidoPorCliente: Record<string, number>;
  moraPreviaPorCliente: Record<string, number>;
  basesMoraPorCliente: Record<string, BasesMora>;
  nombreComercio: string | null;
  plantillaRecordatorio: string | null;
}>) {
  const negocioActivo = useNegocioActivo();
  const queryClient = useQueryClient();
  const claveAvisos = conNegocio(queryKeys.clientes.avisos, negocioActivo?.id);
  const { data } = useQuery({
    queryKey: claveAvisos,
    queryFn: getAvisosCcAction,
    staleTime: AVISOS_STALE_MS,
  });

  const [abierto, setAbierto] = useState(false);
  // Marcados en esta sesión, para que la fila cambie al instante sin esperar
  // la recarga. La fuente de verdad sigue siendo `cc_avisos`.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState<string | null>(null);

  const recordar = useRecordatorioCc({
    nombreComercio,
    plantilla: plantillaRecordatorio,
  });

  const aviso = data?.aviso ?? null;
  const porId = useMemo(
    () => new Map(clientes.map((c) => [c.id, c])),
    [clientes],
  );

  // Solo los clientes que están en la lista de clientes: sin sus datos no se
  // puede armar el mensaje.
  const filas = useMemo(() => {
    if (!aviso) return [];
    return aviso.clientes
      .filter((a) => porId.has(a.clienteId))
      .map((a) => ({
        ...a,
        cliente: porId.get(a.clienteId)!,
        enviado: a.enviado || marcados.has(a.clienteId),
      }));
  }, [aviso, porId, marcados]);

  if (!aviso || filas.length === 0) return null;

  const pendientes = filas.filter((f) => !f.enviado);
  const avisados = filas.filter((f) => f.enviado);
  // Todos avisados: la línea se va. El panel ya no tiene nada que pedir.
  if (pendientes.length === 0 && !abierto) return null;

  const { linea, detalle } = textos(aviso, pendientes.length);

  const enviar = async (fila: (typeof filas)[number]) => {
    const c = fila.cliente;
    const saldo = Number(c.saldo_pendiente || 0);
    const { montoRecargo, saldoConRecargo } = calcularSaldoConRecargo(
      {
        monto_pendiente: c.saldo_pendiente,
        fecha_vencimiento: c.fecha_vencimiento_deuda,
        monto_vencido: vencidoPorCliente[c.id] ?? 0,
        mora_previa: moraPreviaPorCliente[c.id] ?? 0,
        ...basesMoraPorCliente[c.id],
      },
      recargoMoraConfig,
    );

    setEnviando(c.id);
    try {
      await recordar({
        clienteId: c.id,
        telefono: c.telefono,
        nombreCliente: c.nombre,
        saldo,
        montoRecargo,
        saldoConRecargo,
        fechaVencimiento: c.fecha_vencimiento_deuda ?? null,
        diasVencido: calcularDiasVencido(c.fecha_vencimiento_deuda),
      });

      if (fila.enviado) return;
      const { ok, error } = await marcarAvisoCcEnviadoAction({
        clienteId: c.id,
        tipo: aviso.tipo,
        venceEl: aviso.venceEl,
        monto: fila.monto,
      });
      if (!ok) {
        toast.error(error ?? "No se pudo marcar el aviso.");
        return;
      }
      setMarcados((prev) => new Set(prev).add(c.id));
      queryClient.invalidateQueries({ queryKey: claveAvisos });
    } finally {
      setEnviando(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mx-2 flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <Bell className="h-4 w-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {linea}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {detalle}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent
          side="right"
          className="flex h-dvh w-full flex-col gap-0 border-l border-border bg-card p-0 sm:max-w-md"
        >
          <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
            <SheetTitle className="text-base font-semibold text-foreground">
              {linea}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {detalle} Cada &quot;Enviar&quot; abre WhatsApp con el mensaje
              listo.
            </SheetDescription>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  {avisados.length} de {filas.length} avisados
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{
                    width: `${(avisados.length / filas.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-y divide-border">
              {[...pendientes, ...avisados].map((fila) => (
                <li
                  key={fila.clienteId}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        fila.enviado ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {fila.cliente.nombre}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatearMoneda(fila.monto)}
                    </p>
                  </div>

                  {fila.enviado ? (
                    <button
                      type="button"
                      onClick={() => enviar(fila)}
                      disabled={enviando !== null}
                      title="Ya avisado. Tocá para mandarlo de nuevo."
                      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-success disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Avisado
                    </button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => enviar(fila)}
                      disabled={enviando !== null}
                      className="h-11 shrink-0 border-border px-3 text-xs font-medium"
                    >
                      {enviando === fila.clienteId ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FaWhatsapp className="mr-1.5 h-3.5 w-3.5 text-success" />
                      )}
                      Enviar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
