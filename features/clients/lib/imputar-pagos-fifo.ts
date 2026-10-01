/**
 * Qué deuda cancela cada pago de cuenta corriente.
 *
 * EL PROBLEMA QUE RESUELVE. Un pago de CC no está imputado a una venta: entra
 * como un CREDITO suelto en `cuenta_corriente_movimientos` y lo único que hace
 * es bajar `clientes.saldo_pendiente`. La base sabe cuánto debe la clienta,
 * no QUÉ debe. Y esa diferencia importa para una sola cosa, pero cara: la
 * fecha de vencimiento, que decide si se le cobra mora.
 *
 * EL CASO QUE LO DESTAPÓ (Angi Levis, Estilo Bonito, 9/9/2026):
 *
 *   17/08  DEBITO   50.000     saldo  50.000
 *   05/09  CREDITO  40.000     saldo  10.000
 *   05/09  DEBITO  122.000     saldo 132.000
 *   07/09  CREDITO  69.500     saldo  62.500
 *
 * Pagó 109.500 sobre 172.000. La compra del 17/08 está cancelada de sobra —y
 * la pagó ANTES de su propio vencimiento, el 17/09—, así que lo único que le
 * queda vivo son 62.500 de la compra del 05/09. Su vencimiento debería salir
 * de esa fecha. El sistema le mostraba el 17/09, que es la del ciclo: como el
 * saldo nunca tocó cero, `recalcular_vencimiento_cc` deja el ancla clavada en
 * el PRIMER débito de la cuenta para siempre.
 *
 * LO QUE ESTA FUNCIÓN HACE, Y LO QUE NO. Imputa FIFO —el pago cancela lo más
 * viejo primero— y devuelve, por deuda, cuánto quedó vivo. Es lo mismo que ya
 * asume `antiguedad_saldo_cc` y lo que asume la propia clienta cuando paga.
 * NO decide si esa imputación manda en el vencimiento: eso es una regla
 * comercial y vive en quien la llame.
 *
 * ES UN SUPUESTO, NO UN DATO, y hay que decirlo cada vez: mientras los pagos
 * no se imputen de verdad en el schema, esto reconstruye una historia
 * plausible, no la que pasó. Si la clienta y la dueña acordaron que un pago
 * saldaba una compra puntual, acá no aparece.
 *
 * EL ORDEN ES CRONOLÓGICO Y ESO NO ES UN DETALLE. Un crédito solo puede
 * cancelar deudas que ya existían cuando se cobró; lo que sobra queda a favor
 * y lo consume la próxima compra. En la cuenta de Angi los dos movimientos del
 * 05/09 están en el mismo día y en distinto orden (el pago a las 14:17, la
 * compra a las 21:01): imputar por fecha sin desempatar da otra respuesta.
 */

export type TipoMovimientoCC = "DEBITO" | "CREDITO";

export interface MovimientoCC {
  /** Día del movimiento, ISO `YYYY-MM-DD`. En la base es
   * `coalesce(fecha_origen, día argentino de creado_en)` (20261001120000). */
  fecha: string;
  /** Desempata dos movimientos del mismo día. Es `creado_en`. Sin esto, el
   * pago y la compra del mismo día se ordenan por casualidad. */
  creadoEn?: string;
  tipo: TipoMovimientoCC;
  monto: number;
  /**
   * Si este DEBITO es un recargo por mora y no mercadería.
   *
   * En la base se reconoce por la ESTRUCTURA, no por el texto: un DEBITO con
   * `pago_id` es siempre una mora (la inserta `registrarPagoDeudaAction` atada
   * al cobro que la generó) y ningún otro DEBITO tiene `pago_id`. Verificado
   * sobre las 437 filas vivas: 39 DEBITO con pago_id, las 39 con "mora" en la
   * descripción; 253 con venta_id y 145 manuales, ninguno con pago_id.
   * Matchear por `descripcion ilike '%mora%'` funcionaría hoy y se rompería el
   * día que alguien escriba "mora" en un ajuste a mano.
   */
  esMora?: boolean;
  /**
   * Solo en un recargo: el id del DEBITO de capital al que pertenece. Es
   * `cuenta_corriente_movimientos.debito_origen_id`.
   *
   * ES LO QUE HACE QUE CAPITAL Y MORA SEAN UNA SOLA DEUDA en la cola. La
   * clienta paga su compra más vieja completa, con el recargo que esa compra
   * generó incluido; recién ahí la deuda queda saldada y el vencimiento pasa a
   * la compra siguiente.
   *
   * Sin él —`null` en la base— el recargo es una deuda suelta con su propia
   * fecha. No es lo mismo que "es del primero": null significa que no se sabe.
   */
  debitoOrigenId?: string | null;
  /** Opcionales, para poder mostrar de qué deuda se habla. */
  id?: string;
  descripcion?: string;
}

