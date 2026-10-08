export type EstadoNegocio =
  | "activo"
  | "prueba"
  | "demo"
  | "suspendido"
  | "cancelado";

/**
 * Los estados que dejan al comercio TRABAJAR.
 *
 * `prueba` habilita igual que `activo`: durante los 14 días el comercio es un
 * cliente potencial usando el producto de verdad. Si no entrara acá, su
 * catálogo público daría 404 y el dueño no podría ni abrir su propio panel —
 * o sea que la prueba no se podría probar.
 *
 * Lo que separa a los dos NO es el acceso sino el cobro: `prueba` es "todavía
 * no pagó nunca". Cuando entra el primer pago pasa a `activo`.
 *
 * `demo` es el comercio de MUESTRA: el que un vendedor abre para enseñar el
 * producto. Tiene que funcionar entero —POS, panel y catálogo público— porque
 * la demo es justamente usarlo, así que habilita igual que los otros dos. Lo
 * que lo separa es que NO es un cliente ni un candidato: no suma al MRR, no
 * cuenta como alta, no vence y no genera avisos de cobranza. Sin un estado
 * propio, un comercio de demostración quedaba en `activo` inflando las
 * métricas o en `prueba` apareciendo como candidato a cerrar.
 *
 * El corte por FECHA es otro eje y vive en `plan_vencimiento`: una prueba
 * vencida sigue siendo `prueba`, con su vencimiento en el pasado. Mezclar los
 * dos ejes en una sola columna es lo que hacía que "está en prueba" hubiera que
 * deducirlo de si el vencimiento caía cerca del alta.
 *
 * Esta lista tiene un espejo en la base: el CHECK de `negocios.estado`, la
 * policy `negocios_select_anon_activo` y `security.negocio_publico()`. Si acá
 * se agrega un estado, va también allá — si no, el código lo deja pasar y la
 * RLS lo frena, que es el peor de los dos mundos porque no da error.
 */
export const ESTADOS_HABILITADOS: readonly EstadoNegocio[] = [
  "activo",
  "prueba",
  "demo",
] as const;

export function negocioHabilitado(
  estado: string | null | undefined,
): boolean {
  return ESTADOS_HABILITADOS.includes(estado as EstadoNegocio);
}

/**
 * El comercio de muestra que usan los vendedores.
 *
 * Se pregunta por función y no comparando el string en cada archivo: la
 * decisión de qué queda afuera de las métricas es una sola y tiene que poder
 * cambiarse en un lugar.
 */
export function esNegocioDemo(estado: string | null | undefined): boolean {
  return estado === "demo";
}

/**
 * El comercio se fue.
 *
 * La constante existe porque durante meses el código escribió y buscó el
 * estado `'baja'`, que NUNCA estuvo en el CHECK de la base: el nombre real es
 * `'cancelado'`. El botón "Dar de baja" fallaba siempre y el churn buscaba un
 * estado inexistente, así que daba 0 por construcción. Los dos bugs eran el
 * mismo string escrito a mano en cinco archivos.
 */
export const ESTADO_BAJA = "cancelado" as const;

/** Se fue. La palabra en pantalla sigue siendo "baja"; el dato es `cancelado`. */
export function esNegocioDeBaja(estado: string | null | undefined): boolean {
  return estado === ESTADO_BAJA;
}

/**
 * Suma al MRR: está activo (paga) Y Comerz no lo sacó de la cuenta.
 *
 * Son dos ejes a propósito. `estado` dice si el comercio opera y si ya dejó la
 * prueba; `cuenta_en_mrr` dice si esa operación es plata que entra. Un
 * comercio amigo o de cortesía está activo —tiene que poder trabajar sin que
 * la barra de prueba le avise que se terminó— pero no paga, y sumarlo
 * inflaría el MRR. `undefined` cuenta como true: es el default de la columna.
 *
 * El panel (`metricas-comerz.ts`) y las métricas (`metricas-globales.ts`)
 * preguntan acá: dos filtros escritos a mano terminan en dos MRR distintos.
 */
export function sumaAlMrr(negocio: {
  estado: string | null | undefined;
  cuenta_en_mrr?: boolean | null;
}): boolean {
  return negocio.estado === "activo" && negocio.cuenta_en_mrr !== false;
}

/** Cómo se llama cada estado en pantalla. */
export const ETIQUETA_ESTADO: Record<string, string> = {
  activo: "activo",
  prueba: "prueba",
  demo: "demo",
  suspendido: "suspendido",
  cancelado: "cancelado",
};
