import { createPublicClient } from "@/shared/config/supabase/server";
import { formatearMoneda } from "@/shared/utils/formatters";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
import { urlDeCatalogo } from "@/shared/lib/dominios";
import type { Metadata } from "next";
import Image from "next/image";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  agruparDeudaPorMes,
  deudaVivaDesdeFila,
  type FilaDeudaViva,
} from "@/features/clients/lib/deuda-por-mes";
import { DeudaPorMesLista } from "@/features/clients/ui/deuda-por-mes-lista";
import { CopiarDato } from "@/features/clients/ui/copiar-dato";
import {
  corteResumenCc,
  montoHastaCorte,
  movimientosHastaCorte,
  type MovimientoResumenCc,
} from "@/features/clients/lib/resumen-ciclo";
import type { CcVencimientoModo } from "@/features/clients/lib/calcular-fecha-vencimiento";

export const dynamic = "force-dynamic";

/** No se indexa: es la cuenta de una persona, no una vidriera. */
export const metadata: Metadata = {
  title: "Resumen de cuenta",
  robots: { index: false, follow: false },
};

type MovimientoResumen = MovimientoResumenCc;

type Resumen = {
  comercio: {
    nombre: string | null;
    direccion: string | null;
    whatsapp: string | null;
    /** El logo de la tienda (`posLogo`). Opcional: una base vieja no lo trae. */
    logo?: string | null;
    /** Solo si el catálogo está abierto (`20261008190000`). */
    catalogo_slug?: string | null;
    /** Alias o CBU/CVU para transferir (`20261008200000`). */
    alias?: string | null;
  };
  cliente: { nombre: string; telefono: string | null; dni: string | null };
  desde: string;
  hasta: string;
  emitido_en: string;
  saldo_anterior: number;
  saldo_actual: number;
  vence_el: string | null;
  /** Lo que sigue debiendo, por venta y con su vencimiento
   * (`cc_deudas_vivas_detalle`). Opcional: un deploy con la base vieja no lo
   * trae. */
  deudas?: FilaDeudaViva[];
  /** La regla de vencimiento del comercio (`20261006120000`). Opcional como
   * `deudas`: sin ella no se recorta. */
  regla_vencimiento?: {
    modo: CcVencimientoModo | null;
    plazo_dias: number | null;
    dia_cierre: number | null;
    dia_vencimiento: number | null;
  };
  movimientos: MovimientoResumen[];
};

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

/** El saldo corriente de una fila. Negativo es plata de la clienta: se dice
 * "a favor" en vez de un "-$5.000" que se lee como deuda. */
function saldoCuenta(saldo: number): string {
  return saldo < 0
    ? `${formatearMoneda(-saldo)} a favor`
    : formatearMoneda(saldo);
}

/**
 * Resumen de cuenta corriente, público por token.
 *
 * Es la página que abre la clienta desde el link de WhatsApp. Muestra el saldo
 * ACTUAL, no una foto del día que se mandó el mensaje: si pagó en el medio y
 * vuelve a abrir el mismo link, ve que está al día. Esa es la diferencia con
 * mandar un PDF, que queda desactualizado apenas se cierra.
 */