/**
 * Una deuda en la cola de imputación: un ticket con el recargo que generó
 * adentro, no dos filas sueltas.
 */
export interface DeudaImputada {
  id?: string;
  descripcion?: string;
  /** true solo cuando la deuda ES un recargo huérfano (sin ticket conocido).
   * Un ticket con recargo adentro NO es "mora": es un ticket que debe más. */
  esMora: boolean;
  fecha: string;
  /** Lo que se debía originalmente, RECARGOS INCLUIDOS. */
  monto: number;
  /** De `monto`, cuánto es recargo. Lo demás es mercadería. */
  montoMora: number;
  /** Cuánto de esta deuda cubrieron los pagos. */
  pagado: number;
  /** Lo que sigue vivo. 0 = cancelada. */
  saldo: number;
  cancelada: boolean;
}

export interface ImputacionFifo {
  /** Todas las deudas del período, en orden, con lo que quedó vivo de cada
   * una. Incluye las canceladas: "esta la pagaste" es información. */
  deudas: DeudaImputada[];
  /** Suma de lo vivo. Tiene que dar igual a `clientes.saldo_pendiente`; si no
   * da, el libro y el saldo dicen cosas distintas (ver `clientes_descuadrados`
   * en `antiguedad_saldo_cc`). */
  saldo: number;
  /** Pagos que no encontraron deuda: saldo a favor de la clienta. */
  aFavor: number;
  /** La deuda viva más antigua: el ticket que fija el vencimiento, con su
   * recargo adentro. `null` cuando no queda ninguna. Los recargos huérfanos
   * quedan afuera — ver `moraHuerfanaViva`. */
  deudaVivaMasAntigua: DeudaImputada | null;
  /**
   * Cuánto de lo que sigue vivo es recargo y no mercadería. Informativo: sirve
   * para explicarle a la clienta de qué está hecho su saldo, y es lo que se le
   * resta a la base del próximo recargo para que la mora no genere mora.
   */
  moraViva: number;
  /**
   * Recargo vivo que NO pertenece a ningún ticket conocido
   * (`debito_origen_id` en null).
   *
   * Es el único caso que necesita una regla aparte: no tiene un ticket viejo
   * que lo mantenga vivo en la cola, así que si se lo dejara con su propia
   * fecha —que es la del día en que se cobró— la clienta arrancaría un plazo
   * nuevo entero debiendo recargo. Mientras haya, la cuenta sigue vencida.
   *
   * Hoy son CERO: los 39 recargos del SaaS quedaron vinculados a su ticket, y
   * los nuevos nacen con el vínculo declarado. Existe para el caso que no
   * resuelva.
   */
  moraHuerfanaViva: number;
}

/** Redondeo al centavo. Trabajar con floats sobre pesos deja saldos de
 * 0,0000001 que hacen que una deuda cancelada figure viva. */
function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

function ordenar(movimientos: MovimientoCC[]): MovimientoCC[] {
  return movimientos
    .map((mov, indice) => ({ mov, indice }))
    .sort((a, b) => {
      if (a.mov.fecha !== b.mov.fecha) {
        return a.mov.fecha < b.mov.fecha ? -1 : 1;
      }
      const ca = a.mov.creadoEn ?? "";
      const cb = b.mov.creadoEn ?? "";
      if (ca !== cb) return ca < cb ? -1 : 1;
      // Empate total: se respeta el orden de entrada. Es arbitrario, pero es
      // estable, que es lo que importa para que dos pantallas coincidan.
      return a.indice - b.indice;
    })
    .map(({ mov }) => mov);
}

