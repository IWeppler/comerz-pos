import { formatTicketMoney } from "@/features/sales/ui/ticket-utils";
import {
  lineasCuentaRecibo,
  numeroReciboCC,
  type ReciboCobroCC,
} from "../lib/recibo-cc";

interface ReciboCcPrintableProps {
  recibo: ReciboCobroCC;
}

/** Quién se queda con este papel. Es lo único que cambia entre las dos copias
 * que salen de una sola impresión. */
type CopiaRecibo = "CLIENTE" | "COMERCIO";

const ETIQUETA_COPIA: Record<CopiaRecibo, string> = {
  CLIENTE: "Copia cliente",
  COMERCIO: "Copia comercio",
};

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

interface CuerpoReciboProps {
  recibo: ReciboCobroCC;
  copia: CopiaRecibo;
  /** El corte de página que separa una copia de la otra. La última NO lo
   * lleva: sería una hoja en blanco al final (o papel de más en la térmica). */
  cortar: boolean;
}

/**
 * Un papel. Los mismos números en las dos copias; lo único distinto es el
 * rótulo de arriba y el espacio de firma, que va SOLO en la del comercio.
 */
function CuerpoRecibo({ recibo, copia, cortar }: Readonly<CuerpoReciboProps>) {
  const nombreComercio = recibo.comercio.nombre || "Mi Comercio";
  const direccionComercio = recibo.comercio.direccion || "";
  const whatsappComercio = recibo.comercio.whatsapp || "";
  const lineas = lineasCuentaRecibo(recibo);

  return (
    <div
      className={`bg-white text-black p-5 font-mono leading-relaxed ${
        cortar ? "recibo-copia-corte" : ""
      }`}
    >
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
        <p className="text-[10px] font-bold uppercase tracking-widest pt-2">
          {ETIQUETA_COPIA[copia]}
        </p>
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
          el papel en un recibo que el comercio puede mostrar después, si la
          clienta dice que no pagó. Va SOLO en la copia del comercio: la que
          se lleva la clienta no la firma nadie, es su constancia.
          El espacio de la firma va ALTO a propósito: en un papel de 58 mm
          una línea sola no deja lugar para firmar de verdad. */}
      {copia === "COMERCIO" && (
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
      )}

      <div className="text-center pt-4 text-xs space-y-1">
        <p className="font-bold">
          {recibo.saldoNuevo > 0 ? "Gracias por su pago!" : "Cuenta al día. Gracias!"}
        </p>
      </div>
    </div>
  );
}

/**
 * El papel del cobro de cuenta corriente. Salen DOS de una sola impresión:
 * primero la del cliente (sin firma, es su constancia) y después la del
 * comercio (con el espacio de firma, que la clienta firma en el mostrador).
 * Antes era un solo papel con firma, así que o se lo llevaba firmado la
 * clienta y el comercio quedaba sin prueba, o había que imprimir dos veces.
 *
 * Las dos van DENTRO del mismo `#ticket-print-wrapper`: la regla de impresión
 * esconde toda la app y deja visible ese árbol, así que separarlas en dos
 * wrappers dejaría una sin imprimir (el id es único). Lo que las parte en dos
 * papeles es `break-after: page` (clase `recibo-copia-corte`, definida en
 * `cssImpresionTicket`), y por eso lo lleva solo la primera: en la última
 * sería una hoja en blanco de más.
 *
 * Usa el MISMO `id="ticket-print-wrapper"` y el mismo CSS de impresión que el
 * ticket de venta (`cssImpresionTicket`), y va dentro de un
 * `.ticket-sheet-print-scope`, igual que aquel.
 *
 * Lo que dice, en orden de lo que la clienta pregunta: cuánto pagó, con qué,
 * cuánto debía, cuánto le queda y para cuándo. Nunca lleva "no válido como
 * factura" — un recibo de pago a cuenta no es una factura ni pretende serlo.
 */
export function ReciboCcPrintable({ recibo }: Readonly<ReciboCcPrintableProps>) {
  return (
    <div id="ticket-print-wrapper" className="ticket-print-multicopia hidden">
      <CuerpoRecibo recibo={recibo} copia="CLIENTE" cortar />
      <CuerpoRecibo recibo={recibo} copia="COMERCIO" cortar={false} />
    </div>
  );
}
