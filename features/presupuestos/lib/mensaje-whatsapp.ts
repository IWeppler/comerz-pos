import { opcionesDeFinanciacion } from "./cuotas";
import { formatearNumeroPresupuesto } from "./estado";

/**
 * El texto de la cotización para WhatsApp. Sale de lo CONGELADO en la
 * cotización (renglones, total, tasas, vigencia), nunca de la configuración
 * actual: es el mismo papel que se imprime.
 */

export type PresupuestoParaMensaje = {
  numero: number;
  cliente_nombre: string | null;
  total: number;
  vigencia_hasta: string;
  modalidad_entrega: string;
  tasas_financiacion: unknown;
  frecuencia: string;
  nota: string | null;
  items: {
    descripcion: string;
    variante: string | null;
    unidad_medida: string;
    cantidad: number;
    precio_unitario: number;
  }[];
};

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const ETIQUETA_FRECUENCIA: Record<string, string> = {
  SEMANAL: "semanales",
  QUINCENAL: "quincenales",
  MENSUAL: "mensuales",
};

/** "2026-10-06" → "06/10/2026", sin pasar por Date (que lo leería en UTC y
 * podría mostrar el día anterior). */
export function fechaCorta(dia: string): string {
  const [a, m, d] = dia.split("-");
  return a && m && d ? `${d}/${m}/${a}` : dia;
}

export function etiquetaFrecuencia(frecuencia: string): string {
  return ETIQUETA_FRECUENCIA[frecuencia] ?? frecuencia.toLowerCase();
}

function cantidadTexto(cantidad: number, unidad: string): string {
  const n = cantidad.toLocaleString("es-AR", { maximumFractionDigits: 3 });
  return unidad === "UNIDAD" ? `${n} ×` : `${n} ${unidad.toLowerCase()} ×`;
}

export function mensajeWhatsappPresupuesto(
  p: PresupuestoParaMensaje,
  nombreComercio: string,
): string {
  const lineas: string[] = [];
  lineas.push(`*${nombreComercio}* — Cotización ${formatearNumeroPresupuesto(p.numero)}`);
  if (p.cliente_nombre) lineas.push(`Para: ${p.cliente_nombre}`);
  lineas.push("");
  for (const i of p.items) {
    const nombre = i.variante && i.variante !== i.descripcion ? `${i.descripcion} (${i.variante})` : i.descripcion;
    const subtotal = Math.round(i.precio_unitario * i.cantidad * 100) / 100;
    lineas.push(`• ${cantidadTexto(i.cantidad, i.unidad_medida)} ${nombre}: ${pesos(subtotal)}`);
  }
  lineas.push("");
  lineas.push(`*Total: ${pesos(p.total)}*`);

  const opciones = opcionesDeFinanciacion(p.total, p.tasas_financiacion);
  if (opciones.length > 0) {
    lineas.push("");
    lineas.push("Opciones en cuotas:");
    const frecuencia = etiquetaFrecuencia(p.frecuencia);
    for (const o of opciones) {
      const detalle =
        o.ultimaCuota !== o.montoCuota ? ` (la última ${pesos(o.ultimaCuota)})` : "";
      lineas.push(
        `• ${o.cuotas} cuotas ${frecuencia} de ${pesos(o.montoCuota)}${detalle} — total ${pesos(o.totalFinal)}`,
      );
    }
  }

  if (p.nota) {
    lineas.push("");
    lineas.push(p.nota);
  }
  lineas.push("");
  lineas.push(`Precios válidos hasta el ${fechaCorta(p.vigencia_hasta)}.`);
  return lineas.join("\n");
}