/**
 * Función pura. Recibe los movimientos NO anulados de un cliente y devuelve
 * qué quedó vivo de cada deuda.
 *
 * Los montos negativos o no numéricos se tratan como 0: una fila corrupta no
 * puede hacer que el resto de la cuenta se calcule mal.
 */
export function imputarPagosFifo(
  movimientos: MovimientoCC[],
): ImputacionFifo {
  const deudas: DeudaImputada[] = [];
  let aFavor = 0;

  for (const mov of ordenar(movimientos)) {
    const monto = Math.max(0, Number(mov.monto) || 0);
    if (monto === 0) continue;

    if (mov.tipo === "DEBITO") {
      // Un recargo NO abre deuda propia: engorda la del ticket que lo generó,
      // sin moverla de lugar en la cola. Esa deuda vuelve a estar viva aunque
      // su capital ya estuviera pagado — y con su fecha vieja, que es el punto:
      // el ticket no está saldado hasta que se pague también el recargo.
      if (mov.esMora === true && mov.debitoOrigenId) {
        const origen = deudas.find((d) => d.id === mov.debitoOrigenId);
        if (origen) {
          origen.monto = redondear(origen.monto + monto);
          origen.montoMora = redondear(origen.montoMora + monto);
          origen.saldo = redondear(origen.saldo + monto);
          origen.cancelada = origen.saldo === 0;

          if (aFavor > 0) {
            const usa = Math.min(aFavor, origen.saldo);
            origen.pagado = redondear(origen.pagado + usa);
            origen.saldo = redondear(origen.saldo - usa);
            origen.cancelada = origen.saldo === 0;
            aFavor = redondear(aFavor - usa);
          }
          continue;
        }
        // Apunta a un ticket que no está en el período: cae al caso de abajo y
        // se trata como deuda suelta. No se inventa a cuál pertenece.
      }

      const esMoraSuelta = mov.esMora === true;
      const deuda: DeudaImputada = {
        id: mov.id,
        descripcion: mov.descripcion,
        esMora: esMoraSuelta,
        fecha: mov.fecha,
        monto,
        montoMora: esMoraSuelta ? monto : 0,
        pagado: 0,
        saldo: monto,
        cancelada: false,
      };

      // El saldo a favor que dejó un pago anterior se consume acá: la clienta
      // que pagó de más no vuelve a deber esa plata con la próxima compra.
      if (aFavor > 0) {
        const usa = Math.min(aFavor, deuda.saldo);
        deuda.pagado = redondear(usa);
        deuda.saldo = redondear(deuda.saldo - usa);
        deuda.cancelada = deuda.saldo === 0;
        aFavor = redondear(aFavor - usa);
      }

      deudas.push(deuda);
      continue;
    }

    // CREDITO: cancela lo más viejo primero.
    let restante = monto;
    for (const deuda of deudas) {
      if (restante === 0) break;
      if (deuda.saldo === 0) continue;
      const usa = Math.min(restante, deuda.saldo);
      deuda.pagado = redondear(deuda.pagado + usa);
      deuda.saldo = redondear(deuda.saldo - usa);
      deuda.cancelada = deuda.saldo === 0;
      restante = redondear(restante - usa);
    }
    aFavor = redondear(aFavor + restante);
  }

  const saldo = redondear(
    deudas.reduce((total, deuda) => total + deuda.saldo, 0),
  );

  return {
    deudas,
    saldo,
    aFavor,
    // `deudas` está en orden cronológico, así que la primera viva es la más
    // antigua. Ya no hace falta saltear la mora: un recargo vive DENTRO de su
    // ticket, y el ticket con recargo impago sigue vivo y viejo por sí solo.
    // Solo se saltea el recargo huérfano, que no tiene ticket al que pertenecer.
    deudaVivaMasAntigua:
      deudas.find((deuda) => deuda.saldo > 0 && !deuda.esMora) ?? null,
    moraViva: redondear(
      deudas.reduce(
        (total, deuda) => total + Math.min(deuda.saldo, deuda.montoMora),
        0,
      ),
    ),
    moraHuerfanaViva: redondear(
      deudas
        .filter((deuda) => deuda.esMora)
        .reduce((total, deuda) => total + deuda.saldo, 0),
    ),
  };
}

