import { formatearNumeroComprobante } from "@/shared/lib/facturacion";

/**
 * Arma las filas de cada exportación a partir de los datos crudos.
 *
 * Puro y sin IO: la action consulta, esto ordena. Así el formato de cada
 * planilla —que es lo que el contador ve y lo único que le importa— se prueba
 * sin base y sin Excel de por medio.
 *
 * Criterios que valen para TODAS las planillas:
 *
 *  - Los importes van como NÚMERO, no como texto con "$". Un contador filtra,
 *    suma y pivotea: un importe como texto convierte la planilla en un dibujo.
 *  - Las fechas van como texto ISO (YYYY-MM-DD HH:mm). Excel interpreta los
 *    formatos ambiguos según la configuración regional de QUIEN abre el
 *    archivo, y 03/04 puede ser marzo o abril según la máquina del contador.
 *  - Las columnas se declaran explícitas y en orden. Volcar el objeto crudo
 *    haría que agregar una columna en la base cambie la planilla sin que nadie
 *    lo decida.
 *  - Una venta ANULADA aparece, marcada como anulada. Sacarla haría que la
 *    numeración tenga huecos sin explicación.
 *  - Una venta con DEVOLUCIÓN PARCIAL aparece con su importe bruto y las
 *    columnas de lo devuelto al lado. No se netea la columna que ya existía,
 *    por la misma razón: el comprobante que el cliente se llevó dice el bruto,
 *    y una planilla cuyo "Total cobrado" no coincide con el papel es una
 *    planilla que no se puede conciliar. El neto va calculado en su propia
 *    columna, que es lo que el contador suma.
 */

export type Fila = Record<string, string | number | null>;

