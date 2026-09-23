"use client";

import {
  AlertTriangle,
  Banknote,
  ChevronRight,
  Landmark,
  Wallet,
} from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { useNavegacionCaja } from "./caja-vistas";
import type { SaldoCuenta } from "@/entities/caja/types";

/**
 * Dónde está la plata, una tarjeta por lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS CAJAS ABIERTAS SON UNA TARJETA MÁS, Y ESO ES UN HECHO DEL MODELO
 *
 * Hasta `20260920180000` no se podían poner en la misma lista: "efectivo en
 * caja" salía del cálculo legacy de los turnos y el saldo de la cuenta salía
 * del ledger, y eran dos números de dos modelos que podían discrepar. Desde
 * esa migración el saldo de CAJA_DIARIA ES la suma del esperado de los turnos
 * abiertos, verificado como invariante en cada aplicación. Recién por eso la
 * caja chica puede aparecer al lado del banco sin mentir.
 *
 * Lo que la tarjeta NO hace es abrir el detalle de la cuenta: manda a Hoy. El
 * detalle de un cajón es su ARQUEO —quién lo tiene, cuánto contó, qué falta—
 * y eso ya vive en Hoy hecho para la persona que lo va a cerrar. Repetirlo
 * acá sería un segundo lugar donde mirar lo mismo, que es de donde venimos.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las cuentas en CERO se muestran igual: una cuenta que desaparece es una que
 * la dueña cree que no existe, y la próxima vez crea una duplicada. El orden
 * es fijo —efectivo primero, después por saldo— para que la lista no se
 * reacomode sola entre dos visitas.
 */
export function TiraCuentas({
  saldos,
  turnosAbiertos,
  onAbrirCuenta,
  onDeclararSaldoInicial,
  puedeDeclararSaldoInicial,
}: Readonly<{
  /** Del ledger, vía `posicion_dinero.cuentas`: la ÚNICA fuente de saldos de
   * esta pantalla. El puente POR_ACREDITAR no viene en esta lista y no tiene
   * que venir — esa plata todavía no está en ninguna cuenta. */
  saldos: SaldoCuenta[];
  turnosAbiertos: number;
  onAbrirCuenta: (cuenta: SaldoCuenta) => void;
  onDeclararSaldoInicial: (cuenta: SaldoCuenta) => void;
  puedeDeclararSaldoInicial: (cuenta: SaldoCuenta) => boolean;
}>) {
  const navegar = useNavegacionCaja();

  const porSaldo = (a: SaldoCuenta, b: SaldoCuenta) =>
    Number(b.saldo) - Number(a.saldo);
  const cajasDiarias = saldos.filter((c) => c.tipo === "CAJA_DIARIA");
  const resto = saldos.filter((c) => c.tipo !== "CAJA_DIARIA").sort(porSaldo);

  const totalCajas = cajasDiarias.reduce((acc, c) => acc + Number(c.saldo), 0);

  if (saldos.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-4 text-xs text-muted-foreground sm:px-5">
        Todavía no hay cuentas con movimientos.
      </p>
    );
  }

  return (
    // En mobile las cuentas forman una tira deslizable: apilarlas hacía que
    // una cuenta negativa o con explicación empujara el resto de la pestaña
    // varias pantallas hacia abajo. El ancho deja asomar la próxima tarjeta
    // para que el gesto horizontal sea evidente sin agregar controles.
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-2 md:overflow-visible md:pb-0">
      {cajasDiarias.length > 0 && (
        <TarjetaCuenta
          nombre="Cajas abiertas"
          detalle={
            turnosAbiertos === 0
              ? "Ningún turno en curso"
              : `${turnosAbiertos} ${turnosAbiertos === 1 ? "turno" : "turnos"} en curso`
          }
          saldo={totalCajas}
          pie="Ver el arqueo en Hoy"
          Icono={Banknote}
          onClick={navegar ? () => navegar("hoy") : undefined}
          saldoNegativo={totalCajas < 0}
        />
      )}

      {resto.map((cuenta) => (
        <TarjetaCuenta
          key={cuenta.cuenta_id}
          nombre={cuenta.nombre}
          detalle={etiquetaTipo(cuenta.tipo)}
          saldo={Number(cuenta.saldo)}
          pie="Ver movimientos de la cuenta"
          Icono={iconoDe(cuenta)}
          onClick={() => onAbrirCuenta(cuenta)}
          saldoNegativo={Number(cuenta.saldo) < 0}
          onDeclararSaldoInicial={
            puedeDeclararSaldoInicial(cuenta)
              ? () => onDeclararSaldoInicial(cuenta)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function TarjetaCuenta({
  nombre,
  detalle,
  saldo,
  pie,
  onClick,
  saldoNegativo = false,
  onDeclararSaldoInicial,
}: Readonly<{
  nombre: string;
  detalle: string;
  saldo: number;
  pie: string;
  Icono: typeof Banknote;
  onClick?: () => void;
  saldoNegativo?: boolean;
  onDeclararSaldoInicial?: () => void;
}>) {
  return (
    <div
      className={`min-w-[85%] snap-start overflow-hidden rounded-2xl border bg-card md:min-w-0 ${
        saldoNegativo ? "border-amber-500/40" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex w-full cursor-pointer flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-card"
      >
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{nombre}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {detalle}
              </p>
            </div>
          </div>
          {onClick && (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </div>

        <div>
          <p
            className={`font-mono text-xl font-semibold tabular-nums ${
              saldo < 0 ? "text-danger" : ""
            }`}
          >
            {formatearMoneda(saldo)}
          </p>
          {onClick && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{pie}</p>
          )}
        </div>
      </button>

      {saldoNegativo && (
        <div className="flex items-start gap-2 border-t border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Saldo registrado negativo</p>
            <p className="mt-0.5 opacity-90">
              Puede faltar un saldo inicial o un movimiento hecho fuera de
              Comerz. Abrí la cuenta para revisar sus movimientos.
            </p>
            {onDeclararSaldoInicial && (
              <button
                type="button"
                onClick={onDeclararSaldoInicial}
                className="mt-2 cursor-pointer font-semibold underline underline-offset-2"
              >
                Declarar saldo inicial
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function iconoDe(cuenta: SaldoCuenta) {
  if (cuenta.es_efectivo) return Banknote;
  return cuenta.tipo === "BILLETERA" ? Wallet : Landmark;
}

function etiquetaTipo(tipo: string) {
  return (
    (
      {
        CAJA_DIARIA: "Caja diaria",
        CAJA_GENERAL: "Efectivo administrado",
        BANCO: "Cuenta bancaria",
        BILLETERA: "Billetera virtual",
        OTRA: "Otra cuenta",
      } as Record<string, string>
    )[tipo] ?? tipo
  );
}
