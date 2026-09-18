import { TicketData } from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import {
  formatTicketMoney,
  getTicketFinancialSummary,
  getTicketSubtotal,
} from "./ticket-utils";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import {
  codigoArcaComprobante,
  discriminaIvaEnPapel,
  fechaCorta,
  numeroComprobanteFiscal,
  receptorTexto,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";

interface TicketPrintableProps {
  ticket: TicketData | null;
  config: ConfiguracionPOS | null;
  /** QR de la factura (RG 4892), ya generado. Solo con `ticket.fiscal`. */
  qrDataUrl?: string | null;
}

/**
 * El papel. Dos versiones sobre el mismo template:
 *
 *  - TICKET INTERNO: nombre de fantasía, "Comprobante #", y al pie la
 *    leyenda "Documento no válido como factura". Es lo de siempre.
 *  - FACTURA (con `ticket.fiscal`): letra y código de ARCA arriba,
 *    razón social + CUIT + condición de IVA + inicio de actividades del
 *    emisor, número 00001-00000012, receptor identificado, IVA discriminado
 *    solo en la A, y al pie CAE + vencimiento + QR. La leyenda de "no válido"
 *    NO va: que un papel con CAE la lleve es tan malo como que uno sin CAE no
 *    la lleve. En homologación se imprime "PRUEBA — SIN VALOR FISCAL" grande.
 */
export function TicketPrintable({
  ticket,
  config,
  qrDataUrl,
}: Readonly<TicketPrintableProps>) {
  const nombreComercio = config?.posName || "Mi Comercio";
  const direccionComercio = config?.direccion || "Sin direccion";
  const whatsappComercio = config?.whatsapp || "";
  const mensajeDespedida = config?.mensaje_ticket || "Gracias por su compra!";
  const subtotalCarrito = getTicketSubtotal(ticket);
  const { esFiado, montoCobrado, montoPendiente, pagosDesglosados } =
    getTicketFinancialSummary(ticket);
  const fiscal = ticket?.fiscal ?? null;
  const esNotaCredito = fiscal?.tipo.startsWith("NOTA_CREDITO") ?? false;

  return (
    <div id="ticket-print-wrapper" className="hidden">
      <div className="bg-white text-black p-5 font-mono leading-relaxed">
        {fiscal?.ambiente === "HOMOLOGACION" && (
          <p className="text-center text-xs font-bold border-2 border-black py-1 mb-3">
            PRUEBA (HOMOLOGACIÓN) — SIN VALOR FISCAL
          </p>
        )}

        <div className="text-center pb-4 border-b-2 border-dashed border-gray-400">
          <h2 className="text-xl font-bold uppercase tracking-widest mb-1">
            {nombreComercio}
          </h2>
          {fiscal && config?.razon_social && (
            <p className="text-xs font-bold">{config.razon_social}</p>
          )}
          <p className="text-xs text-gray-700">{direccionComercio}</p>
          {whatsappComercio && (
            <p className="text-xs text-gray-700">
              WhatsApp: {whatsappComercio}
            </p>
          )}
          {fiscal && (
            <div className="text-xs text-gray-700 mt-1">
              {config?.cuit && <p>CUIT: {config.cuit}</p>}
              {config?.condicion_iva && <p>{config.condicion_iva}</p>}
              {config?.inicio_actividades && (
                <p>Inicio de actividades: {fechaCorta(config.inicio_actividades)}</p>
              )}
            </div>
          )}
        </div>

        {fiscal ? (
          <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1 text-sm">
            <div className="flex justify-between items-baseline">
              <span className="text-base font-bold">{tituloComprobante(fiscal.tipo)}</span>
              <span className="text-[10px] text-gray-700">
                COD. {codigoArcaComprobante(fiscal.tipo)}
              </span>
            </div>
            <p className="text-[10px] uppercase text-gray-700">Original</p>
            <p>
              Nº <span className="font-bold">{numeroComprobanteFiscal(fiscal)}</span>
            </p>
            <p>Fecha: {fechaCorta(fiscal.fechaComprobante)}</p>
            <p>Vend: {ticket?.vendedor || "Administrador"}</p>
            <p>Cliente: {receptorTexto(fiscal)}</p>
            {fiscal.receptor.condicionIva && (
              <p className="text-xs text-gray-700">
                IVA: {fiscal.receptor.condicionIva}
              </p>
            )}
          </div>
        ) : (
          <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1 text-sm">
            <p>
              Comprobante{" "}
              <span className="font-bold">#{ticket?.nroRecibo}</span>
            </p>
            <p>
              {ticket?.fecha ||
                new Date().toLocaleString("es-AR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
            </p>
            <p>Vend: {ticket?.vendedor || "Administrador"}</p>
            <p>Cliente: {ticket?.clienteNombre || "Consumidor final"}</p>
          </div>
        )}

        <div className="py-4 border-b-2 border-dashed border-gray-400 space-y-3">
          {ticket?.items.map((item, idx) => {
            const precioUnitario = item.precioUnitario || item.precio || 0;
            const totalItem = precioUnitario * item.cantidad;
            return (
              <div key={idx} className="flex flex-col">
                <p className="font-bold uppercase leading-tight text-sm">
                  {/* Por unidad: "3x Remera". Por peso: "0,75 kg Jamón" — sin
                      la "x", porque el cliente controla ese número contra lo
                      que marcó la balanza y "0.75x" no se parece a nada de lo
                      que vio en el mostrador. */}
                  {!item.presentacionNombre && esFraccionable(item.unidadMedida)
                    ? `${formatearCantidad(item.cantidad, item.unidadMedida)} `
                    : `${item.cantidad}x `}
                  {item.nombre} {item.variante && `(${item.variante})`}
                  {item.presentacionNombre && ` — ${item.presentacionNombre}`}
                </p>
                {/* El IMEI va en el ticket porque es el comprobante con el
                    que el cliente reclama la garantía del aparato. */}
                {item.imei && (
                  <p className="font-mono text-[10px] leading-tight text-gray-700">
                    IMEI: {item.imei}
                  </p>
                )}
                <div className="flex justify-between items-center text-gray-700 text-xs mt-0.5">
                  {/* "c/u" es correcto solo si la unidad es la pieza. En un
                      producto por peso el precio es por kilo, y decir "c/u"
                      sobre $8.500 hace parecer que ese es el precio de lo que
                      se llevó. */}
                  <span>
                    {formatTicketMoney(precioUnitario)}{" "}
                    {!item.presentacionNombre && esFraccionable(item.unidadMedida)
                      ? `/${ABREVIATURA_UNIDAD[normalizarUnidadMedida(item.unidadMedida)]}`
                      : "c/u"}
                  </span>
                  <span className="font-bold text-black text-sm">
                    {formatTicketMoney(totalItem)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="py-3 border-b-2 border-dashed border-gray-400 space-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span>Subtotal</span>
            <span>{formatTicketMoney(subtotalCarrito)}</span>
          </div>

          {(ticket?.descuentoMonto ?? 0) > 0 && (
            <div className="flex justify-between items-center text-gray-700">
              <span className="truncate pr-2">
                Desc. ({ticket?.promocionNombre})
              </span>
              <span>-{formatTicketMoney(ticket?.descuentoMonto)}</span>
            </div>
          )}

          {(ticket?.recargoMetodoMonto ?? 0) > 0 && (
            <div className="flex justify-between items-center text-gray-700">
              <span className="truncate pr-2">
                {ticket?.recargoMetodoEtiqueta || "Recargo método de pago"}
              </span>
              <span>+{formatTicketMoney(ticket?.recargoMetodoMonto)}</span>
            </div>
          )}

          {/* Solo la A discrimina: neto, IVA por alícuota y exento. En B y
              C el total ya lleva el IVA adentro y el papel no lo abre. */}
          {fiscal && discriminaIvaEnPapel(fiscal.tipo) && (
            <div className="text-xs text-gray-700 space-y-0.5 pt-1">
              <div className="flex justify-between">
                <span>Neto gravado</span>
                <span>{formatTicketMoney(fiscal.neto)}</span>
              </div>
              {fiscal.iva.map((a) => (
                <div className="flex justify-between" key={a.alicuota}>
                  <span>IVA {a.alicuota}%</span>
                  <span>{formatTicketMoney(a.importe)}</span>
                </div>
              ))}
              {fiscal.exento > 0 && (
                <div className="flex justify-between">
                  <span>Exento</span>
                  <span>{formatTicketMoney(fiscal.exento)}</span>
                </div>
              )}
              {fiscal.noGravado > 0 && (
                <div className="flex justify-between">
                  <span>No gravado</span>
                  <span>{formatTicketMoney(fiscal.noGravado)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center font-semibold text-base pt-2 mt-2 border-t border-gray-300">
            <span>TOTAL</span>
            <span>{formatTicketMoney(ticket?.total)}</span>
          </div>

          {/* Con qué lista se cobró. Solo cuando NO es el precio base: es el
              papel que el cliente presenta si después reclama por el precio,
              y en una venta normal no hay nada que aclarar. */}
          {ticket?.listaPrecioNombre && (
            <div className="flex justify-between items-center text-gray-700">
              <span>Lista</span>
              <span className="font-medium">{ticket.listaPrecioNombre}</span>
            </div>
          )}

          <div className="pt-2 mt-2">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
              {esNotaCredito
                ? "Se devuelve por"
                : esFiado
                  ? "Cuenta corriente"
                  : "Medios de pago"}
            </p>
            {esFiado ? (
              <>
                <div className="flex justify-between text-xs font-bold uppercase">
                  <span>Anticipo</span>
                  <span>{formatTicketMoney(montoCobrado)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold uppercase">
                  <span>Saldo</span>
                  <span>{formatTicketMoney(montoPendiente)}</span>
                </div>
              </>
            ) : pagosDesglosados.length > 0 ? (
              pagosDesglosados.map((p, idx) => (
                <div
                  key={`${p.nombre}-print-${idx}`}
                  className="flex justify-between text-xs font-bold uppercase"
                >
                  <span>{p.nombre}</span>
                  <span>{formatTicketMoney(p.monto)}</span>
                </div>
              ))
            ) : (
              <p className="text-xs uppercase font-bold">
                {ticket?.metodoPago}
              </p>
            )}
          </div>
        </div>

        {fiscal && (
          <div className="py-3 border-b-2 border-dashed border-gray-400 flex items-center gap-3">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data URL para imprimir, sin optimización
              <img src={qrDataUrl} alt="QR ARCA" className="w-24 h-24 shrink-0" />
            )}
            <div className="text-xs space-y-0.5">
              <p>
                CAE: <span className="font-bold">{fiscal.cae}</span>
              </p>
              <p>Vto. CAE: {fechaCorta(fiscal.caeVencimiento)}</p>
              <p className="text-[10px] text-gray-700">
                Comprobante autorizado por ARCA
              </p>
            </div>
          </div>
        )}

        <div className="text-center pt-4 text-xs space-y-1">
          {!esNotaCredito && <p className="font-bold">{mensajeDespedida}</p>}
          {!fiscal && (
            <p className="text-gray-500">Documento no valido como factura</p>
          )}
        </div>
      </div>
    </div>
  );
}