/** Fecha y hora local en formato no ambiguo. */
export function formatearFechaHoraExport(valor: unknown): string {
  if (!valor) return "";
  const fecha = new Date(String(valor));
  if (Number.isNaN(fecha.getTime())) return "";

  const p = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())} ${p(fecha.getHours())}:${p(fecha.getMinutes())}`;
}

export function formatearFechaExport(valor: unknown): string {
  return formatearFechaHoraExport(valor).slice(0, 10);
}

/** Number() tolerante: null, "" y basura dan 0, no NaN. Un NaN en una celda
 * rompe cualquier suma de la planilla entera. */
export function num(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------- Ventas

export interface VentaExport {
  id: string;
  fecha_venta: string;
  estado_operacion?: string | null;
  estado_pago?: string | null;
  metodo_pago?: string | null;
  /** Con qué lista de precios se cobró. Vacío = precio base. El nombre está
   * congelado en la venta: el contador tiene que ver el que rigió ese día,
   * no el que la lista tenga hoy. */
  lista_precio_nombre?: string | null;
  total?: number | null;
  recargo_metodo_total?: number | null;
  precio_costo?: number | null;
  comision_total?: number | null;
  total_neto?: number | null;
  monto_cobrado?: number | null;
  monto_pendiente?: number | null;
  /** Lo devuelto de esta venta, con el recargo prorrateado. */
  monto_devuelto?: number | null;
  /** De lo devuelto, cuánto es mercadería. */
  base_devuelta?: number | null;
  /** Solo para el costo de lo devuelto: `ventas.precio_costo` es el costo de
   * TODO lo vendido y no dice cuánto de eso volvió. */
  ventas_items?:
    | { precio_costo?: number | null; cantidad_devuelta?: number | null }[]
    | null;
  cantidad?: number | null;
  clientes?: { nombre?: string | null } | null;
  perfiles?: { nombre?: string | null } | null;
  comprobantes?: { tipo: string; punto_venta: number; numero: number }[] | null;
}

export function filasVentas(ventas: readonly VentaExport[]): Fila[] {
  return ventas.map((v) => {
    const comprobante = v.comprobantes?.[0];
    const total = num(v.total);
    const recargo = num(v.recargo_metodo_total);

    // Devoluciones parciales. Se AGREGAN columnas y no se modifican las que ya
    // estaban, por el mismo criterio con el que una venta anulada aparece
    // marcada en vez de desaparecer: el comprobante que el cliente se llevó
    // dice el importe bruto, y una planilla donde "Total cobrado" no coincide
    // con el papel es una planilla que el contador no puede conciliar. Lo neto
    // va al lado, calculado.
    const devuelto = num(v.monto_devuelto);
    const mercaderiaDevuelta = num(v.base_devuelta);
    const costoDevuelto = (v.ventas_items ?? []).reduce(
      (acc, item) => acc + num(item.precio_costo) * num(item.cantidad_devuelta),
      0,
    );

    return {
      Fecha: formatearFechaHoraExport(v.fecha_venta),
      Comprobante: comprobante
        ? (formatearNumeroComprobante(
            comprobante.punto_venta,
            comprobante.numero,
          ) ?? "")
        : "",
      "Tipo comprobante": comprobante?.tipo ?? "",
      Estado: v.estado_operacion ?? "",
      Cliente: v.clientes?.nombre ?? "Consumidor final",
      Vendedor: v.perfiles?.nombre ?? "",
      "Medio de pago": v.metodo_pago ?? "",
      // Vacío —y no "Minorista"— cuando se vendió al precio base: no hay
      // ninguna lista llamada así, y ponerle nombre a la ausencia haría
      // que las 1.072 ventas anteriores a esta feature parecieran
      // clasificadas cuando nadie las clasificó.
      "Lista de precios": v.lista_precio_nombre ?? "",
      Unidades: num(v.cantidad),
      // El recargo por método no es venta de mercadería: se muestra aparte y
      // se resta, mismo criterio que los reportes.
      "Total cobrado": total,
      "Recargo por medio de pago": recargo,
      "Venta de mercadería": total - recargo,
      Devuelto: devuelto,
      "Mercadería devuelta": mercaderiaDevuelta,
      // Lo devuelto ENTERO baja de la venta neta, no solo la mercadería: en un
      // fiado, `monto_devuelto` incluye el recargo de cuenta corriente
      // perdonado, que también estaba adentro del total. El recargo por método
      // no entra nunca — el banco no lo reintegra.
      // La diferencia entre "Devuelto" y "Mercadería devuelta" es, entonces,
      // exactamente el recargo de cuenta corriente que se le perdonó.
      "Venta neta de devoluciones": total - recargo - devuelto,
      "Costo de la mercadería": num(v.precio_costo),
      "Costo de lo devuelto": costoDevuelto,
      "Costo neto de devoluciones": num(v.precio_costo) - costoDevuelto,
      "Comisión del procesador": num(v.comision_total),
      "Neto acreditado": num(v.total_neto),
      Cobrado: num(v.monto_cobrado),
      Pendiente: num(v.monto_pendiente),
      "Estado de pago": v.estado_pago ?? "",
      "ID interno": v.id,
    };
  });
}

// --------------------------------------------------------------- Comprobantes

export interface ComprobanteExport {
  tipo: string;
  punto_venta: number;
  numero: number;
  emitido_en: string;
  total?: number | null;
  neto?: number | null;
  iva_monto?: number | null;
  cae?: string | null;
  cae_vencimiento?: string | null;
  receptor_razon_social?: string | null;
  receptor_cuit?: string | null;
  receptor_condicion_iva?: string | null;
  arca_ambiente?: string | null;
  venta_id: string;
}

export function filasComprobantes(
  comprobantes: readonly ComprobanteExport[],
): Fila[] {
  return comprobantes.map((c) => ({
    Fecha: formatearFechaHoraExport(c.emitido_en),
    Tipo: c.tipo,
    Número: formatearNumeroComprobante(c.punto_venta, c.numero) ?? "",
    "Punto de venta": c.punto_venta,
    Receptor: c.receptor_razon_social ?? "Consumidor final",
    CUIT: c.receptor_cuit ?? "",
    "Condición IVA": c.receptor_condicion_iva ?? "",
    "Neto gravado": num(c.neto),
    IVA: num(c.iva_monto),
    Total: num(c.total),
    CAE: c.cae ?? "",
    "Vencimiento CAE": c.cae_vencimiento
      ? formatearFechaExport(c.cae_vencimiento)
      : "",
    // Que un CAE de homologación se vea como lo que es: una prueba.
    Ambiente:
      c.arca_ambiente === "PRODUCCION"
        ? "Producción"
        : c.arca_ambiente === "HOMOLOGACION"
          ? "Homologación (prueba)"
          : "",
    "ID venta": c.venta_id,
  }));
}

// --------------------------------------------------------------------- Compras

export interface CompraExport {
  id: string;
  proveedor?: string | null;
  fecha_remito?: string | null;
  total_presupuestado?: number | null;
  estado?: string | null;
  creado_en: string;
}

export function filasCompras(compras: readonly CompraExport[]): Fila[] {
  return compras.map((c) => ({
    "Fecha del remito": c.fecha_remito ? formatearFechaExport(c.fecha_remito) : "",
    Proveedor: c.proveedor ?? "",
    Estado: c.estado ?? "",
    Total: num(c.total_presupuestado),
    "Cargado el": formatearFechaHoraExport(c.creado_en),
    "ID interno": c.id,
  }));
}

// ------------------------------------------------------------ Movimientos caja

export interface TurnoExport {
  id: string;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  estado?: string | null;
  modo?: string | null;
  monto_inicial?: number | null;
  efectivo_esperado?: number | null;
  monto_declarado?: number | null;
  diferencia?: number | null;
  observacion_cierre?: string | null;
  perfiles?: { nombre?: string | null } | null;
}

export function filasMovimientosCaja(turnos: readonly TurnoExport[]): Fila[] {
  return turnos.map((t) => ({
    Apertura: formatearFechaHoraExport(t.fecha_apertura),
    Cierre: t.fecha_cierre ? formatearFechaHoraExport(t.fecha_cierre) : "",
    Estado: t.estado ?? "",
    Modo: t.modo ?? "",
    Responsable: t.perfiles?.nombre ?? "",
    "Monto inicial": num(t.monto_inicial),
    // En un turno ABIERTO este valor quedó congelado en el monto inicial: no
    // es el efectivo real de ahora. Se exporta igual y el estado lo aclara.
    "Efectivo esperado": num(t.efectivo_esperado),
    "Efectivo declarado": num(t.monto_declarado),
    Diferencia: num(t.diferencia),
    Observaciones: t.observacion_cierre ?? "",
    "ID interno": t.id,
  }));
}

// ------------------------------------------------------- Movimientos generales

export interface PagoExport {
  creado_en: string;
  metodo_nombre?: string | null;
  metodo_tipo?: string | null;
  monto_base?: number | null;
  recargo_monto?: number | null;
  monto_bruto?: number | null;
  comision_monto?: number | null;
  monto_neto?: number | null;
  tipo_movimiento?: string | null;
  estado_pago_operacion?: string | null;
  venta_id?: string | null;
}

export interface EgresoExport {
  fecha: string;
  concepto?: string | null;
  monto?: number | null;
  tipo?: string | null;
}

/**
 * Cobros y egresos en UNA sola planilla, ordenada por fecha.
 *
 * Van juntos y con signo porque es la pregunta que el contador hace: qué entró
 * y qué salió, en orden. Dos hojas separadas obligan a cruzarlas a mano.
 * El egreso va NEGATIVO por el mismo motivo: para que la columna sume el neto
 * del período sin tener que restar nada.
 */
export function filasMovimientosGenerales(
  pagos: readonly PagoExport[],
  egresos: readonly EgresoExport[],
): Fila[] {
  const filasPagos: Fila[] = pagos.map((p) => ({
    Fecha: formatearFechaHoraExport(p.creado_en),
    Movimiento: "INGRESO",
    Concepto:
      p.tipo_movimiento === "PAGO_CUENTA_CORRIENTE"
        ? "Cobro de cuenta corriente"
        : "Cobro de venta",
    "Medio de pago": p.metodo_nombre ?? "",
    Importe: num(p.monto_bruto),
    "Base imputada": num(p.monto_base),
    Recargo: num(p.recargo_monto),
    Comisión: num(p.comision_monto),
    "Neto acreditado": num(p.monto_neto),
    Estado: p.estado_pago_operacion ?? "",
    "ID venta": p.venta_id ?? "",
  }));

  const filasEgresos: Fila[] = egresos.map((e) => ({
    Fecha: formatearFechaHoraExport(e.fecha),
    Movimiento: "EGRESO",
    Concepto: e.concepto ?? "",
    "Medio de pago": "",
    Importe: -Math.abs(num(e.monto)),
    "Base imputada": null,
    Recargo: null,
    Comisión: null,
    "Neto acreditado": null,
    Estado: e.tipo ?? "",
    "ID venta": "",
  }));

  return [...filasPagos, ...filasEgresos].sort((a, b) =>
    String(a.Fecha).localeCompare(String(b.Fecha)),
  );
}

// ------------------------------------------------------------ Libro IVA Ventas

export interface ComprobanteFiscalExport {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  /** yyyy-mm-dd: CbteFch. El libro va por fecha fiscal, no por `emitido_en`. */
  fecha_comprobante: string | null;
  total?: number | null;
  neto?: number | null;
  iva_monto?: number | null;
  exento?: number | null;
  no_gravado?: number | null;
  cae?: string | null;
  receptor_razon_social?: string | null;
  receptor_doc_tipo?: number | null;
  receptor_doc_nro?: string | null;
  receptor_condicion_iva?: string | null;
  arca_ambiente?: string | null;
  anula_comprobante_id?: string | null;
  comprobantes_iva?: { alicuota_id: number; base_imponible: number; importe: number }[];
}

const CODIGO_ARCA_EXPORT: Record<string, string> = {
  FACTURA_A: "001",
  FACTURA_B: "006",
  FACTURA_C: "011",
  NOTA_CREDITO_A: "003",
  NOTA_CREDITO_B: "008",
  NOTA_CREDITO_C: "013",
};

const TIPO_LEGIBLE: Record<string, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  NOTA_CREDITO_A: "Nota de crédito A",
  NOTA_CREDITO_B: "Nota de crédito B",
  NOTA_CREDITO_C: "Nota de crédito C",
};

const DOC_LEGIBLE: Record<number, string> = { 80: "CUIT", 96: "DNI", 99: "" };

/**
 * Una fila por comprobante fiscal, con el neto y el IVA ABIERTOS por alícuota
 * (21 / 10,5 / 27), que es como lo pide cualquier libro de IVA ventas y como
 * lo carga el contador. Las notas de crédito van en NEGATIVO: restan del
 * débito fiscal del período, y una planilla que las suma en positivo da un
 * IVA a pagar más alto que el real.
 *
 * Solo entra lo de PRODUCCIÓN: quien llama ya filtró `arca_ambiente`, y acá
 * se vuelve a filtrar por si acaso — un CAE de homologación en el libro es un
 * comprobante que no existe declarado como si existiera.
 */
export function filasLibroIvaVentas(
  comprobantes: readonly ComprobanteFiscalExport[],
): Fila[] {
  return comprobantes
    .filter((c) => c.arca_ambiente === "PRODUCCION" && c.cae)
    .map((c) => {
      const signo = c.tipo.startsWith("NOTA_CREDITO") ? -1 : 1;
      const porAlicuota = (id: number) => {
        const a = (c.comprobantes_iva ?? []).find((x) => x.alicuota_id === id);
        return {
          base: a ? signo * num(a.base_imponible) : 0,
          iva: a ? signo * num(a.importe) : 0,
        };
      };
      const a21 = porAlicuota(5);
      const a105 = porAlicuota(4);
      const a27 = porAlicuota(6);
      const docTipo = c.receptor_doc_tipo ?? 99;

      return {
        Fecha: c.fecha_comprobante ?? "",
        Tipo: TIPO_LEGIBLE[c.tipo] ?? c.tipo,
        "Código ARCA": CODIGO_ARCA_EXPORT[c.tipo] ?? "",
        "Punto de venta": c.punto_venta,
        Número: c.numero,
        Comprobante: formatearNumeroComprobante(c.punto_venta, c.numero) ?? "",
        Receptor: c.receptor_razon_social ?? "Consumidor final",
        "Tipo doc.": DOC_LEGIBLE[docTipo] ?? String(docTipo),
        "Nro. doc.": docTipo === 99 ? "" : (c.receptor_doc_nro ?? ""),
        "Condición IVA": c.receptor_condicion_iva ?? "Consumidor Final",
        "Neto gravado 21%": a21.base,
        "IVA 21%": a21.iva,
        "Neto gravado 10,5%": a105.base,
        "IVA 10,5%": a105.iva,
        "Neto gravado 27%": a27.base,
        "IVA 27%": a27.iva,
        // Total neto e IVA de la cabecera: en la C (sin discriminar) es lo
        // único que hay, y en la A/B tiene que coincidir con la suma de arriba.
        "Neto total": signo * num(c.neto),
        "IVA total": signo * num(c.iva_monto),
        Exento: signo * num(c.exento),
        "No gravado": signo * num(c.no_gravado),
        Total: signo * num(c.total),
        CAE: c.cae ?? "",
        "Anula a": c.anula_comprobante_id ?? "",
      };
    });
}
