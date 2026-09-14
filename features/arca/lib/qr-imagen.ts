import QRCode from "qrcode";

/**
 * El QR de la factura como data URL (PNG), para el ticket térmico, el PDF y
 * cualquier `<img>`. Corre en el navegador: es la única pieza de ARCA que
 * vive del lado del cliente, y no toca nada secreto — la URL que codifica
 * es pública por definición (está impresa en el papel).
 */
export async function generarQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 200,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
