/**
 * Cómo se lee `clientes.saldo_pendiente` desde que tiene SIGNO (20260928230000):
 * positivo = el cliente debe, negativo = saldo a favor del cliente.
 *
 * Existe para que ninguna pantalla sume el saldo crudo cuando lo que quiere
 * es DEUDA: un saldo a favor sumado ahí se resta de la deuda de los demás, y
 * "dinero en la calle" baja por una seña que el comercio tiene en el cajón.
 * La base sigue el mismo criterio: toda lectura de deuda filtra `> 0`.
 */

/** Lo que el cliente debe. Cero si está al día o tiene saldo a favor. */
export function deudaDe(saldoPendiente: number | string | null | undefined): number {
  return Math.max(0, Number(saldoPendiente) || 0);
}

/** Lo que el comercio le debe al cliente. Cero si no tiene saldo a favor. */
export function saldoAFavorDe(
  saldoPendiente: number | string | null | undefined,
): number {
  return Math.max(0, -(Number(saldoPendiente) || 0));
}
