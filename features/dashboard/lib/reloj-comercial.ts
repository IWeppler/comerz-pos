/**
 * El panel en hora de Argentina, sin reescribir sus helpers.
 *
 * Todo el panel (rangos, día típico, serie del gráfico, métricas, quiebres)
 * calcula con los getters LOCALES de Date (`getDate`, `getHours`). En Vercel
 * el server corre en UTC, así que el día cortaba a las 21:00 de Buenos Aires:
 * de 21 a 24 hs "Hoy" ya era mañana (KPIs en cero, fecha de mañana en el
 * título, "vs. jueves promedio" un miércoles). Es justo la franja en que el
 * dueño cierra y repasa el día (6/10/2026).
 *
 * En vez de reescribir una docena de módulos con día comercial, se corre al
 * RELOJ COMERCIAL todo lo que el panel lee —"ahora" y cada fecha de los
 * datos— por la diferencia entre el huso del server y el de Argentina. Así
 * los getters locales devuelven la hora de Buenos Aires y TODAS las cuentas
 * quedan en el mismo espacio. En un server en UTC el corrimiento es −3 h; en
 * una máquina de desarrollo en Argentina es 0.
 *
 * Reglas para usarlo:
 *   - Corrido es SOLO para calcular. Lo que se MUESTRA (la hora de una venta)
 *     sale de la fecha original, con su formateador.
 *   - Se corre todo lo que se compara entre sí: si se corre "ahora" y no los
 *     datos (o al revés), los rangos quedan 3 horas desfasados.
 *   - Argentina no tiene horario de verano desde 2009: el offset es fijo.
 */

const OFFSET_ARGENTINA_MIN = 180; // UTC−03:00, como lo devuelve getTimezoneOffset

/** Milisegundos a sumar a un instante para que sus getters locales den la
 * hora de Argentina en este server. */
export function desfaseRelojComercial(referencia: Date = new Date()): number {
  return (referencia.getTimezoneOffset() - OFFSET_ARGENTINA_MIN) * 60_000;
}

export function aRelojComercial(fecha: Date | string, desfase: number): Date {
  const instante = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Date(instante.getTime() + desfase);
}

/**
 * Copia de las filas con esos campos de fecha corridos al reloj comercial
 * (como ISO, que es como los leen los helpers: `new Date(v.fecha_venta)`).
 * Un campo vacío queda como está.
 */
export function conFechasComerciales<T>(
  filas: readonly T[],
  campos: readonly (keyof T)[],
  desfase: number,
): T[] {
  if (desfase === 0) return [...filas];
  return filas.map((fila) => {
    const copia = { ...fila };
    for (const campo of campos) {
      const valor = fila[campo];
      if (typeof valor === "string" && valor) {
        copia[campo] = aRelojComercial(valor, desfase).toISOString() as T[keyof T];
      }
    }
    return copia;
  });
}
