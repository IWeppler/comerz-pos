/**
 * fecha_venta + plazoDias, en UTC de punta a punta (misma razón que
 * calcularDiasVencido: fecha_vencimiento_deuda es una columna `date` sin
 * hora, mezclarla con aritmética en hora local corre el día según el huso
 * horario del servidor). Devuelve "YYYY-MM-DD" listo para esa columna.
 */
export function calcularFechaVencimiento(
  fechaVenta: string | Date,
  plazoDias: number,
): string {
  const fecha =
    typeof fechaVenta === "string" ? new Date(fechaVenta) : fechaVenta;
  const vencimiento = new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate() + plazoDias,
    ),
  );

  const anio = vencimiento.getUTCFullYear();
  const mes = String(vencimiento.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(vencimiento.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

export type CcVencimientoModo = "DIAS" | "CIERRE_MENSUAL";

/** La configuración de vencimiento del comercio (`configuracion_pos`). */
export interface ReglaVencimientoCc {
  modo: CcVencimientoModo | null | undefined;
  /** `cc_plazo_mora`; null = 30, igual que la base. */
  plazoDias: number | null | undefined;
  /** `cc_dia_cierre`, 1..28. */
  diaCierre: number | null | undefined;
  /** `cc_dia_vencimiento`, 1..28; null = vence el día del cierre. */
  diaVencimiento: number | null | undefined;
}

function isoDeUtc(anio: number, mes0: number, dia: number): string {
  return new Date(Date.UTC(anio, mes0, dia)).toISOString().slice(0, 10);
}

/**
 * ESPEJO de `public.cc_vence_el` (20261005140000): cuándo vence una deuda
 * nacida el día `fecha` ("YYYY-MM-DD", día comercial). La regla que manda es
 * la de la base; los casos del test son los mismos que el guard de la
 * migración, así los dos dicen lo mismo.
 *
 * DIAS: fecha + plazo. CIERRE_MENSUAL: lo comprado ANTES del día de cierre
 * cierra ese día del mes; lo comprado ese día o después, el del mes que viene.
 * Vence el primer día de vencimiento a partir del cierre (o el mismo cierre).
 * Librería Colores, cierre 5 y vencimiento 15: del 5/9 al 4/10 vence el 15/10.
 */
export function calcularVencimientoCc(
  fecha: string,
  regla: ReglaVencimientoCc,
): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);

  if (regla.modo !== "CIERRE_MENSUAL" || !regla.diaCierre) {
    return isoDeUtc(anio, mes - 1, dia + (regla.plazoDias ?? 30));
  }

  const dc = regla.diaCierre;
  // Mes (0-based, puede pasar de 11: Date.UTC lo normaliza) del cierre.
  const mesCierre = dia < dc ? mes - 1 : mes;
  const dv = regla.diaVencimiento;
  if (!dv) return isoDeUtc(anio, mesCierre, dc);
  return isoDeUtc(anio, dv >= dc ? mesCierre : mesCierre + 1, dv);
}

/**
 * La inversa, para importar: la planilla trae la fecha de VENCIMIENTO y el
 * libro guarda la fecha en que la deuda nació. Con DIAS es vencimiento −
 * plazo; con CIERRE_MENSUAL, el día anterior al cierre que vence en esa
 * fecha (el último día del período). Si la fecha de la planilla no cae en un
 * día de vencimiento, la deuda vence en el del período que le corresponde.
 */
export function fechaOrigenParaVencimiento(
  vencimiento: string,
  regla: ReglaVencimientoCc,
): string {
  const [anio, mes, dia] = vencimiento.slice(0, 10).split("-").map(Number);

  if (regla.modo !== "CIERRE_MENSUAL" || !regla.diaCierre) {
    return isoDeUtc(anio, mes - 1, dia - (regla.plazoDias ?? 30));
  }

  const dc = regla.diaCierre;
  const dv = regla.diaVencimiento;
  // El cierre que vence en (o antes de) esa fecha.
  const mesCierre = !dv || dv >= dc ? mes - 1 : mes - 2;
  return isoDeUtc(anio, mesCierre, dc - 1);
}
