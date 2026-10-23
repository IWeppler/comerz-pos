"use client";

import { useTransition } from "react";
import { Bell, Check, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  marcarEventoVistoAction,
  marcarTodoVistoAction,
} from "@/features/admin/actions/feed-comerz";
import type {
  NotificacionComerz,
  SeveridadNotificacion,
} from "@/features/admin/lib/feed-notificaciones";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";

const ICONO: Record<SeveridadNotificacion, React.ReactNode> = {
  urgente: <CircleAlert className="size-4 shrink-0 text-rose-400" />,
  atencion: <TriangleAlert className="size-4 shrink-0 text-amber-400" />,
  info: <Info className="size-4 shrink-0 text-white/30" />,
};

/** Cuánto hace, relativo: en un feed importa la antigüedad más que la fecha. */
function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
}

/**
 * La campana del encabezado: lo que pasó y lo que hay que atender.
 *
 * Es el feed de siempre (antes una tabla en medio del dashboard), ahora en un
 * popover. El número es lo que se puede marcar como visto y todavía no se vio.
 * Las filas SIN botón de "visto" no son un olvido: son estado derivado (plan
 * vencido, prueba terminada, sin plan), la situación de ahora, y se van solas
 * cuando se resuelve la causa. Poder marcarlas como vistas sería poder
 * esconder un comercio que no paga; por eso, si no hay avisos nuevos pero sí
 * hay algo urgente derivado, la campana muestra un punto en vez de quedar
 * limpia.
 */
export function CampanaAdmin({
  notificaciones,
}: Readonly<{ notificaciones: NotificacionComerz[] }>) {
  const [pendiente, startTransition] = useTransition();

  const sinVer = notificaciones.filter((n) => n.accionable && !n.vista).length;
  const hayUrgenteDerivado = notificaciones.some(
    (n) => !n.accionable && n.severidad === "urgente",
  );

  const marcar = (eventoId: string) =>
    startTransition(async () => {
      const res = await marcarEventoVistoAction(eventoId);
      if (!res.success) toast.error(res.error ?? "No se pudo.");
    });

  const marcarTodo = () =>
    startTransition(async () => {
      const res = await marcarTodoVistoAction();
      if (res.success) toast.success("Todo marcado como visto");
      else toast.error(res.error ?? "No se pudo.");
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            sinVer > 0 ? `Notificaciones: ${sinVer} sin ver` : "Notificaciones"
          }
          className="relative flex size-10 cursor-pointer items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Bell className="size-[18px]" />
          {sinVer > 0 ? (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
              {sinVer > 9 ? "9+" : sinVer}
            </span>
          ) : (
            hayUrgenteDerivado && (
              <span
                className="absolute right-2 top-2 size-2 rounded-full bg-rose-500"
                aria-hidden="true"
              />
            )
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className={`${CLASE_PORTAL_OSCURO} w-[min(26rem,calc(100vw-1.5rem))] border-white/10 bg-zinc-900 p-0 text-white`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-white/90">Notificaciones</p>
            <p className="text-xs text-white/40">
              {sinVer > 0 ? `${sinVer} sin ver` : "Todo al día"}
            </p>
          </div>
          {sinVer > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-white/60 hover:text-white"
              onClick={marcarTodo}
              disabled={pendiente}
            >
              Marcar todo como visto
            </Button>
          )}
        </div>

        <ul className="max-h-[min(26rem,70vh)] divide-y divide-white/[0.06] overflow-y-auto">
          {notificaciones.map((n) => (
            <li
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 ${n.vista ? "opacity-45" : ""}`}
            >
              {ICONO[n.severidad]}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white/90">
                  <span className="font-medium">{n.negocio}</span>
                  <span className="text-white/40"> · </span>
                  {n.titulo}
                </p>
                <p className="mt-0.5 text-xs text-white/40">{n.detalle}</p>
                <p
                  className="mt-1 text-[11px] text-white/25"
                  title={new Date(n.fecha).toLocaleString("es-AR")}
                >
                  {hace(n.fecha)}
                </p>
              </div>
              {n.accionable && !n.vista && n.eventoId && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-white/40 hover:text-white"
                  aria-label="Marcar como visto"
                  disabled={pendiente}
                  onClick={() => marcar(n.eventoId!)}
                >
                  <Check className="size-3.5" />
                </Button>
              )}
            </li>
          ))}

          {notificaciones.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-white/40">
              No hay nada para mostrar.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
