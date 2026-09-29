/**
 * Opciones de financiación de una cotización: "3 cuotas de $X".
 *
 * Las tasas son las de `configuracion_pos.plan_tasas_financiacion`
 * (`[{cuotas: 3, pct: 10}]`), CONGELADAS en la cotización al emitirla
 * (`presupuestos.tasas_financiacion`). El recargo va sobre el saldo
 * FINANCIADO = total − anticipo (ver docs/presupuestos.md): el anticipo no
 * paga interés.
 *
 * Todo en centavos enteros. Repartir $10.000 en 3 cuotas da 3.333,33 × 3 =
 * 9.999,99: el centavo que sobra va a la ÚLTIMA cuota, así la suma de las
 * cuotas es exactamente el total financiado y ninguna cuota es menor que la
 * que se anunció.
 *
 * La etapa 3 (el plan) usa esta misma función para generar las cuotas: lo
 * que el cliente vio en la cotización es lo que va a pagar.
 */

export type TasaFinanciacion = { cuotas: number; pct: number };

export type OpcionFinanciacion = {
  cuotas: number;
  pct: number;
  anticipo: number;
  /** Total − anticipo: sobre esto se calcula el recargo. */
  financiado: number;
  recargo: number;
  /** financiado + recargo = suma de todas las cuotas. */
  totalFinanciado: number;
  /** Las primeras `cuotas − 1`. */
  montoCuota: number;
  /** La última: igual a `montoCuota` o unos centavos más. */
  ultimaCuota: number;
  /** anticipo + totalFinanciado: lo que termina pagando el cliente. */
  totalFinal: number;
};

/** Techos de la pantalla de configuración. La base solo exige cuotas entera
 * ≥ 1 y pct ≥ 0 (`configuracion_pos_plan_tasas_check`); estos frenan el dedo
 * de más antes de que llegue a un papel que se le manda a un cliente. */
export const CUOTAS_MAX = 60;
export const PCT_MAX = 1000;

const aCentavos = (monto: number) => Math.round(monto * 100);
const aPesos = (centavos: number) => centavos / 100;

/**
 * Lee las tasas guardadas (jsonb) para MOSTRARLAS. Lo que no tiene forma de
 * tasa no se muestra, pero la base ya lo impide con un CHECK: esto es la
 * defensa ante un jsonb viejo, no un filtro de datos que se esperan. Ordena
 * por cuotas y se queda con la primera si una cantidad está repetida.
 */
export function leerTasas(raw: unknown): TasaFinanciacion[] {
  if (!Array.isArray(raw)) return [];
  const vistas = new Set<number>();
  return raw
    .filter(
      (t): t is TasaFinanciacion =>
        typeof t === "object" &&
        t !== null &&
        Number.isInteger((t as TasaFinanciacion).cuotas) &&
        (t as TasaFinanciacion).cuotas >= 1 &&
        typeof (t as TasaFinanciacion).pct === "number" &&
        Number.isFinite((t as TasaFinanciacion).pct) &&
        (t as TasaFinanciacion).pct >= 0,
    )
    .map((t) => ({ cuotas: t.cuotas, pct: t.pct }))
    .sort((a, b) => a.cuotas - b.cuotas)
    .filter((t) => {
      if (vistas.has(t.cuotas)) return false;
      vistas.add(t.cuotas);
      return true;
    });
}

export type ResultadoTasas =
  | { ok: true; tasas: TasaFinanciacion[] }
  | { ok: false; error: string };

/**
 * Valida las tasas que se van a GUARDAR. Acá no se descarta nada en silencio:
 * una fila mal cargada es un error con la fila nombrada.
 */
export function validarTasas(entrada: unknown): ResultadoTasas {
  if (!Array.isArray(entrada)) {
    return { ok: false, error: "Las tasas no tienen el formato esperado." };
  }
  const tasas: TasaFinanciacion[] = [];
  const vistas = new Set<number>();
  for (const [i, fila] of entrada.entries()) {
    const n = i + 1;
    const cuotas = Number((fila as TasaFinanciacion | null)?.cuotas);
    const pct = Number((fila as TasaFinanciacion | null)?.pct);
    if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > CUOTAS_MAX) {
      return {
        ok: false,
        error: `Fila ${n}: las cuotas tienen que ser un número entero entre 1 y ${CUOTAS_MAX}.`,
      };
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > PCT_MAX) {
      return {
        ok: false,
        error: `Fila ${n}: el recargo tiene que ser un porcentaje entre 0 y ${PCT_MAX}.`,
      };
    }
    if (vistas.has(cuotas)) {
      return { ok: false, error: `Hay dos filas de ${cuotas} cuotas.` };
    }
    vistas.add(cuotas);
    // Dos decimales, como se muestra: 10,125 % no existe en un papel.
    tasas.push({ cuotas, pct: Math.round(pct * 100) / 100 });
  }
  tasas.sort((a, b) => a.cuotas - b.cuotas);
  return { ok: true, tasas };
}

export function calcularOpcion(
  total: number,
  tasa: TasaFinanciacion,
  anticipo = 0,
): OpcionFinanciacion {
  const totalC = aCentavos(total);
  // Un anticipo mayor que el total no financia nada: se acota, no se niega.
  const anticipoC = Math.min(Math.max(aCentavos(anticipo), 0), totalC);
  const financiadoC = totalC - anticipoC;
  const recargoC = Math.round((financiadoC * tasa.pct) / 100);
  const totalFinanciadoC = financiadoC + recargoC;
  const cuotaC = Math.floor(totalFinanciadoC / tasa.cuotas);
  const ultimaC = totalFinanciadoC - cuotaC * (tasa.cuotas - 1);

  return {
    cuotas: tasa.cuotas,
    pct: tasa.pct,
    anticipo: aPesos(anticipoC),
    financiado: aPesos(financiadoC),
    recargo: aPesos(recargoC),
    totalFinanciado: aPesos(totalFinanciadoC),
    montoCuota: aPesos(cuotaC),
    ultimaCuota: aPesos(ultimaC),
    totalFinal: aPesos(anticipoC + totalFinanciadoC),
  };
}

export function opcionesDeFinanciacion(
  total: number,
  tasasRaw: unknown,
  anticipo = 0,
): OpcionFinanciacion[] {
  return leerTasas(tasasRaw).map((t) => calcularOpcion(total, t, anticipo));
}
