import { createPublicClient } from "@/shared/config/supabase/server";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** No se indexa: es la cuenta de una persona, no una vidriera. */
export const metadata: Metadata = {
  title: "Resumen de cuenta",
  robots: { index: false, follow: false },
};

type MovimientoResumen = {
  fecha: string;
  concepto: string;
  tipo: "DEBITO" | "CREDITO";
  monto: number;
  saldo: number;
};

type Resumen = {
  comercio: { nombre: string | null; direccion: string | null; whatsapp: string | null };
  cliente: { nombre: string; telefono: string | null; dni: string | null };
  desde: string;
  hasta: string;
  emitido_en: string;
  saldo_anterior: number;
  saldo_actual: number;
  vence_el: string | null;
  movimientos: MovimientoResumen[];
};

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
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

  const { comercio, cliente, movimientos } = resumen;
  const alDia = resumen.saldo_actual <= 0;
  // Saldo con signo: negativo es plata de la clienta (seña, pago de más, vale).
  const aFavor = resumen.saldo_actual < 0;

  return (
    <main className="min-h-dvh bg-muted/20 py-6 px-4">
      <div className="mx-auto w-full max-w-2xl bg-card border border-border rounded-xl overflow-hidden">
        {/* CABECERA — de quién es la cuenta y con quién */}
        <header className="p-5 border-b border-border">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Resumen de cuenta corriente
          </p>
          <h1 className="text-lg font-bold text-foreground mt-1">
            {comercio.nombre}
          </h1>
          {comercio.direccion && (
            <p className="text-xs text-muted-foreground">{comercio.direccion}</p>
          )}

          <div className="mt-4 pt-3 border-t border-border">
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
              {formatearMoneda(Math.abs(resumen.saldo_actual))}
            </span>
          </div>

          {aFavor ? (
            <p className="text-xs text-success mt-1">
              Tenés {formatearMoneda(-resumen.saldo_actual)} a favor para tu
              próxima compra.
            </p>
          ) : alDia ? (
            <p className="text-xs text-success mt-1">
              Tu cuenta está al día. ¡Gracias!
            </p>
          ) : (
            resumen.vence_el && (
              <p className="text-xs text-muted-foreground mt-1">
                Vence el {fechaCorta(resumen.vence_el)}.
              </p>
            )
          )}

          {comercio.whatsapp && !alDia && (
            <a
              href={`https://wa.me/${comercio.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center mt-4 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
            >
              Escribirle al comercio
            </a>
          )}
        </div>

        {/* PIE — la fecha de emisión evita la discusión de "esto es viejo", y
            la aclaración fiscal evita que un resumen se confunda con una
            factura. Con ARCA en el horizonte eso no es un detalle. */}
        <footer className="px-5 py-4 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            Emitido el {fechaHora(resumen.emitido_en)}. Los importes se
            actualizan cada vez que abrís este link.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Resumen de cuenta corriente — documento no válido como factura.
          </p>
        </footer>
      </div>
    </main>
  );
}
