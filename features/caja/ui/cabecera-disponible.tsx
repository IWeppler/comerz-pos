"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";

/**
 * Lo primero que se ve al abrir Dinero: cuánta plata hay y sus acciones.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AVISO VA PEGADO AL NÚMERO, NO AL PIE
 *
 * "Disponible ahora" es la cifra con la que la dueña decide si compra
 * mercadería, y sale de lo REGISTRADO en Comerz: no es el saldo del banco.
 * La cuenta también se mueve por cosas que el POS no ve —un débito
 * automático, una transferencia hecha desde el homebanking—, así que el
 * disclaimer es parte de la cifra y no una nota al pie que nadie baja a leer.
 * Es la diferencia entre un número que se usa para decidir y uno que se sabe
 * que hay que contrastar.
 *
 * NO incluye lo que está por acreditar: mezclar plata disponible con plata
 * futura es exactamente el error que hace gastar lo que todavía no entró. Eso
 * vive en su propio bloque, más abajo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las acciones van en orden de frecuencia de uso: un gasto se carga todos los
 * días, un ingreso libre y una transferencia cada tanto. Cada una la dibuja
 * quien la tiene; el freno real está en la action y en la RPC.
 */
export function CabeceraDisponible({
  disponible,
  ingresosPorAcreditar,
  cantidadPorAcreditar,
  egresosProgramados,
  cantidadProgramados,
  vencidosProgramados,
  onAbrirProgramados,
  acciones,
}: Readonly<{
  /** Suma de los saldos de todas las cuentas, el puente afuera. El negativo
   * entra al total: esconderlo lo dejaría inconsistente con la lista de
   * cuentas de abajo, que sí lo muestra. */
  disponible: number;
  /** Cobros confirmados que todavía no impactaron en una cuenta utilizable. */
  ingresosPorAcreditar: number;
  cantidadPorAcreditar: number;
  /** Lo comprometido en los próximos 30 días, VENCIDOS INCLUIDOS. Si los
   * vencidos quedaran afuera, el número bajaría justo cuando alguien se
   * atrasa, que es al revés de lo que tiene que pasar. */
  egresosProgramados: number;
  cantidadProgramados: number;
  vencidosProgramados: number;
  onAbrirProgramados: () => void;
  /** Los botones ya gateados por permiso. Van por prop y no adentro porque
   * son modales con estado propio (y uno de ellos abre otro modal). */
  acciones: ReactNode;
}>) {
  const [vistaMobile, setVistaMobile] = useState<"actual" | "proximo">(
    "actual",
  );

  return (
    <section className="space-y-4">
      <div className="relative md:overflow-hidden md:rounded-2xl md:border md:border-border md:bg-card">
        {/* En mobile queda un solo control: la vista activa ocupa el espacio
            normal de la página, sin otra card alrededor. En desktop no hace
            falta alternar porque ambas entran juntas. */}
        <Button
          type="button"
          size="icon"
          onClick={() =>
            setVistaMobile((actual) =>
              actual === "actual" ? "proximo" : "actual",
            )
          }
          className="absolute right-0 top-0 z-10 rounded-md md:hidden"
          aria-label={
            vistaMobile === "actual"
              ? "Ver próximos movimientos"
              : "Ver disponible ahora"
          }
          title={
            vistaMobile === "actual"
              ? "Ver próximos movimientos"
              : "Ver disponible ahora"
          }
        >
          <ArrowLeftRight className="h-5 w-5" />
        </Button>

        <div className="md:grid md:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
          <div
            className={`py-1 pr-14 md:px-6 md:py-6 md:pr-6 ${
              vistaMobile === "actual" ? "block" : "hidden md:block"
            }`}
          >
            <p className="text-sm font-medium text-muted-foreground">
              Disponible ahora
            </p>
            <p
              className={`mt-1 font-mono text-4xl font-semibold tabular-nums ${
                disponible < 0 ? "text-danger" : "text-foreground"
              }`}
            >
              {formatearMoneda(disponible)}
            </p>
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
              Es el saldo registrado dentro de Comerz.
            </p>
          </div>

          <div
            className={`py-1 pr-14 md:block md:border-l md:border-border md:bg-muted/25 md:px-6 md:py-6 md:pr-6 ${
              vistaMobile === "proximo" ? "block" : "hidden"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Próximos movimientos</p>
                <p className="text-[11px] text-muted-foreground">
                  Lo registrado que todavía no impactó.
                </p>
              </div>
              <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Por acreditar</p>
                  <p className="text-[11px] text-muted-foreground">
                    {cantidadPorAcreditar === 0
                      ? "Sin cobros pendientes"
                      : `${cantidadPorAcreditar} ${
                          cantidadPorAcreditar === 1
                            ? "movimiento"
                            : "movimientos"
                        }`}
                  </p>
                </div>
                <p
                  className={`font-mono text-base font-semibold tabular-nums ${
                    ingresosPorAcreditar < 0 ? "text-danger" : "text-success"
                  }`}
                >
                  {ingresosPorAcreditar > 0 && "+"}
                  {formatearMoneda(ingresosPorAcreditar)}
                </p>
              </div>

              {/* Los programados NO son plata que salió: es una agenda. Por
                  eso viven acá, al lado de lo por acreditar, y no en
                  "Disponible ahora". El botón es la puerta: sin una forma de
                  cargarlos, el bloque queda diciendo "sin configurar" para
                  siempre. */}
              <button
                type="button"
                onClick={onAbrirProgramados}
                className="flex w-full items-end justify-between gap-3 border-t border-border pt-3 text-left"
              >
                <div>
                  <p className="text-xs text-muted-foreground">
                    Egresos programados
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {cantidadProgramados === 0
                      ? "Alquileres, sueldos y suscripciones"
                      : `${cantidadProgramados} ${
                          cantidadProgramados === 1 ? "pago" : "pagos"
                        } en 30 días${
                          vencidosProgramados > 0
                            ? ` · ${vencidosProgramados} vencido${
                                vencidosProgramados === 1 ? "" : "s"
                              }`
                            : ""
                        }`}
                  </p>
                </div>
                {cantidadProgramados === 0 ? (
                  <p className="text-xs font-medium text-info">Configurar</p>
                ) : (
                  <p
                    className={`font-mono text-base font-semibold tabular-nums ${
                      vencidosProgramados > 0 ? "text-danger" : "text-foreground"
                    }`}
                  >
                    −{formatearMoneda(egresosProgramados)}
                  </p>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-start">
        {acciones}
      </div>
    </section>
  );
}
