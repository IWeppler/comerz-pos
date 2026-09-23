/**
 * Qué movimiento pertenece a la pestaña DINERO y cuál pertenece al TURNO.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SON DOS TABLAS DE MOVIMIENTOS, NO UNA MOSTRADA DOS VECES
 *
 * En Hoy, "Movimientos de mi turno" es el detalle del cajón: cada venta, cada
 * cobro de deuda, cada gasto que salió de ahí. Es lo que la cajera tiene que
 * poder reconstruir cuando cuenta la plata, y su unidad es el TICKET.
 *
 * En Dinero, la pregunta es otra: qué movió el saldo de mis cuentas. Ahí el
 * grano es la CUENTA y el DÍA.
 *
 * Eso se resuelve con DOS mecanismos distintos, y conviene no confundirlos:
 *
 *  1. CONSOLIDAR — los cobros de venta entran sumados por cuenta y por día
 *     ("Cobros del día · Mercado Pago · 9 cobros"). Lo hace la BASE, en
 *     `movimientos_financieros_negocio(p_vista => 'CUENTAS')`: el `total` de
 *     la paginación tiene que contar lo que se muestra, y el saldo posterior
 *     tiene que seguir saliendo del ledger entero.
 *
 *  2. ESCONDER — el gasto y el ingreso cargados contra un cajón que alguien
 *     arquea. Eso ya se ve, y se explica, en el turno; acá llega adentro del
 *     cierre. Es lo único que la vista de cuentas oculta, y es lo que espeja
 *     este archivo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ERROR QUE ESTO REEMPLAZA (y por qué está escrito acá)
 *
 * La primera versión escondía TODOS los cobros de venta, razonando que el
 * cierre del turno ya los representaba. Eso es cierto en el cajón y falso en
 * el banco: la plata digital nunca pasa por el cajón, va directo a la cuenta
 * de su método en el momento de cada venta, y nada la consolida después.
 *
 * Medido en Evens el 21/9/2026: la cuenta "TRANSFERENCIA MERCADO PAGO" subió
 * $282.175 en 9 cobros, y con aquel criterio la tabla no mostraba una sola
 * fila que lo explicara. Son 1.111 cobros directos a banco y billetera en
 * todo el SaaS. Esconder no era la respuesta; sumar sí.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** El tipo de cuenta donde vive el arqueo: la que cuenta quien vende. */
const CAJA_ARQUEADA = "CAJA_DIARIA";

/**
 * ESPEJO en TypeScript del filtro que aplica la vista `CUENTAS` de
 * `movimientos_financieros_negocio`. Los dos tienen que decir lo mismo,
 * mismo criterio que `temporada-categoria.ts` contra
 * `categoria_en_temporada`.
 *
 * Se sigue aplicando del lado del cliente por una sola razón: mientras la
 * migración de `p_vista` no esté aplicada, la RPC devuelve la vista completa
 * y sin este filtro la pantalla mostraría el detalle del cajón. Con las dos
 * al día, no descarta ninguna fila.
 *
 * Al revés que casi todo en esta base, acá el lado seguro es MOSTRAR: un
 * `origen_tipo` que este código no conoce se muestra igual. Esconder plata
 * que se movió, en silencio y por no reconocer una etiqueta, es peor que
 * mostrar una fila de más — y `etiquetaMovimiento` ya sabe decir "Movimiento"
 * sin inventar de qué se trata.
 */
export function esMovimientoDeCuentas(
  origenTipo: string,
  cuentaTipo: string,
): boolean {
  // Lo ÚNICO que la vista de cuentas esconde. Los cobros no se esconden: se
  // consolidan, y de eso se encarga la base.
  return !(
    (origenTipo === "EGRESO" || origenTipo === "INGRESO") &&
    cuentaTipo === CAJA_ARQUEADA
  );
}

/**
 * ¿Esta fila representa a varios movimientos sumados?
 *
 * La base manda `cantidad`; sin la migración aplicada no viene y entonces
 * cada fila es un movimiento, que es la verdad en ese caso.
 */
export function esFilaConsolidada(cantidad: number | undefined): boolean {
  return (cantidad ?? 1) > 1;
}
