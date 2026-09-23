/**
 * Egresos programados: qué vence, cuándo y cómo se lee.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO NO ES PLATA QUE SALIÓ
 *
 * Un programado es una AGENDA. Al llegar la fecha no se registra nada: alguien
 * confirma, y esa confirmación crea el egreso de verdad. Por eso nada de acá
 * entra en el saldo de una cuenta ni en el arqueo — vive en "Próximos
 * movimientos", al lado de lo que está por acreditar.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const FRECUENCIAS = [
  "UNICO",
  "SEMANAL",
  "QUINCENAL",
  "MENSUAL",
  "BIMESTRAL",
  "TRIMESTRAL",
  "ANUAL",
] as const;

export type Frecuencia = (typeof FRECUENCIAS)[number];

const ETIQUETAS_FRECUENCIA: Record<Frecuencia, string> = {
  UNICO: "Una sola vez",
  SEMANAL: "Cada semana",
  QUINCENAL: "Cada 15 días",
  MENSUAL: "Todos los meses",
  BIMESTRAL: "Cada 2 meses",
  TRIMESTRAL: "Cada 3 meses",
  ANUAL: "Una vez al año",
};

export function etiquetaFrecuencia(frecuencia: string): string {
  return ETIQUETAS_FRECUENCIA[frecuencia as Frecuencia] ?? frecuencia;
}

/**
 * ESPEJO de `public.siguiente_fecha_programada`. Los dos tienen que decir lo
 * mismo, mismo criterio que `temporada-categoria.ts` contra
 * `categoria_en_temporada`.
 *
 * Existe para poder mostrar "el que viene sería el 28/02" al cargar la agenda,
 * sin ir a la base por cada tecla. Quien MANDA es la función de SQL: es la que
 * corre al confirmar.
 *
 * El ancla es lo que evita la trampa clásica: sumar un mes a un 31 de enero da
 * 28 de febrero, y sin ancla el vencimiento queda clavado el 28 para siempre.
 */
export function siguienteFechaProgramada(
  fechaISO: string,
  frecuencia: string,
  diaAncla?: number | null,
): string | null {
  if (!fechaISO) return null;
  if (frecuencia === "UNICO") return null;

  // Se trabaja en UTC a propósito: una fecha de vencimiento es un día del
  // calendario, no un instante. Con `new Date("2026-01-31")` interpretado en
  // horario local, un huso al oeste de Greenwich lo corre al 30.
  const [anio, mes, dia] = fechaISO.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return null;

  if (frecuencia === "SEMANAL" || frecuencia === "QUINCENAL") {
    const dias = frecuencia === "SEMANAL" ? 7 : 14;
    const d = new Date(Date.UTC(anio, mes - 1, dia + dias));
    return d.toISOString().slice(0, 10);
  }

  const meses: Record<string, number> = {
    MENSUAL: 1,
    BIMESTRAL: 2,
    TRIMESTRAL: 3,
    ANUAL: 12,
  };
  const saltar = meses[frecuencia];
  // Fail-closed: una frecuencia desconocida no se inventa.
  if (!saltar) return null;

  const mesDestino = mes - 1 + saltar;
  const anioDestino = anio + Math.floor(mesDestino / 12);
  const mesNormalizado = ((mesDestino % 12) + 12) % 12;
  // Día 0 del mes siguiente = último día del mes destino.
  const ultimoDia = new Date(
    Date.UTC(anioDestino, mesNormalizado + 1, 0),
  ).getUTCDate();

  const diaFinal = Math.min(diaAncla ?? dia, ultimoDia);
  return new Date(Date.UTC(anioDestino, mesNormalizado, diaFinal))
    .toISOString()
    .slice(0, 10);
}

export type EstadoVencimiento = "VENCIDO" | "HOY" | "PROXIMO";

/**
 * Cuán urgente es un vencimiento.
 *
 * VENCIDO no se esconde ni se corre solo: si el alquiler del 25 no se confirmó,
 * el 26 sigue ahí. Un sistema que hace desaparecer lo que no se hizo enseña a
 * no mirarlo.
 */
export function estadoVencimiento(
  proximaFechaISO: string,
  hoyISO: string,
): EstadoVencimiento {
  const vence = proximaFechaISO.slice(0, 10);
  const hoy = hoyISO.slice(0, 10);
  if (vence < hoy) return "VENCIDO";
  if (vence === hoy) return "HOY";
  return "PROXIMO";
}

export interface ProgramadoParaTotal {
  monto: number | string;
  proxima_fecha: string;
  activo?: boolean;
}

export interface TotalProgramado {
  /** Lo que vence dentro de la ventana, vencidos incluidos. */
  monto: number;
  cantidad: number;
  /** De esos, cuántos ya se pasaron de fecha. Es lo accionable HOY. */
  vencidos: number;
  montoVencido: number;
}

/**
 * Cuánto hay comprometido en los próximos N días.
 *
 * Los VENCIDOS entran en el total, y no es un detalle: son plata que se debe
 * y que todavía no salió. Dejarlos afuera haría que el número baje justo
 * cuando alguien se atrasa, que es exactamente al revés de lo que tiene que
 * pasar.
 *
 * Los dados de baja no cuentan. Un programado inactivo es uno que ya no se
 * paga, no uno que se pagó.
 */
export function totalProgramado(
  programados: readonly ProgramadoParaTotal[],
  hoyISO: string,
  dias = 30,
): TotalProgramado {
  const hoy = hoyISO.slice(0, 10);
  const [a, m, d] = hoy.split("-").map(Number);
  const limite = new Date(Date.UTC(a, m - 1, d + dias))
    .toISOString()
    .slice(0, 10);

  let monto = 0;
  let cantidad = 0;
  let vencidos = 0;
  let montoVencido = 0;

  for (const p of programados) {
    if (p.activo === false) continue;
    const vence = p.proxima_fecha.slice(0, 10);
    if (vence > limite) continue;

    const importe = Number(p.monto) || 0;
    monto += importe;
    cantidad += 1;
    if (vence < hoy) {
      vencidos += 1;
      montoVencido += importe;
    }
  }

  return { monto, cantidad, vencidos, montoVencido };
}
