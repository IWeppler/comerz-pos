"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  Clock,
  CreditCard,
  Landmark,
  Wallet,
} from "lucide-react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { toast } from "sonner";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  PeriodoSelector,
  OPCIONES_CALENDARIO,
} from "@/shared/components/periodo-selector";
import {
  ETIQUETA_PERIODO_CALENDARIO,
  type PeriodoCalendario,
} from "@/shared/lib/periodo-ranges";
import { getPosicionDineroAction } from "../actions/get-posicion-dinero";
import type {
  CuentaPosicion,
  PosicionDinero as PosicionDineroData,
  ReintegroPosicion,
} from "@/entities/caja/types";

/**
 * "¿Cuánto tengo en cada caja / banco / billetera?"
 *
 * Tres bloques que responden preguntas distintas y por eso NO se suman en un
 * número único:
 *
 *  - Efectivo: plata física en las cajas abiertas ahora.
 *  - Por acreditar: cobrado que todavía no está en la cuenta (tarjetas a 20
 *    días). Es plata del negocio que no se puede usar todavía.
 *  - Acreditado: lo que cayó en cada cuenta durante el período. Es flujo.
 *
 * Un total general mezclaría plata disponible con plata futura, que es
 * exactamente el error que hace que un comercio gaste lo que todavía no tiene.
 */

const MEDIOS: Record<string, { label: string; Icono: typeof Banknote }> = {
  EFECTIVO: { label: "Efectivo", Icono: Banknote },
  TRANSFERENCIA: { label: "Transferencias", Icono: Landmark },
  TARJETA: { label: "Tarjetas", Icono: CreditCard },
  BILLETERA_VIRTUAL: { label: "Billetera virtual", Icono: Wallet },
};

function medioIcono(tipo: string) {
  return MEDIOS[tipo]?.Icono ?? Wallet;
}

const LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-bold";

