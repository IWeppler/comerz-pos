import type { TurnoCajaHistorial } from "@/entities/caja/types";
import { formatTicketMoney } from "@/features/sales/ui/ticket-utils";
import { ingresosPorMetodo } from "../lib/ingresos-por-metodo";

/** Lo que el papel necesita de cada movimiento: solo para SUMAR. El
 * detalle renglón por renglón no se imprime — es un resumen del turno. */
export type MovimientoCierreZ = {
  tipo: "INGRESO" | "EGRESO";
  metodo: string;
  metodo_tipo: string;
  monto: number;
  comision: number;
  neto: number;
};

/** La cabecera del papel: lo que el page de /caja lee de `configuracion_pos`. */
export type PapelCierreZ = {
  nombreComercio: string | null;
  anchoTicketMm: number | null;
};

interface CierreZPrintableProps {
  turno: TurnoCajaHistorial;
  movimientos: MovimientoCierreZ[];
  papel: PapelCierreZ;
}

function fechaHora(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Lo que se imprime del cierre de un turno de caja.
 *
 * Mismo `#ticket-print-wrapper` y mismo CSS de impresión que el ticket de
 * venta y el recibo de cuenta corriente (`cssImpresionTicket`). Hasta acá el
 * botón "Imprimir Cierre Z" llamaba `window.print()` sin ningún papel: en /caja
 * no hay CSS de impresión, así que salía la pantalla entera recortada por el
 * sheet —o en blanco, si el CSS del ticket estaba cargado y escondía todo
 * porque no había wrapper que mostrar—.
 *
 * Es un RESUMEN, no la auditoría: arqueo de efectivo, cobros por medio y
 * firma. El detalle movimiento por movimiento queda en pantalla — en un
 * papel de 58 mm un turno de 60 ventas son dos metros de rollo que nadie lee.
 *
 * Los números salen del mismo estado que muestra el sheet: el papel no
 * recalcula nada. El arqueo se lee de arriba a abajo como se cuenta el cajón:
 * fondo inicial + lo que entró en efectivo − lo que salió = lo que tendría
 * que haber; contado; diferencia.
 */
export function CierreZPrintable({
  turno,
  movimientos,
  papel,
}: Readonly<CierreZPrintableProps>) {
  const nombreComercio = papel.nombreComercio || "Mi Comercio";
  const idCorto = turno.id.split("-")[0].toUpperCase();
  const cajero = turno.perfiles?.nombre || "-";

  const ingresosEfectivo = movimientos
    .filter((m) => m.tipo === "INGRESO" && m.metodo_tipo === "EFECTIVO")
    .reduce((acc, m) => acc + m.monto, 0);
  const egresos = movimientos
    .filter((m) => m.tipo === "EGRESO")
    .reduce((acc, m) => acc + m.monto, 0);
  const digitales = movimientos.filter(
    (m) => m.tipo === "INGRESO" && m.metodo_tipo !== "EFECTIVO",
  );
  const brutoDigital = digitales.reduce((acc, m) => acc + m.monto, 0);
  const comisionDigital = digitales.reduce((acc, m) => acc + m.comision, 0);
  const netoDigital = digitales.reduce((acc, m) => acc + m.neto, 0);

  // Por método, con conteo: es lo que se coteja contra el cierre del posnet.
  const porMetodo = ingresosPorMetodo(movimientos);

  const inicial = Number(turno.monto_inicial || 0);
  const esperadoAlCerrar = Number(turno.efectivo_esperado ?? 0);
  const esperado = inicial + ingresosEfectivo - egresos;
  const contado = Number(turno.monto_final || 0);
  const diferencia = contado - esperado;
  const diferenciaAlCerrar = contado - esperadoAlCerrar;
  const hayAjustePosterior =
    Math.abs(esperado - esperadoAlCerrar) >= 0.01;

  return (
    <div id="ticket-print-wrapper" className="hidden">
      <div className="bg-white text-black p-5 font-mono leading-relaxed">
        <div className="text-center pb-4 border-b-2 border-dashed border-gray-400">
          <h2 className="text-xl font-bold uppercase tracking-widest mb-1">
            {nombreComercio}
          </h2>
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1 text-sm">
          <p className="text-base font-bold uppercase">Cierre de caja</p>
          <p>
            Turno <span className="font-bold">#{idCorto}</span>
          </p>
          <p>Cajero/a: {cajero}</p>
          <p>Apertura: {fechaHora(turno.fecha_apertura)}</p>
          <p>Cierre: {fechaHora(turno.fecha_cierre)}</p>
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1.5 text-sm">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Arqueo de efectivo
          </p>
          <div className="flex justify-between">
            <span>Fondo inicial</span>
            <span>{formatTicketMoney(inicial)}</span>
          </div>
          <div className="flex justify-between">
            <span>Ingresos en efectivo</span>
            <span>+{formatTicketMoney(ingresosEfectivo)}</span>
          </div>
          <div className="flex justify-between">
            <span>Egresos</span>
            <span>-{formatTicketMoney(egresos)}</span>
          </div>
          <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-gray-300">
            <span>{hayAjustePosterior ? "Esperado corregido" : "Esperado"}</span>
            <span>{formatTicketMoney(esperado)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Contado</span>
            <span>{formatTicketMoney(contado)}</span>
          </div>
          <div className="flex justify-between items-center font-bold text-base pt-2 mt-2 border-t border-gray-300">
            <span>
              {diferencia === 0
                ? "DIFERENCIA"
                : diferencia < 0
                  ? "FALTANTE"
                  : "SOBRANTE"}
            </span>
            <span>
              {diferencia > 0 ? "+" : ""}
              {formatTicketMoney(diferencia)}
            </span>
          </div>
          {hayAjustePosterior && (
            <div className="mt-3 border border-gray-400 p-2 text-[10px]">
              <p className="font-bold uppercase">Corrección posterior al cierre</p>
              <div className="mt-1 flex justify-between">
                <span>Esperado original</span>
                <span>{formatTicketMoney(esperadoAlCerrar)}</span>
              </div>
              <div className="flex justify-between">
                <span>Diferencia original</span>
                <span>{formatTicketMoney(diferenciaAlCerrar)}</span>
              </div>
              <p className="mt-1">
                El arqueo firmado no fue reescrito; los importes principales
                reflejan los cobros corregidos.
              </p>
            </div>
          )}
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1.5 text-sm">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Cobros por medio
          </p>
          {porMetodo.length === 0 ? (
            <p className="text-xs text-gray-700">Sin cobros en este turno.</p>
          ) : (
            porMetodo.map(({ metodo, cantidad, monto }) => (
              <div key={metodo} className="flex justify-between text-xs">
                <span className="uppercase truncate pr-2">
                  {metodo} ({cantidad})
                </span>
                <span>{formatTicketMoney(monto)}</span>
              </div>
            ))
          )}
          {digitales.length > 0 && (
            <div className="pt-2 mt-2 border-t border-gray-300 space-y-1 text-xs text-gray-700">
              <div className="flex justify-between">
                <span>Digital bruto</span>
                <span>{formatTicketMoney(brutoDigital)}</span>
              </div>
              <div className="flex justify-between">
                <span>Comisiones</span>
                <span>-{formatTicketMoney(comisionDigital)}</span>
              </div>
              <div className="flex justify-between font-semibold text-black">
                <span>A acreditar</span>
                <span>{formatTicketMoney(netoDigital)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Conformidad de quien cerró: el cierre lo firma la cajera, y si hay
            diferencia, el papel firmado es lo que evita la discusión después. */}
        <div className="pt-5 text-xs space-y-4">
          <div>
            <div className="h-14 border-b border-black" />
            <p className="pt-1 text-gray-700">Firma responsable del turno</p>
          </div>
          <div>
            <div className="h-7 border-b border-black" />
            <p className="pt-1 text-gray-700">Aclaración y DNI</p>
          </div>
        </div>
      </div>
    </div>
  );
}
