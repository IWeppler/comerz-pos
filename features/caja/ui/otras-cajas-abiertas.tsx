"use client";

import { Users } from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { TurnoCajaHistorial } from "@/entities/caja/types";

/**
 * Los otros cajones abiertos ahora mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO ES UN CONTROL, ES CONTEXTO — Y NO LO VE CUALQUIERA
 *
 * La lista sale de los turnos que la página YA trajo, y esos vienen filtrados
 * por la misma regla de siempre: sin `caja.cerrar_ajena` y en modo
 * POR_USUARIO, una vendedora solo recibe los suyos. Así que a Mara este
 * bloque le llega vacío y no se muestra — no hay que esconderlo acá, ya no
 * existe para ella. Para la dueña, en cambio, es la respuesta a "¿cuánta
 * plata hay en el local ahora?" sin tener que ir a Dinero.
 *
 * El efectivo de cada turno es el ESPERADO recalculado
 * (`efectivo_esperado_actual`), no el de la fila: en un turno abierto
 * `turnos_caja.efectivo_esperado` quedó congelado en el monto inicial y
 * mostrarlo diría que la caja de al lado tiene el fondo y nada más.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function OtrasCajasAbiertas({
  turnos,
}: Readonly<{ turnos: TurnoCajaHistorial[] }>) {
  if (turnos.length === 0) return null;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Otras cajas abiertas
      </p>

      <ul className="mt-3 divide-y divide-border">
        {turnos.map((turno) => {
          const esperado = turno.efectivo_esperado_actual;
          return (
            <li
              key={turno.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {turno.perfiles?.nombre || "Vendedor"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Abrió {horaCorta(turno.fecha_apertura)} ·{" "}
                  {duracion(turno.fecha_apertura)}
                </p>
              </div>
              {/* Sin el recalculado no se inventa un número: el de la fila
                  está congelado y diría el fondo inicial. */}
              {esperado == null || esperado === "" ? (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  S/D
                </span>
              ) : (
                <span
                  className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                    Number(esperado) < 0 ? "text-danger" : ""
                  }`}
                >
                  {formatearMoneda(Number(esperado))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function horaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "6 h 23 min" desde la apertura. Se calcula en el cliente, así que en el
 * primer render del server puede diferir por segundos; no importa, es un dato
 * de contexto y no una cifra que alguien firme. */
function duracion(desde: string): string {
  const minutos = Math.max(
    0,
    Math.floor((Date.now() - new Date(desde).getTime()) / 60000),
  );
  const horas = Math.floor(minutos / 60);
  return horas === 0 ? `${minutos} min` : `${horas} h ${minutos % 60} min`;
}
