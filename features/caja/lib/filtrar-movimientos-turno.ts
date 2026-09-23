/**
 * El buscador y el filtro por método de "Movimientos de mi turno".
 *
 * Vive acá y no adentro del componente por el motivo de siempre en este
 * módulo: es la lógica que decide qué ve —y qué NO ve— alguien que está
 * contando plata, y eso se testea. Un filtro que esconde una fila sin decirlo
 * es la misma forma de error que un UPDATE que no falla.
 *
 * Es filtrado en el CLIENTE a propósito: los movimientos del turno ya están
 * todos en memoria (son los de una jornada de una caja, decenas), así que
 * pedirlos de vuelta a la base por cada tecla sería un viaje por nada.
 */

/** Lo mínimo que el filtro necesita de un movimiento. Se tipa por estructura
 * y no contra `MovimientoExtendido` para que el test no tenga que construir
 * una venta entera. */
export interface MovimientoFiltrable {
  concepto: string;
  metodo: string;
  metodo_tipo: string;
  usuario: string;
}

/** Valor del selector cuando no hay filtro. No es un `metodo_tipo` real. */
export const TODOS_LOS_METODOS = "TODOS";

/** Idem para el selector de empleado. */
export const TODOS_LOS_USUARIOS = "TODOS";

/**
 * Normaliza para comparar: sin mayúsculas y sin acentos.
 *
 * Lo segundo importa más de lo que parece: los conceptos se escriben a mano en
 * el mostrador ("Bolsas y packaging", "Devolución"), y quien busca tipea
 * rápido y sin tildes. Sin esto, buscar "devolucion" no encuentra
 * "Devolución" y la pantalla parece estar vacía.
 */
function normalizar(texto: string): string {
  return texto
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * ¿Este movimiento pasa el buscador y el selector de método?
 *
 * La búsqueda mira concepto, método y usuario — los tres campos que alguien
 * usaría para encontrar una fila: "qué era", "cómo se cobró" y "quién lo
 * cargó". El importe NO entra: buscar "500" traería todo lo que tenga un 500
 * adentro de un número más largo, que es ruido disfrazado de resultado.
 */
export function pasaFiltroTurno(
  movimiento: MovimientoFiltrable,
  busqueda: string,
  metodoTipo: string,
  /** Nombre del empleado, o TODOS_LOS_USUARIOS. Existe porque el dueño ve los
   * movimientos de TODAS las cajas abiertas: sin este filtro, con tres
   * vendedoras la tabla es un revoltijo y "¿qué hizo Mara?" no se puede
   * contestar. Para una vendedora hay un solo nombre y el selector no se
   * muestra. */
  usuario: string = TODOS_LOS_USUARIOS,
): boolean {
  const texto = normalizar(busqueda).trim();
  if (texto !== "") {
    const campos = normalizar(
      `${movimiento.concepto} ${movimiento.metodo} ${movimiento.usuario}`,
    );
    // Cada palabra por separado: "efectivo mara" encuentra la fila aunque en
    // el texto no estén pegadas ni en ese orden.
    if (!texto.split(/\s+/).every((palabra) => campos.includes(palabra))) {
      return false;
    }
  }

  if (metodoTipo !== TODOS_LOS_METODOS && movimiento.metodo_tipo !== metodoTipo) {
    return false;
  }

  if (usuario !== TODOS_LOS_USUARIOS && movimiento.usuario !== usuario) {
    return false;
  }

  return true;
}

/** Los empleados que aparecen en los movimientos, para el selector. Misma
 * razón que `metodosPresentes`: sale de los datos, así nadie puede elegir a
 * alguien que no hizo nada en las cajas abiertas. */
export function usuariosPresentes(
  movimientos: readonly MovimientoFiltrable[],
): string[] {
  return [...new Set(movimientos.map((m) => m.usuario))]
    .filter((nombre) => nombre !== "")
    .sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Los métodos que ofrece el selector, sacados de los movimientos que hay.
 *
 * No es una lista fija: los métodos de pago los crea cada comercio
 * (`metodos_pago`), así que una constante acá se desactualizaría sola y
 * ofrecería filtros que no devuelven nada. Mostrar una opción que siempre da
 * cero resultados enseña a desconfiar del filtro.
 */
export function metodosPresentes(
  movimientos: readonly MovimientoFiltrable[],
): string[] {
  return [...new Set(movimientos.map((m) => m.metodo_tipo))]
    .filter((tipo) => tipo !== "")
    .sort((a, b) => a.localeCompare(b, "es"));
}

export interface TotalVisible {
  cantidad: number;
  ingresos: number;
  egresos: number;
  /** ingresos − egresos. */
  neto: number;
}

/**
 * El total de lo que la tabla está mostrando AHORA, con los filtros puestos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES EL TOTAL DE LO QUE SE VE, Y NADA MÁS
 *
 * No excluye ventas anuladas ni pases internos, al revés que las cuentas del
 * arqueo. Ese es el punto: tiene que poder verificarse sumando las filas de
 * la pantalla. Un total que descarta filas visibles es un número que no
 * cierra con lo que hay abajo, y quien lo sume a mano va a creer que el
 * sistema está mal.
 *
 * Para "cuánto cobré" está el arqueo, que sí aplica sus reglas y por eso da
 * distinto. Son dos preguntas.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function totalizarVisibles(
  movimientos: readonly { tipo: "INGRESO" | "EGRESO"; monto: number }[],
): TotalVisible {
  let ingresos = 0;
  let egresos = 0;

  for (const m of movimientos) {
    const monto = Number(m.monto) || 0;
    if (m.tipo === "INGRESO") ingresos += monto;
    else egresos += monto;
  }

  return {
    cantidad: movimientos.length,
    ingresos,
    egresos,
    neto: ingresos - egresos,
  };
}

const ETIQUETAS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  BILLETERA_VIRTUAL: "Billetera virtual",
};

/** El nombre del tipo en el idioma del mostrador. Un tipo que este código no
 * conoce se muestra tal cual en vez de esconderse: es un método que el
 * comercio creó y la vendedora lo reconoce por su nombre. */
export function etiquetaMetodoTipo(tipo: string): string {
  return ETIQUETAS[tipo] ?? tipo;
}
