import { formatTicketMoney } from "@/features/sales/ui/ticket-utils";
import {
  lineasCuentaRecibo,
  numeroReciboCC,
  type ReciboCobroCC,
} from "../lib/recibo-cc";

interface ReciboCcPrintableProps {
  recibo: ReciboCobroCC;
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso;
}

/**
 * El papel del cobro de cuenta corriente.
 *
 * Usa el MISMO `id="ticket-print-wrapper"` y el mismo CSS de impresión que el
 * ticket de venta (`cssImpresionTicket`): es la regla que esconde toda la app
 * y deja solo el papel, y no tiene sentido tener dos. Va dentro de un
 * `.ticket-sheet-print-scope`, igual que aquel.
 *
 * Lo que dice, en orden de lo que la clienta pregunta: cuánto pagó, con qué,
 * cuánto debía, cuánto le queda y para cuándo. Nunca lleva "no válido como
 * factura" — un recibo de pago a cuenta no es una factura ni pretende serlo.
 */
export function ReciboCcPrintable({ recibo }: Readonly<ReciboCcPrintableProps>) {
  const nombreComercio = recibo.comercio.nombre || "Mi Comercio";
  const direccionComercio = recibo.comercio.direccion || "";
  const whatsappComercio = recibo.comercio.whatsapp || "";
  const lineas = lineasCuentaRecibo(recibo);

  return (
    <div id="ticket-print-wrapper" className="hidden">
      <div className="bg-white text-black p-5 font-mono leading-relaxed">
        <div className="text-center pb-4 border-b-2 border-dashed border-gray-400">
          <h2 className="text-xl font-bold uppercase tracking-widest mb-1">
            {nombreComercio}
          </h2>
          {direccionComercio && (
            <p className="text-xs text-gray-700">{direccionComercio}</p>
          )}
          {whatsappComercio && (
            <p className="text-xs text-gray-700">WhatsApp: {whatsappComercio}</p>
          )}
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1 text-sm">
          <p className="text-base font-bold uppercase">Recibo de pago</p>
          <p>
            Nº <span className="font-bold">{numeroReciboCC(recibo)}</span>
          </p>
          <p>{fechaHora(recibo.fecha)}</p>
          <p>Cliente: {recibo.clienteNombre}</p>
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1.5 text-sm">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Pago
          </p>
          <div className="flex justify-between">
            <span>Pago a cuenta</span>
            <span>{formatTicketMoney(recibo.montoBase)}</span>
          </div>
          {recibo.recargoMetodoMonto > 0 && (
            <div className="flex justify-between text-gray-700 text-xs">
              <span className="truncate pr-2">
                Recargo {recibo.metodoNombre} ({recibo.recargoMetodoPorcentaje}%)
              </span>
              <span>+{formatTicketMoney(recibo.recargoMetodoMonto)}</span>
            </div>
          )}
          <div className="flex justify-between items-center font-semibold text-base pt-2 mt-2 border-t border-gray-300">
            <span>TOTAL PAGADO</span>
            <span>{formatTicketMoney(recibo.montoBruto)}</span>
          </div>
          <p className="text-xs font-bold uppercase pt-1">{recibo.metodoNombre}</p>
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1.5 text-sm">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Cuenta corriente
          </p>
          {lineas.map((linea) => (
            <div
              key={linea.etiqueta}
              className={`flex justify-between ${linea.signo ? "text-gray-700 text-xs" : ""}`}
            >
              <span>{linea.etiqueta}</span>
              <span>
                {linea.signo}
                {formatTicketMoney(linea.monto)}
              </span>
            </div>
          ))}
          <div className="flex justify-between items-center font-semibold text-base pt-2 mt-2 border-t border-gray-300">
            <span>SALDO</span>
            <span>{formatTicketMoney(recibo.saldoNuevo)}</span>
          </div>
          {recibo.saldoNuevo > 0 && recibo.fechaVencimiento && (
            <div className="flex justify-between text-xs text-gray-700">
              <span>Vence</span>
              <span>{fechaCorta(recibo.fechaVencimiento)}</span>
            </div>
          )}
        </div>

        {/* Conformidad del cliente: firma y DNI a mano. Es lo que convierte
            el papel en un recibo que las dos partes pueden mostrar después
            —la clienta que pagó, y el comercio si la clienta dice que no—.
            El espacio de la firma va ALTO a propósito: en un papel de 58 mm
            una línea sola no deja lugar para firmar de verdad. */}
        <div className="pt-5 text-xs space-y-4">
          <div>
            <div className="h-14 border-b border-black" />
            <p className="pt-1 text-gray-700">Firma del cliente</p>
          </div>
          <div>
            <div className="h-7 border-b border-black" />
            <p className="pt-1 text-gray-700">Aclaración y DNI</p>
          </div>
        </div>

        <div className="text-center pt-4 text-xs space-y-1">
          <p className="font-bold">
            {recibo.saldoNuevo > 0 ? "Gracias por su pago!" : "Cuenta al día. Gracias!"}
          </p>
        </div>
      </div>
    </div>
  );
}