/**
 * La fecha desde la que se cuenta el plazo de mora: el día de la deuda de
 * CAPITAL viva más antigua.
 *
 * Devuelve `null` cuando no queda capital vivo, que es lo mismo que dice hoy
 * `recalcular_vencimiento_cc` cuando no hay ancla: sin deuda no hay
 * vencimiento. Ojo: `null` NO quiere decir "al día" — puede quedar mora viva.
 * Para eso está `estaVencidaFifo`.
 */
export function anclaVencimientoFifo(
  movimientos: MovimientoCC[],
): string | null {
  return imputarPagosFifo(movimientos).deudaVivaMasAntigua?.fecha ?? null;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * La fecha de vencimiento que se guarda en `clientes.fecha_vencimiento_deuda`.
 *
 * ES EL ESPEJO EXACTO de `recalcular_vencimiento_cc` en la base, y las dos
 * tienen que devolver siempre lo mismo — mismo criterio que
 * `temporada-categoria.ts` contra `categoria_en_temporada`. Existe para poder
 * testear la regla sin base, que es lo único que evita que las dos se separen
 * sin que nadie lo note.
 *
 * Con mora viva devuelve la fecha de la mora más antigua SIN sumarle el plazo:
 * ese día la cuenta ya estaba vencida (por eso se cobró el recargo), así que
 * darle un plazo nuevo sería regalarle un ciclo. Ver `moraViva`.
 */
export function vencimientoFifo(
  movimientos: MovimientoCC[],
  plazoDias: number,
): string | null {
  const { deudas, deudaVivaMasAntigua, moraHuerfanaViva } =
    imputarPagosFifo(movimientos);

  const anclaCapital = deudaVivaMasAntigua?.fecha ?? null;
  const anclaMora =
    moraHuerfanaViva > 0
      ? (deudas.find((d) => d.esMora && d.saldo > 0)?.fecha ?? null)
      : null;

  if (!anclaCapital && !anclaMora) return null;
  if (!anclaMora) return sumarDias(anclaCapital as string, plazoDias);
  if (!anclaCapital) return anclaMora;

  const porCapital = sumarDias(anclaCapital, plazoDias);
  return porCapital < anclaMora ? porCapital : anclaMora;
}

/**
 * Si la cuenta está vencida, que es la pregunta que de verdad decide si se
 * cobra recargo. Son DOS condiciones y la segunda es la que pidió la dueña:
 *
 *   1. La deuda de capital más antigua ya pasó su plazo.
 *   2. Queda mora viva. Una cuenta que debe recargo sigue vencida aunque el
 *      capital esté al día: si no, un pago parcial que cubriera todo el
 *      capital le limpiaba la mora y le abría un ciclo nuevo.
 *
 * `hoy` entra por parámetro para que la función sea pura y testeable; el
 * llamador pasa la fecha del servidor, nunca la del navegador.
 */
export function estaVencidaFifo(
  movimientos: MovimientoCC[],
  plazoDias: number,
  hoy: string,
): boolean {
  const { deudaVivaMasAntigua, moraHuerfanaViva, saldo } =
    imputarPagosFifo(movimientos);

  if (saldo <= 0) return false;
  if (moraHuerfanaViva > 0) return true;
  if (!deudaVivaMasAntigua) return false;

  const vence = new Date(`${deudaVivaMasAntigua.fecha}T00:00:00Z`);
  vence.setUTCDate(vence.getUTCDate() + plazoDias);
  return new Date(`${hoy}T00:00:00Z`) > vence;
}