export default async function ResumenCuentaPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  const supabase = await createPublicClient();

  const { data } = await supabase.rpc("resumen_cuenta_por_token", {
    p_token: token,
  });

  const resumen = data as Resumen | null;

  // Token inexistente y token mal escrito se ven IGUAL, a propósito: una
  // pantalla distinta para "existe pero no es tuyo" confirmaría que existe.
  if (!resumen) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6 bg-background">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-foreground">
            No encontramos este resumen
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            El link puede haber cambiado. Pedile uno nuevo al comercio.
          </p>
        </div>
      </main>
    );
  }

  const { comercio, cliente } = resumen;
  const hoy = diaComercial(new Date());
  const deudas = (resumen.deudas ?? []).map(deudaVivaDesdeFila);

  // Cierre mensual: el resumen es lo que hay que pagar en este ciclo (deuda
  // vieja incluida); lo comprado después del cierre vence el mes que viene y
  // no aparece (ver `corteResumenCc`). Es el mismo monto que manda el
  // mensaje de WhatsApp.
  const regla = resumen.regla_vencimiento;
  const corte = regla
    ? corteResumenCc(
        {
          modo: regla.modo,
          plazoDias: regla.plazo_dias,
          diaCierre: regla.dia_cierre,
          diaVencimiento: regla.dia_vencimiento,
        },
        hoy,
        deudas,
      )
    : null;

  const saldoMostrado = corte
    ? montoHastaCorte(deudas, corte)
    : resumen.saldo_actual;
  const movimientos = corte
    ? movimientosHastaCorte(resumen.movimientos, resumen.saldo_anterior, corte)
    : resumen.movimientos;

  const alDia = saldoMostrado <= 0;
  // Saldo con signo: negativo es plata de la clienta (seña, pago de más, vale).
  const aFavor = saldoMostrado < 0;
  // Qué vence cada mes, con la misma regla y la misma lista que el detalle
  // del cliente adentro. Un solo "vence el" mentía: es el vencimiento MÁS
  // VIEJO, y la clienta leía que todo el saldo vencía ese día (EESO 405 en
  // Colores: $276.450 "vence el 10/10" cuando ese día vencían $98.850).
  const grupos = agruparDeudaPorMes(
    corte ? deudas.filter((d) => d.venceEl <= corte) : deudas,
    hoy,
  );

  return (
    <main className="min-h-dvh bg-muted/20 py-6 px-4">
      <div className="mx-auto w-full max-w-2xl bg-card border border-border rounded-xl overflow-hidden">
        {/* CABECERA — de quién es la cuenta y con quién */}
        <header className="p-5 border-b border-border">
          <div className="flex items-center gap-3">
            {comercio.logo ? (
              <div className="size-12 shrink-0 rounded-lg overflow-hidden border border-border bg-background">
                <Image
                  src={comercio.logo}
                  alt={`Logo de ${comercio.nombre ?? "el comercio"}`}
                  width={48}
                  height={48}
                  className="size-full object-cover"
                />
              </div>
            ) : (
              // Sin logo, la inicial: el comercio se reconoce igual y la
              // cabecera no salta de forma según quién la mande.
              <div
                aria-hidden
                className="size-12 shrink-0 rounded-lg bg-muted flex items-center justify-center text-lg font-bold text-foreground"
              >
                {(comercio.nombre ?? "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground leading-tight truncate">
                {comercio.nombre}
              </h1>
              {comercio.direccion && (
                <p className="text-xs text-muted-foreground truncate">
                  {comercio.direccion}
                </p>
              )}
            </div>
          </div>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Resumen de cuenta corriente
          </p>

          <div className="mt-1">
            <p className="text-sm font-semibold text-foreground">
              {cliente.nombre}
            </p>
            <p className="text-xs text-muted-foreground">
              Período: {fechaCorta(resumen.desde)} al {fechaCorta(resumen.hasta)}
            </p>
          </div>
        </header>

        {/* MOVIMIENTOS — con el saldo corriente a la derecha, que es lo que
            hace que el número cierre con lo que la clienta recuerda. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-4 py-2">Fecha</th>
                <th className="text-left font-medium px-4 py-2">Concepto</th>
                <th className="text-right font-medium px-4 py-2 whitespace-nowrap">
                  Cargo / Pago
                </th>
                <th className="text-right font-medium px-4 py-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 text-muted-foreground">
                <td className="px-4 py-2" colSpan={3}>
                  Saldo anterior
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {saldoCuenta(resumen.saldo_anterior)}
                </td>
              </tr>

              {movimientos.map((m, i) => {
                const esCargo = m.tipo === "DEBITO";
                return (
                  <tr
                    key={`${m.fecha}-${i}`}
                    className="border-b border-border/60"
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {fechaCorta(m.fecha)}
                    </td>
                    <td className="px-4 py-2 text-foreground">{m.concepto}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${
                        esCargo ? "text-foreground" : "text-success"
                      }`}
                    >
                      {esCargo ? "" : "− "}
                      {formatearMoneda(m.monto)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {saldoCuenta(m.saldo)}
                    </td>
                  </tr>
                );
              })}

              {movimientos.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-6 text-center text-muted-foreground text-xs"
                    colSpan={4}
                  >
                    Sin movimientos en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* TOTAL */}
        <div className="p-5 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {aFavor ? "Saldo a favor" : alDia ? "Saldo" : "Total a pagar"}
            </span>
            <span
              className={`text-xl font-bold tabular-nums ${
                alDia ? "text-success" : "text-foreground"
              }`}
            >
              {formatearMoneda(Math.abs(saldoMostrado))}
            </span>
          </div>

          {aFavor ? (
            <p className="text-xs text-success mt-1">
              Tenés {formatearMoneda(-saldoMostrado)} a favor para tu
              próxima compra.
            </p>
          ) : alDia ? (
            <p className="text-xs text-success mt-1">
              Tu cuenta está al día. ¡Gracias!
            </p>
          ) : grupos.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Qué vence cada mes:
              </p>
              <DeudaPorMesLista grupos={grupos} />
            </div>
          ) : (
            resumen.vence_el && (
              <p className="text-xs text-muted-foreground mt-1">
                Vence el {fechaCorta(resumen.vence_el)}.
              </p>
            )
          )}
        </div>

        {/* TRANSFERENCIA — alias y monto para copiar y pegar en su app. No
            hay forma estándar de abrir la transferencia ya cargada sin una
            pasarela; la clienta confirma mandando el comprobante por
            WhatsApp. Solo si debe algo y el comercio cargó su alias. */}
        {comercio.alias && saldoMostrado > 0 && (
          <div className="p-5 border-t border-border space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Pagá por transferencia
            </p>
            <CopiarDato etiqueta="Alias" valor={comercio.alias} />
            <CopiarDato
              etiqueta="Monto"
              valor={formatearMoneda(saldoMostrado)}
              textoACopiar={saldoMostrado.toFixed(2).replace(/\.00$/, "")}
            />
            <p className="text-[11px] text-muted-foreground">
              Después mandale el comprobante a {comercio.nombre} por WhatsApp.
            </p>
          </div>
        )}

        {/* CATÁLOGO — solo si el comercio lo tiene abierto. La clienta ya
            está mirando al comercio: es el momento de mostrarle la vidriera. */}
        {comercio.catalogo_slug && (
          <div className="p-5 border-t border-border">
            <a
              href={urlDeCatalogo(comercio.catalogo_slug)}
              className={cn(
                buttonVariants({ size: "lg" }),
                "w-full whitespace-normal text-center",
              )}
            >
              Ver el catálogo de {comercio.nombre}
            </a>
          </div>
        )}
      </div>

      <footer className="mx-auto w-full max-w-2xl mt-4 text-center text-[11px] text-muted-foreground">
        Gestión de cuenta corriente con Comerz ·{" "}
        <a
          href="https://www.comerz.app"
          target="_blank"
          rel="noopener"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          www.comerz.app
        </a>
      </footer>
    </main>
  );
}
