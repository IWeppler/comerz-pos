/**
 * Saldo posterior de cada movimiento, por cuenta.
 *
 * Espejo en TypeScript de la ventana de `movimientos_financieros_negocio`
 * (`20260921230000`):
 *
 *   sum(importe) over (partition by cuenta order by fecha, id)
 *
 * Los dos tienen que decir lo mismo — mismo criterio que
 * `imputar-pagos-fifo.ts` contra `recalcular_vencimiento_cc`. Sirve para
 * testear la regla sin base y para recalcular en el cliente cuando una
 * pantalla ya tiene TODOS los movimientos de una cuenta (el detalle chico) y
 * no quiere otro viaje.
 *
 * Las dos reglas que importan y que el test fija:
 *  - El orden es por fecha ECONÓMICA y después por id, nunca por
 *    `registrado_en`: una corrección de julio registrada en septiembre va en
 *    julio y el saldo de agosto la incluye.
 *  - Se parte por cuenta: el saldo de Mercado Pago no sabe nada del cajón.
 *
 * OJO: solo da el saldo correcto si recibe la historia COMPLETA de la cuenta.
 * Sobre una lista filtrada devuelve "el saldo de lo que se ve", que no es
 * ningún saldo — exactamente lo que la RPC evita calculando antes de filtrar.
 */

export interface MovimientoParaSaldo {
  id: number;
  fecha: string;
  cuenta_id: string;
  importe: number | string;
}

export function conSaldoPosterior<T extends MovimientoParaSaldo>(
  movimientos: readonly T[],
): (T & { saldo_posterior: number })[] {
  const ordenados = [...movimientos].sort((a, b) => {
    const porFecha = a.fecha.localeCompare(b.fecha);
    return porFecha !== 0 ? porFecha : a.id - b.id;
  });

  const acumulado = new Map<string, number>();
  return ordenados.map((m) => {
    const previo = acumulado.get(m.cuenta_id) ?? 0;
    const saldo = previo + Number(m.importe || 0);
    acumulado.set(m.cuenta_id, saldo);
    return { ...m, saldo_posterior: saldo };
  });
}
