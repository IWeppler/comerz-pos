"use client";

import { CreditCard } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { TotalesTurno } from "../lib/totales-turno";
import { etiquetaMovimiento } from "../lib/movimiento-financiero";
import type { MovimientoDigitalTurno } from "@/entities/caja/types";

/**
 * "¿Cuánta plata tengo que tener en el cajón si cierro ahora?"
 *
 * Es la cifra que alguien va a contra-contar con billetes en la mano, así que
 * va grande y con su desglose debajo: fondo inicial + cobros en efectivo −
 * salidas. Sin el desglose, un número que no cuadra no se puede rastrear y la
 * cajera no tiene más remedio que declarar lo que ve y firmar una diferencia.
 */
export function TarjetaTurno({
  vendedor,
  desde,
  totales,
}: Readonly<{
  vendedor: string;
  desde: string;
  totales: TotalesTurno;
}>) {
  // El cierre NO se reimplementa acá: abre el MISMO modal del botón de caja
  // de la barra, vía el store que existe justamente para eso. Dos formularios
  // de cierre serían dos arqueos distintos de la misma plata.
  const abrirModalCaja = useCajaModalStore((s) => s.abrir);
  const negativo = totales.efectivoEsperado < 0;

  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Tu caja · {vendedor}
      </p>

      <p
        className={`mt-1 font-mono text-3xl font-semibold tabular-nums sm:text-4xl ${
          negativo ? "text-danger" : "text-foreground"
        }`}
      >
        {formatearMoneda(totales.efectivoEsperado)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {negativo
          ? "Revisar: salió más efectivo del que entró. Suele ser un gasto cargado en el turno equivocado."
          : "Efectivo que tendría que haber en el cajón si cerrás ahora."}
      </p>

      <dl className="mt-5 space-y-2.5 border-t border-border pt-4 text-sm">
        <Linea etiqueta="Fondo inicial" monto={totales.fondoInicial} />
        <Linea
          etiqueta="Cobrado en efectivo"
          monto={totales.ingresosEfectivo}
          signo="+"
          tono="text-success"
        />
        <Linea
          etiqueta="Salidas de efectivo"
          monto={totales.totalEgresos}
          signo="−"
          tono="text-danger"
        />
      </dl>

      <div className="mt-5">
        <Button className="w-full" onClick={abrirModalCaja}>
          Cerrar mi turno
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Vas a contar el efectivo y confirmar cualquier diferencia. Abrió{" "}
          {horaCorta(desde)}.
        </p>
      </div>
    </article>
  );
}

/**
 * Todo lo que se movió fuera del cajón durante el turno.
 *
 * Va aparte del cajón y NO se suma con él: esa plata no está en ninguna caja
 * que se pueda contar, y mezclarla con el efectivo esperado es exactamente
 * cómo un arqueo termina con una diferencia que nadie puede explicar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ DEJÓ DE SER SOLO "COBROS"
 *
 * El Nono Cacho, 23/9/2026: una clienta pagó por transferencia y se llevó
 * efectivo del cajón. La salida de efectivo aparecía en los movimientos del
 * turno y la entrada digital NO, porque la lista del turno es la del CAJÓN
 * (`transferencias_caja_turno` filtra por la cuenta del turno). O sea que la
 * pantalla mostraba media operación y la otra mitad vivía en Dinero, en otra
 * pestaña. "Yo en los movimientos del local quiero ver todo lo registrado en
 * ese turno, no solo las ventas."
 *
 * El número grande NO cambió, y es deliberado: sigue siendo lo COBRADO neto,
 * que es lo que la vendedora reporta y lo que va a acreditarse. Si además
 * sumara transferencias e ingresos, dejaría de ser un número que alguien
 * pueda comparar contra algo. Lo demás entra como lista debajo, con su
 * cuenta y su signo.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function TarjetaDigital({
  totales,
  movimientos = [],
}: Readonly<{
  totales: TotalesTurno;
  movimientos?: MovimientoDigitalTurno[];
}>) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5" />
        Movimientos digitales de tu turno
      </p>

      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {formatearMoneda(totales.ingresosDigitalesNeto)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Cobros: lo que se estima que va a acreditarse. No está en el cajón.
      </p>

      <dl className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
        <Linea etiqueta="Cobros brutos" monto={totales.ingresosDigitalesBruto} />
        <Linea
          etiqueta="Comisiones retenidas"
          monto={totales.comisionesRetenidas}
          signo="−"
          tono="text-danger"
        />
      </dl>

      {movimientos.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Otros movimientos
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {movimientos.map((m) => (
              <MovimientoFueraDelCajon key={m.movimiento_id} movimiento={m} />
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            No afectan el efectivo del cajón ni tu cierre.
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * Una fila de lo que pasó en otra cuenta.
 *
 * La etiqueta sale de `etiquetaMovimiento`, la MISMA que usa el detalle de
 * cuenta de Dinero: dos nombres distintos para el mismo movimiento según la
 * pantalla es cómo se pierde la confianza en los dos. La descripción queda
 * abajo porque es lo que escribió quien lo registró, y es lo que hace
 * reconocible "cambio de efectivo por transferencia".
 */
function MovimientoFueraDelCajon({
  movimiento,
}: Readonly<{ movimiento: MovimientoDigitalTurno }>) {
  const importe = Number(movimiento.importe) || 0;
  const entra = importe >= 0;

  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {etiquetaMovimiento(
            movimiento.origen_tipo,
            movimiento.evento,
            importe,
          )}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {movimiento.cuenta_nombre}
          {movimiento.descripcion ? ` · ${movimiento.descripcion}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-mono font-medium tabular-nums ${
            entra ? "text-success" : "text-danger"
          }`}
        >
          {entra ? "+" : "−"}
          {formatearMoneda(Math.abs(importe))}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {horaCorta(movimiento.fecha_movimiento)}
        </p>
      </div>
    </li>
  );
}

function Linea({
  etiqueta,
  monto,
  signo,
  tono,
}: Readonly<{
  etiqueta: string;
  monto: number;
  signo?: "+" | "−";
  tono?: string;
}>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className={`font-mono font-medium tabular-nums ${tono ?? ""}`}>
        {signo}
        {formatearMoneda(monto)}
      </dd>
    </div>
  );
}

function horaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
