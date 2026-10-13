"use client";

import { useTransition } from "react";
import { Check, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  marcarEventoVistoAction,
  marcarTodoVistoAction,
} from "@/features/admin/actions/feed-comerz";
import type {
  NotificacionComerz,
  SeveridadNotificacion,
} from "@/features/admin/lib/feed-notificaciones";

const ICONO: Record<SeveridadNotificacion, React.ReactNode> = {
  urgente: <CircleAlert className="size-4 shrink-0 text-rose-400" />,
  atencion: <TriangleAlert className="size-4 shrink-0 text-amber-400" />,
  info: <Info className="size-4 shrink-0 text-white/30" />,
};

/** Cuánto hace. Se muestra relativo porque en un feed lo que importa es la
 * antigüedad, no la fecha exacta — esa está en el título del elemento. */
function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
}

/**
 * Todo lo que pasó y todo lo que hay que atender, en una lista.
 *
 * Las filas SIN botón de "visto" no son un olvido: son estado derivado (mes
 * vencido, prueba terminada, sin plan). No se descartan porque no son avisos
 * de algo que pasó, son la situación de ahora — se van solas cuando se
 * resuelve la causa. Poder marcarlas como vistas sería poder esconder un
 * comercio que no paga.
 */
export function NotificacionesTabla({
  notificaciones,
}: Readonly<{ notificaciones: NotificacionComerz[] }>) {
  const [pendiente, startTransition] = useTransition();

  const sinVer = notificaciones.filter((n) => n.accionable && !n.vista).length;

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
    // `h-full` + columna flex: la tarjeta mide lo mismo que el gráfico de al
    // lado (la grilla la estira) y el que se achica es el LISTADO, no la
    // tarjeta. Antes tenía un `max-h` fijo de 28rem que no tenía nada que ver
    // con el alto del gráfico, así que una quedaba mucho más alta que el otro.
    <div className="flex max-h-[24rem] flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white/90">
            Notificaciones
          </h2>
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

      {/* `min-h-0` es lo que permite que un hijo flex se achique por debajo de
          su contenido; sin eso el `overflow-y-auto` no scrollea y la tarjeta
          crece igual. */}
      <ul className="min-h-0 flex-1 divide-y divide-white/[0.06] overflow-y-auto">
        {notificaciones.map((n) => (
          <li
            key={n.id}
            // `flex-wrap` + el bloque de texto con `basis-full` en mobile: la
            // antigüedad y el botón se van a su propia línea en vez de pelear
            // el ancho con el título. Antes, en un celular, el nombre del
            // comercio y el detalle quedaban partidos en una columna de dos
            // palabras de ancho.
            className={`flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap ${
              n.vista ? "opacity-45" : ""
            }`}
          >
            {ICONO[n.severidad]}

            <div className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-auto">
              <p className="text-sm text-white/90">
                <span className="font-medium">{n.negocio}</span>
                <span className="text-white/40"> · </span>
                {n.titulo}
              </p>
              <p className="mt-0.5 text-xs text-white/40">{n.detalle}</p>
            </div>

            {/* En mobile queda alineado a la derecha de su propia línea; en
                desktop vuelve a la misma fila que el texto. */}
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
              <span
                className="text-[11px] text-white/25"
                title={new Date(n.fecha).toLocaleString("es-AR")}
              >
                {hace(n.fecha)}
              </span>
              {n.accionable && !n.vista && n.eventoId && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-white/40 hover:text-white"
                  aria-label="Marcar como visto"
                  disabled={pendiente}
                  onClick={() => marcar(n.eventoId!)}
                >
                  <Check className="size-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}

        {notificaciones.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-white/40">
            No hay nada para mostrar.
          </li>
        )}
      </ul>
    </div>
  );
}
