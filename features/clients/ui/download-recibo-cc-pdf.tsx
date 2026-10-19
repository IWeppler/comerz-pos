"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { formatTicketMoney } from "@/features/sales/ui/ticket-utils";
import { entregarArchivo } from "@/features/sales/lib/entregar-archivo";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  lineasCuentaRecibo,
  numeroReciboCC,
  type ReciboCobroCC,
} from "../lib/recibo-cc";
import { agruparDeudaPorMes, etiquetaDeuda } from "../lib/deuda-por-mes";

/**
 * El recibo del cobro de cuenta corriente en PDF, para mandarlo por WhatsApp
 * o guardarlo. Dice lo mismo que el papel impreso (`recibo-cc-printable.tsx`),
 * con los mismos helpers, pero es UNA copia: la del cliente, sin firma. La
 * del comercio con la firma existe para el mostrador; un PDF no se firma.
 *
 * Se carga con `import()` desde el botón, igual que el PDF del ticket de
 * venta: `@react-pdf/renderer` es la dependencia más pesada de la app.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", backgroundColor: "#ffffff", fontSize: 10, color: "#334155" },
  header: { borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingBottom: 14, marginBottom: 16 },
  comercio: { fontSize: 18, fontWeight: "bold", color: "#0f172a" },
  sub: { fontSize: 9, color: "#64748b", marginTop: 2 },
  titulo: { fontSize: 14, fontWeight: "bold", color: "#0f172a", marginBottom: 4 },
  seccion: { marginBottom: 16 },
  rotulo: { fontSize: 8, color: "#64748b", textTransform: "uppercase", marginBottom: 6, letterSpacing: 1 },
  fila: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  filaChica: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, fontSize: 9, color: "#64748b" },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    fontSize: 12,
    fontWeight: "bold",
    color: "#0f172a",
  },
  nota: { fontSize: 9, color: "#64748b" },
  pie: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 10,
    fontSize: 9,
    color: "#94a3b8",
  },
});

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso;
}

function ReciboDocument({ recibo }: Readonly<{ recibo: ReciboCobroCC }>) {
  const grupos = agruparDeudaPorMes(recibo.pendientes, diaComercial(recibo.fecha));
  return (
    <Document title={`Recibo ${numeroReciboCC(recibo)}`}>
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.comercio}>{recibo.comercio.nombre || "Mi Comercio"}</Text>
          {recibo.comercio.direccion ? <Text style={styles.sub}>{recibo.comercio.direccion}</Text> : null}
          {recibo.comercio.whatsapp ? <Text style={styles.sub}>WhatsApp: {recibo.comercio.whatsapp}</Text> : null}
        </View>

        <View style={styles.seccion}>
          <Text style={styles.titulo}>Recibo de pago Nº {numeroReciboCC(recibo)}</Text>
          <Text>{fechaHora(recibo.fecha)}</Text>
          <Text>Cliente: {recibo.clienteNombre}</Text>
        </View>

        <View style={styles.seccion}>
          <Text style={styles.rotulo}>Pago</Text>
          <View style={styles.fila}>
            <Text>Pago a cuenta</Text>
            <Text>{formatTicketMoney(recibo.montoBase)}</Text>
          </View>
          {recibo.recargoMetodoMonto > 0 ? (
            <View style={styles.filaChica}>
              <Text>
                Recargo {recibo.metodoNombre} ({recibo.recargoMetodoPorcentaje}%)
              </Text>
              <Text>+{formatTicketMoney(recibo.recargoMetodoMonto)}</Text>
            </View>
          ) : null}
          <View style={styles.total}>
            <Text>TOTAL PAGADO</Text>
            <Text>{formatTicketMoney(recibo.montoBruto)}</Text>
          </View>
          <Text style={styles.nota}>{recibo.metodoNombre}</Text>
        </View>

        <View style={styles.seccion}>
          <Text style={styles.rotulo}>Cuenta corriente</Text>
          {lineasCuentaRecibo(recibo).map((linea) => (
            <View key={linea.etiqueta} style={linea.signo ? styles.filaChica : styles.fila}>
              <Text>{linea.etiqueta}</Text>
              <Text>
                {linea.signo}
                {formatTicketMoney(linea.monto)}
              </Text>
            </View>
          ))}
          <View style={styles.total}>
            <Text>{recibo.saldoNuevo < 0 ? "A FAVOR" : "SALDO"}</Text>
            <Text>{formatTicketMoney(Math.abs(recibo.saldoNuevo))}</Text>
          </View>
        </View>

        {recibo.imputaciones.length > 0 ? (
          <View style={styles.seccion}>
            <Text style={styles.rotulo}>Este pago cancela</Text>
            {recibo.imputaciones.map((imp) => (
              <View key={imp.debitoId} style={{ paddingVertical: 2 }}>
                <View style={styles.fila}>
                  <Text>{etiquetaDeuda(imp)}</Text>
                  <Text>{formatTicketMoney(imp.aplicado)}</Text>
                </View>
                <Text style={styles.nota}>
                  {fechaCorta(imp.fecha)} ·{" "}
                  {imp.saldoRestante > 0 ? `queda ${formatTicketMoney(imp.saldoRestante)}` : "saldada"}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {grupos.length > 0 ? (
          <View style={styles.seccion}>
            <Text style={styles.rotulo}>Pendiente por vencimiento</Text>
            {grupos.map((grupo) => (
              <View key={grupo.clave} style={styles.fila}>
                <Text style={grupo.vencido ? { fontWeight: "bold" } : {}}>
                  {grupo.vencido
                    ? "VENCIDO"
                    : `${grupo.etiqueta} (vence ${fechaCorta(grupo.deudas[0].venceEl).slice(0, 5)})`}
                </Text>
                <Text style={grupo.vencido ? { fontWeight: "bold" } : {}}>
                  {formatTicketMoney(grupo.monto)}
                </Text>
              </View>
            ))}
          </View>
        ) : recibo.saldoNuevo > 0 && recibo.fechaVencimiento ? (
          <View style={styles.filaChica}>
            <Text>Vence</Text>
            <Text>{fechaCorta(recibo.fechaVencimiento)}</Text>
          </View>
        ) : null}

        <Text style={styles.pie}>
          {recibo.saldoNuevo > 0 ? "Gracias por su pago!" : "Cuenta al día. Gracias!"}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Genera el PDF en memoria y lo ENTREGA: hoja nativa en el celular (para
 * mandarlo por WhatsApp como archivo), descarga en la PC. Mismo camino que
 * el comprobante de venta (`entregar-archivo.ts`).
 */
export async function downloadReciboCcPdf(recibo: ReciboCobroCC): Promise<boolean> {
  try {
    const blob = await pdf(<ReciboDocument recibo={recibo} />).toBlob();
    const nombre = `Recibo_${numeroReciboCC(recibo)}.pdf`;
    const file = new File([blob], nombre, { type: "application/pdf" });
    return await entregarArchivo(file, nombre.replace(/\.pdf$/, ""));
  } catch (error) {
    console.error("[RECIBO CC] Error generando el PDF:", error);
    return false;
  }
}
