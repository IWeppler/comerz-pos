"use client";

import { CreditCard } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { TotalesTurno } from "../lib/totales-turno";

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
 * Lo cobrado por transferencia, tarjeta y billetera durante el turno.
 *
 * Va aparte del cajón y NO se suma con él: esa plata no está en ninguna caja
 * que se pueda contar, y mezclarla con el efectivo esperado es exactamente
 * cómo un arqueo termina con una diferencia que nadie puede explicar.
 *
 * El número grande es el NETO —después de la comisión que se queda el
 * procesador— porque es lo que va a llegar a la cuenta. El bruto queda abajo:
 * sin él, "vendí $121.590 con tarjeta" no coincide con ningún ticket.
 */
export function TarjetaDigital({
  totales,
}: Readonly<{ totales: TotalesTurno }>) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5" />
        Cobros digitales de tu turno
      </p>

      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {formatearMoneda(totales.ingresosDigitalesNeto)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Lo que se estima que va a acreditarse. No está en el cajón.
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
    </article>
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