export function PosicionDinero({
  posicionInicial,
  periodoInicial,
}: Readonly<{
  posicionInicial: PosicionDineroData;
  periodoInicial: PeriodoCalendario;
}>) {
  const [verCajas, setVerCajas] = useState(false);
  const [periodo, setPeriodo] = useState<PeriodoCalendario>(periodoInicial);
  const [posicion, setPosicion] = useState(posicionInicial);
  const [cargando, setCargando] = useState(false);

  const cambiarPeriodo = async (nuevo: PeriodoCalendario) => {
    if (nuevo === periodo) return;
    // Optimista en el selector, no en los números: el período se marca al
    // toque y las cifras recién cambian cuando llegan. Al revés se vería un
    // total viejo bajo una etiqueta nueva, que es peor que esperar.
    setPeriodo(nuevo);
    setCargando(true);
    const res = await getPosicionDineroAction(nuevo);
    if (res.data) setPosicion(res.data);
    else if (res.error) toast.error(res.error);
    setCargando(false);
  };

  const { efectivo, por_acreditar: porAcreditar, acreditado } = posicion;

  const totalPorAcreditar = Number(posicion.por_acreditar_real?.saldo ?? sumarNeto(porAcreditar));
  const totalAcreditado = sumarNeto(acreditado);
  // Un turno con más egresos que ingresos da negativo. No se esconde: es la
  // señal de que hay egresos cargados en el turno equivocado.
  const hayCajaNegativa = efectivo.cajas.some((c) => Number(c.esperado) < 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            Lo que todavía no está en tus cuentas
          </h2>
          <p className="text-[11px] text-muted-foreground">
            El período gobierna solo lo acreditado. El efectivo y lo pendiente
            son de ahora.
          </p>
        </div>
        <PeriodoSelector
          opciones={OPCIONES_CALENDARIO}
          periodo={periodo}
          onChange={cambiarPeriodo}
          ariaLabel="Período del dinero acreditado"
        />
      </div>

      <TooltipProvider>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tarjeta
            titulo="Efectivo en los cajones abiertos"
            monto={Number(efectivo.total)}
            detalle={
              efectivo.turnos_abiertos === 0
                ? "Ninguna caja abierta"
                : `${efectivo.turnos_abiertos} caja(s) abierta(s)`
            }
            Icono={Banknote}
            alerta={hayCajaNegativa}
            ayuda="Plata física en los cajones abiertos AHORA. Se calcula igual que el cierre: fondo inicial + cobros en efectivo − todo lo que salió del cajón (gastos, retiros y compras). Los turnos ya cerrados no cuentan: esa plata se contó y se retiró."
          />
          <Tarjeta
            titulo="Por acreditar (ahora)"
            monto={totalPorAcreditar}
            detalle={
              porAcreditar.length === 0
                ? "Nada en el aire"
                : "Saldo real de la cuenta técnica"
            }
            Icono={Clock}
            ayuda="Plata que ya cobraste pero todavía no está en la cuenta. Sale de los días de acreditación pactados con cada método (las tarjetas suelen ser a 20 días). Es tuya, pero no la podés usar todavía: no la sumes al efectivo para decidir una compra."
          />
          <Tarjeta
            titulo={`Acreditado ${ETIQUETA_PERIODO_CALENDARIO[periodo]}`}
            monto={totalAcreditado}
            detalle="Neto de comisiones"
            Icono={Landmark}
            cargando={cargando}
            ayuda="Lo que cayó en el banco y en la billetera durante el período elegido, ya descontada la comisión que se queda el procesador. Es lo que efectivamente entró, no lo que facturaste: por eso es menor que las ventas del mismo período."
          />
        </div>
      </TooltipProvider>

      {Number(efectivo.cerrado_hoy) > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Además se cerraron hoy {formatearMoneda(Number(efectivo.cerrado_hoy))}{" "}
          declarados: esa plata ya se contó y no está en el efectivo de arriba.
        </p>
      )}

      {efectivo.cajas.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setVerCajas((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-3 text-xs font-semibold"
          >
            <span>Efectivo caja por caja</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${verCajas ? "rotate-180" : ""}`}
            />
          </button>

          {verCajas && (
            <ul className="border-t border-border ">
              {efectivo.cajas.map((caja) => {
                const esperado = Number(caja.esperado);
                return (
                  <li
                    key={caja.turno_id}
                    className="bg-card flex flex-col gap-1 border-b border-border px-3 py-2.5 text-xs last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{caja.vendedor}</div>
                      <div className="text-muted-foreground">
                        Abrió {formatearFechaHora(caja.desde)} · inicial{" "}
                        {formatearMoneda(Number(caja.inicial))} · cobró{" "}
                        {formatearMoneda(Number(caja.ingresos))} · salidas{" "}
                        {formatearMoneda(Number(caja.salidas))}
                        {Number(caja.transferencias_netas ?? 0) !== 0 && (
                          <> · pases internos {Number(caja.transferencias_netas) > 0 ? "+" : ""}{formatearMoneda(Number(caja.transferencias_netas))}</>
                        )}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 font-semibold tabular-nums ${esperado < 0 ? "text-danger" : ""}`}
                    >
                      {formatearMoneda(esperado)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {hayCajaNegativa && (
        <p className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Una caja da efectivo negativo: salió más plata de la que entró.
            Suele ser un egreso cargado en el turno equivocado.
          </span>
        </p>
      )}

      <ListaCuentas
        titulo="Cobrado que todavía no cayó"
        cuentas={porAcreditar}
        vacio="No hay cobros pendientes de acreditar."
        mostrarFecha
      />

      {posicion.conciliacion && (
        <p className="text-[11px] text-muted-foreground">
          Conciliación transitoria · por acreditar anterior {formatearMoneda(Number(posicion.conciliacion.por_acreditar_anterior))} · ledger {formatearMoneda(Number(posicion.conciliacion.por_acreditar_ledger))}.
        </p>
      )}

      <ListaCuentas
        titulo={`Ya acreditado en cada cuenta (${ETIQUETA_PERIODO_CALENDARIO[periodo]})`}
        cuentas={acreditado}
        vacio="No se acreditó nada en este período."
      />

      <ListaReintegros reintegros={posicion.reintegros ?? []} />

      <p className="text-[11px] text-muted-foreground">
        Estos números salen de lo registrado en el sistema:{" "}
        <strong>no son el saldo del banco</strong>. La cuenta también se mueve
        por cosas que el POS no ve — una transferencia a un proveedor, un débito
        automático, plata ya retirada.
      </p>
    </section>
  );
}

function ListaCuentas({
  titulo,
  cuentas,
  vacio,
  mostrarFecha = false,
}: Readonly<{
  titulo: string;
  cuentas: CuentaPosicion[];
  vacio: string;
  mostrarFecha?: boolean;
}>) {
  return (
    <div className="space-y-2">
      <h3 className={LABEL}>{titulo}</h3>

      {cuentas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="rounded-xl border border-border bg-card">
          {cuentas.map((c) => {
            const Icono = medioIcono(c.metodo_tipo);
            const comision = Number(c.comision);
            return (
              <li
                key={`${c.metodo_nombre}-${c.metodo_tipo}`}
                className="flex flex-col gap-1 border-b border-border px-3 py-2.5 text-xs last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{c.metodo_nombre}</div>
                    <div className="text-muted-foreground">
                      {c.cantidad} cobro(s)
                      {comision > 0 &&
                        ` · ${formatearMoneda(comision)} de comisión`}
                      {mostrarFecha && c.proxima && (
                        <> · primero cae el {formatearFecha(c.proxima)}</>
                      )}
                      {mostrarFecha && c.ultima && c.ultima !== c.proxima && (
                        <>, último el {formatearFecha(c.ultima)}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums">
                  {formatearMoneda(Number(c.neto))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Lo que se le devolvió al cliente por un medio que no es efectivo.
 *
 * Va DEBAJO de "ya acreditado" y no adentro porque ya está restado de ahí: el
 * número de arriba es el neto, y este explica de dónde sale la diferencia. Sin
 * esta lista, una devolución por transferencia hace bajar un total sin que
 * nadie pueda reconstruir por qué, que es la forma más rápida de que la dueña
 * deje de creerle a la pantalla.
 *
 * El efectivo no aparece acá: ese reintegro ya se ve como egreso en el arqueo
 * del turno, y mostrarlo dos veces invita a restarlo dos veces.
 */
function ListaReintegros({
  reintegros,
}: Readonly<{ reintegros: ReintegroPosicion[] }>) {
  if (reintegros.length === 0) return null;

  const total = reintegros.reduce((acc, r) => acc + Number(r.monto), 0);

  return (
    <div className="space-y-2">
      <h3 className={LABEL}>Devoluciones pagadas por estos medios</h3>
      <ul className="rounded-xl border border-border bg-card">
        {reintegros.map((r) => {
          const Icono = medioIcono(r.metodo_tipo);
          return (
            <li
              key={`${r.metodo_nombre}-${r.metodo_tipo}`}
              className="flex flex-col gap-1 border-b border-border px-3 py-2.5 text-xs last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">{r.metodo_nombre}</div>
                  <div className="text-muted-foreground">
                    {r.cantidad} devolución(es)
                  </div>
                </div>
              </div>
              <div className="shrink-0 font-semibold tabular-nums text-danger">
                −{formatearMoneda(Number(r.monto))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Ya están restadas de lo acreditado ({formatearMoneda(total)} en total).
      </p>
    </div>
  );
}

function Tarjeta({
  titulo,
  monto,
  detalle,
  Icono,
  alerta = false,
  ayuda,
  cargando = false,
}: Readonly<{
  titulo: string;
  monto: number;
  detalle: string;
  Icono: typeof Banknote;
  alerta?: boolean;
  /** Mientras llega el período nuevo, el número se atenúa en vez de saltar a
   * un placeholder: el valor viejo sigue siendo cierto para el período viejo. */
  cargando?: boolean;
  /** Qué es este número y qué NO es. Estas tres cifras se parecen entre sí y
   * la diferencia decide si podés gastar la plata o no. */
  ayuda?: string;
}>) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`${LABEL} flex items-center gap-1`}>
          {titulo}
          {ayuda && (
            <Tooltip>
              {/* Botón y no un ícono suelto: en mobile no hay hover y el
                  tooltip tiene que poder abrirse con el dedo. */}
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Qué es ${titulo}`}
                  className="cursor-pointer p-1 -m-1 text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] border-border bg-foreground text-xs text-background">
                <p className="normal-case tracking-normal">{ayuda}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div
        className={`text-xl font-bold tabular-nums transition-opacity ${
          alerta || monto < 0 ? "text-danger" : ""
        } ${cargando ? "opacity-40" : ""}`}
      >
        {formatearMoneda(monto)}
      </div>
      <div className="text-[11px] text-muted-foreground">{detalle}</div>
    </div>
  );
}

function sumarNeto(cuentas: CuentaPosicion[]): number {
  return cuentas.reduce((acc, c) => acc + Number(c.neto), 0);
}

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

function formatearFechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
