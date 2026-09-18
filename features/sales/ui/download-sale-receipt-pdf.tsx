"use client";

import { TicketData } from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import {
  codigoArcaComprobante,
  discriminaIvaEnPapel,
  fechaCorta,
  numeroComprobanteFiscal,
  receptorTexto,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";
import { getTicketFinancialSummary, getTicketSubtotal } from "./ticket-utils";
import { entregarArchivo } from "../lib/entregar-archivo";

// Estilos específicos para el PDF
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", backgroundColor: "#ffffff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 20,
  },
  headerLeft: { flexDirection: "column" },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 4,
  },
  subtitle: { fontSize: 10, color: "#64748b" },
  infoSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  infoBox: { flexDirection: "column" },
  infoTitle: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  infoText: { fontSize: 11, color: "#0f172a", fontWeight: "bold" },
  table: { width: "100%", marginBottom: 30 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 8,
    marginBottom: 8,
  },
  colQty: { width: "10%", fontSize: 10, color: "#64748b", fontWeight: "bold" },
  colDesc: { width: "50%", fontSize: 10, color: "#64748b", fontWeight: "bold" },
  colPrice: {
    width: "20%",
    fontSize: 10,
    color: "#64748b",
    fontWeight: "bold",
    textAlign: "right",
  },
  colTotal: {
    width: "20%",
    fontSize: 10,
    color: "#64748b",
    fontWeight: "bold",
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  rowText: { fontSize: 11, color: "#334155" },
  rowTextBold: { fontSize: 11, color: "#0f172a", fontWeight: "bold" },
  totalsSection: {
    width: "40%",
    alignSelf: "flex-end",
    flexDirection: "column",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    marginTop: 4,
  },
  totalLabel: { fontSize: 10, color: "#64748b" },
  totalValue: { fontSize: 10, color: "#334155" },
  totalLabelBig: { fontSize: 12, color: "#0f172a", fontWeight: "bold" },
  totalValueBig: { fontSize: 14, color: "#0f172a", fontWeight: "bold" },
  footer: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 10,
  },
  footerText: { fontSize: 9, color: "#94a3b8" },
});

