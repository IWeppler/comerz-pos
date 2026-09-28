/**
 * El tope de un cobro de cuenta corriente: no puede entrar más plata de la que
 * se debe, mora de este cobro incluida.
 *
 * La autoridad es la base (`registrar_cobro_cc`, `20260928210000`), que lo
 * chequea con el saldo bloqueado. Esto es el espejo para el modal —avisar
 * antes de confirmar, con la clienta esperando— y para traducir el rechazo.
 *
 * Por qué existe: sin tope, un cobro de más entraba entero a la caja y al
 * libro, y el caché del saldo lo recortaba a cero sin avisar. Así quedaron
 * los dos cobros duplicados de Evens del 21/7/2026, que el tope habría
 * frenado: en los dos el primer cobro ya saldaba la deuda entera.
 *
 * Mismo redondeo que la base: al centavo, para que "pagar todo" con la mora
 * calculada no falle por un decimal.
 */
export function cobroSuperaDeuda(monto: number, deuda: number): boolean {
  return redondearCentavos(monto) > redondearCentavos(deuda);
}

function redondearCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Traduce el rechazo `COBRO_SUPERA_DEUDA` de la base a un mensaje para el
 * mostrador. Devuelve null si el error es otro.
 *
 * La base manda en `details` un JSON con `deuda` y `monto`. Si no llega o no
 * se puede leer, el mensaje sale igual, sin números.
 */
export function mensajeCobroSuperaDeuda(
  error: { message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!error?.message?.includes("COBRO_SUPERA_DEUDA")) return null;

  try {
    const { deuda, monto } = JSON.parse(error.details ?? "") as {
      deuda?: unknown;
      monto?: unknown;
    };
    if (typeof deuda === "number" && typeof monto === "number") {
      return textoCobroSuperaDeuda(monto, deuda);
    }
  } catch {
    // details vacío o no JSON: mensaje sin números.
  }

  return "El cobro supera lo que el cliente debe. Revisá el monto, o marcá que el resto queda a favor.";
}

export function textoCobroSuperaDeuda(monto: number, deuda: number): string {
  return `El cobro (${pesos(monto)}) supera lo que el cliente debe (${pesos(deuda)}). Revisá el monto, o marcá que el resto queda a favor.`;
}

/** Cuánto quedaría a favor si se cobra `monto` sobre `deuda` (0 si no
 * sobra). Mismo redondeo al centavo que el tope. */
export function excedenteSobreDeuda(monto: number, deuda: number): number {
  const sobra = redondearCentavos(monto) - redondearCentavos(Math.max(0, deuda));
  return sobra > 0 ? redondearCentavos(sobra) : 0;
}

// Con centavos: `formatearMoneda` redondea al peso, y una deuda de $7.557,50
// contra un cobro de $7.558 diría "$7.558 supera $7.558".
function pesos(valor: number): string {
  return `$${valor.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