// Componente React-PDF que define la estructura del documento
const ReceiptDocument = ({
  ticket,
  config,
  qrDataUrl,
}: {
  ticket: TicketData;
  config: ConfiguracionPOS | null;
  /** QR de ARCA como data URL. Solo con `ticket.fiscal`. */
  qrDataUrl?: string | null;
}) => {
  // Con factura, el PDF ES la factura: letra, número, CAE, QR, y sin la
  // leyenda de "no válido". Mismo criterio que ticket-printable.tsx.
  const fiscal = ticket.fiscal ?? null;
  /**
   * El subtotal y el resumen financiero salen de `ticket-utils`, igual que en
   * el ticket impreso y en el texto de WhatsApp.
   *
   * Hasta el 8/9/2026 este archivo los calculaba por su cuenta —el subtotal a
   * mano y un `isFiado` con su propia condición— así que era el ÚNICO de los
   * tres comprobantes que podía decir algo distinto de los otros dos sobre la
   * misma venta. Tres formas de responder "¿cuánto quedó debiendo?" terminan
   * en tres respuestas.
   */
  const subtotal = getTicketSubtotal(ticket);
  const { esFiado: isFiado, montoCobrado, montoPendiente, pagosDesglosados } =
    getTicketFinancialSummary(ticket);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {fiscal?.ambiente === "HOMOLOGACION" && (
          <Text
            style={{
              fontSize: 10,
              fontWeight: "bold",
              textAlign: "center",
              borderWidth: 1,
              borderColor: "#0f172a",
              padding: 4,
              marginBottom: 12,
            }}
          >
            PRUEBA (HOMOLOGACIÓN) — SIN VALOR FISCAL
          </Text>
        )}

        {/* Cabecera */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>
              {config?.posName?.toUpperCase() || "COMPROBANTE"}
            </Text>
            {fiscal && config?.razon_social && (
              <Text style={[styles.subtitle, { fontWeight: "bold", color: "#0f172a" }]}>
                {config.razon_social}
              </Text>
            )}
            <Text style={styles.subtitle}>{config?.direccion || ""}</Text>
            {config?.whatsapp && (
              <Text style={styles.subtitle}>Tel: {config.whatsapp}</Text>
            )}
            {fiscal && config?.cuit && (
              <Text style={styles.subtitle}>CUIT: {config.cuit}</Text>
            )}
            {fiscal && config?.condicion_iva && (
              <Text style={styles.subtitle}>{config.condicion_iva}</Text>
            )}
            {fiscal && config?.inicio_actividades && (
              <Text style={styles.subtitle}>
                Inicio de actividades: {fechaCorta(config.inicio_actividades)}
              </Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "bold",
                color: "#0f172a",
                marginBottom: 4,
              }}
            >
              {fiscal ? tituloComprobante(fiscal.tipo) : "COMPROBANTE"}
            </Text>
            {fiscal ? (
              <>
                <Text style={styles.subtitle}>
                  ORIGINAL · COD. {codigoArcaComprobante(fiscal.tipo)}
                </Text>
                <Text style={[styles.subtitle, { fontWeight: "bold", color: "#0f172a" }]}>
                  Nº {numeroComprobanteFiscal(fiscal)}
                </Text>
                <Text style={styles.subtitle}>
                  Fecha: {fechaCorta(fiscal.fechaComprobante)}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.subtitle}>Nº #{ticket.nroRecibo}</Text>
                <Text style={styles.subtitle}>
                  {ticket.fecha || new Date().toLocaleString("es-AR")}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Info del Cliente */}
        <View style={styles.infoSection}>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Cliente</Text>
            <Text style={styles.infoText}>
              {fiscal
                ? receptorTexto(fiscal)
                : ticket.clienteNombre || "Consumidor Final"}
            </Text>
            {fiscal?.receptor.condicionIva && (
              <Text style={styles.subtitle}>IVA: {fiscal.receptor.condicionIva}</Text>
            )}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Condición de Pago</Text>
            <Text style={styles.infoText}>
              {isFiado ? "Cuenta Corriente" : "Contado"}
            </Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Vendedor</Text>
            <Text style={styles.infoText}>
              {ticket.vendedor || "Administrador"}
            </Text>
          </View>
        </View>

        {/* Tabla de Productos */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colQty}>CANT.</Text>
            <Text style={styles.colDesc}>DESCRIPCIÓN</Text>
            <Text style={styles.colPrice}>P. UNITARIO</Text>
            <Text style={styles.colTotal}>SUBTOTAL</Text>
          </View>

          {ticket.items.map((item, idx) => {
            const pu = item.precioUnitario || item.precio || 0;
            return (
              <View style={styles.tableRow} key={idx}>
                <Text style={[styles.colQty, styles.rowTextBold]}>
                  {!item.presentacionNombre && esFraccionable(item.unidadMedida)
                    ? formatearCantidad(item.cantidad, item.unidadMedida)
                    : item.cantidad}
                </Text>
                <View style={styles.colDesc}>
                  <Text style={styles.rowTextBold}>{item.nombre}</Text>
                  <Text style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                    {[item.variante, item.presentacionNombre]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Text style={[styles.colPrice, styles.rowText]}>
                  ${pu.toLocaleString("es-AR")}
                </Text>
                <Text style={[styles.colTotal, styles.rowTextBold]}>
                  ${(pu * item.cantidad).toLocaleString("es-AR")}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Totales */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>
              ${subtotal.toLocaleString("es-AR")}
            </Text>
          </View>

          {(ticket.descuentoMonto ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Desc. ({ticket.promocionNombre}):
              </Text>
              <Text style={styles.totalValue}>
                -${ticket.descuentoMonto?.toLocaleString("es-AR")}
              </Text>
            </View>
          )}

          {ticket.listaPrecioNombre && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Lista:</Text>
              <Text style={styles.totalValue}>
                {ticket.listaPrecioNombre}
              </Text>
            </View>
          )}

          {fiscal && discriminaIvaEnPapel(fiscal.tipo) && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Neto gravado:</Text>
                <Text style={styles.totalValue}>
                  ${fiscal.neto.toLocaleString("es-AR")}
                </Text>
              </View>
              {fiscal.iva.map((a) => (
                <View style={styles.totalRow} key={a.alicuota}>
                  <Text style={styles.totalLabel}>IVA {a.alicuota}%:</Text>
                  <Text style={styles.totalValue}>
                    ${a.importe.toLocaleString("es-AR")}
                  </Text>
                </View>
              ))}
              {fiscal.exento > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Exento:</Text>
                  <Text style={styles.totalValue}>
                    ${fiscal.exento.toLocaleString("es-AR")}
                  </Text>
                </View>
              )}
              {fiscal.noGravado > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>No gravado:</Text>
                  <Text style={styles.totalValue}>
                    ${fiscal.noGravado.toLocaleString("es-AR")}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.totalRowFinal}>
            <Text style={styles.totalLabelBig}>TOTAL:</Text>
            <Text style={styles.totalValueBig}>
              ${ticket.total.toLocaleString("es-AR")}
            </Text>
          </View>

          {/* CON QUÉ SE PAGÓ. Faltaba entero: el PDF mostraba el total y nada
              más, así que una venta mixta era indistinguible de una en
              efectivo. El ticket impreso y el texto de WhatsApp ya los
              listaban; este era el que quedaba. */}
          {!isFiado && pagosDesglosados.length > 0 && (
            <View style={{ marginTop: 10 }}>
              {pagosDesglosados.map((pago, idx) => (
                <View style={styles.totalRow} key={`${pago.nombre}-${idx}`}>
                  <Text style={styles.totalLabel}>{pago.nombre}:</Text>
                  <Text style={styles.totalValue}>
                    ${Math.round(pago.monto).toLocaleString("es-AR")}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {isFiado && (
            <>
              {/* En el fiado, CON QUÉ se pagó el anticipo. Sin esto el
                  comprobante dice cuánto entregó y no de qué forma, que es
                  justo lo que se discute cuando el cliente vuelve. */}
              {pagosDesglosados.length > 0 && (
                <View style={{ marginTop: 10 }}>
                  {pagosDesglosados.map((pago, idx) => (
                    <View style={styles.totalRow} key={`${pago.nombre}-${idx}`}>
                      <Text style={styles.totalLabel}>{pago.nombre}:</Text>
                      <Text style={styles.totalValue}>
                        ${Math.round(pago.monto).toLocaleString("es-AR")}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={[styles.totalRow, { marginTop: 10 }]}>
                <Text style={styles.totalLabel}>Anticipo Pagado:</Text>
                <Text style={styles.totalValue}>
                  ${Math.round(montoCobrado).toLocaleString("es-AR")}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text
                  style={[
                    styles.totalLabel,
                    { color: "#b45309", fontWeight: "bold" },
                  ]}
                >
                  Saldo Pendiente:
                </Text>
                <Text
                  style={[
                    styles.totalValue,
                    { color: "#b45309", fontWeight: "bold" },
                  ]}
                >
                  ${Math.round(montoPendiente).toLocaleString("es-AR")}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Footer: CAE + QR en la factura, leyenda de interno en el ticket */}
        <View style={styles.footer}>
          {fiscal ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              {qrDataUrl && (
                // eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no acepta alt
                <Image src={qrDataUrl} style={{ width: 70, height: 70 }} />
              )}
              <View style={{ alignItems: "flex-start" }}>
                <Text style={[styles.footerText, { color: "#0f172a", fontWeight: "bold" }]}>
                  CAE: {fiscal.cae}
                </Text>
                <Text style={styles.footerText}>
                  Vto. CAE: {fechaCorta(fiscal.caeVencimiento)}
                </Text>
                <Text style={styles.footerText}>
                  Comprobante autorizado por ARCA
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.footerText}>
                COMPROBANTE INTERNO - NO VÁLIDO COMO FACTURA FISCAL
              </Text>
              <Text style={[styles.footerText, { marginTop: 4 }]}>
                Generado por Comerz
              </Text>
            </>
          )}
        </View>
      </Page>
    </Document>
  );
};

/**
 * Genera el PDF en memoria y lo ENTREGA: hoja nativa en el celular (para
 * mandarlo por WhatsApp como archivo), descarga en la PC. El porqué de esa
 * distinción está en `entregar-archivo.ts`.
 */
export async function downloadSaleReceiptPdf(
  ticket: TicketData,
  config: ConfiguracionPOS | null,
  qrDataUrl?: string | null,
) {
  try {
    const blob = await pdf(
      <ReceiptDocument ticket={ticket} config={config} qrDataUrl={qrDataUrl} />,
    ).toBlob();

    const nombre = ticket.fiscal
      ? `${tituloComprobante(ticket.fiscal.tipo).replaceAll(" ", "_")}_${numeroComprobanteFiscal(ticket.fiscal)}.pdf`
      : `Comprobante_${ticket.nroRecibo}.pdf`;
    const file = new File([blob], nombre, { type: "application/pdf" });

    return await entregarArchivo(file, nombre.replace(/\.pdf$/, ""));
  } catch (error) {
    console.error("Error generando PDF con react-pdf:", error);
    return false;
  }
}
