/**
 * El negocio activo va SIEMPRE al final de la clave de las listas que dependen
 * de él. Al final y no al principio para que la invalidación por prefijo
 * (`["pos","productos"]`) siga alcanzando a todas las variantes.
 *
 * Sin esto, cambiar de negocio dejaba a Vender/Inventario/Clientes mostrando el
 * catálogo del negocio anterior hasta recargar a mano: `router.refresh()`
 * re-renderiza el server, pero no toca el cache de React Query, que vive en el
 * cliente y sobrevive al refresh.
 */
export function conNegocio<T extends readonly unknown[]>(
  clave: T,
  negocioId: string | null | undefined,
) {
  return [...clave, negocioId ?? "sin-negocio"] as const;
}

export const queryKeys = {
  /**
   * EL catálogo del panel: UNA entrada para /pos y /stock.
   *
   * Antes eran dos (`pos.productos` y `stock.index`) con casi los mismos
   * productos en dos formas distintas, así que ir de una pantalla a la otra
   * volvía a bajar ~2 MB con el 90% ya en memoria. Ver
   * `shared/actions/catalogo-panel.ts` para los números y para por qué la
   * consulta viene SIN filtrar (cada pantalla se queda con lo suyo).
   *
   * Efecto colateral bienvenido: los diez lugares que invalidaban las dos
   * claves ahora invalidan una. Dos claves que había que acordarse de tocar
   * juntas eran una a la que alguien se iba a olvidar.
   */
  catalogo: ["catalogo", "panel"] as const,
  /**
   * Las listas de precios del negocio y sus precios fijos.
   *
   * Entrada propia y no parte del catálogo: son dos filas y unas pocas
   * excepciones contra los ~2 MB de productos, cambian por otro motivo
   * (Configuración, no una venta) y las leen DOS componentes hermanos del POS
   * —la grilla y el ticket— que necesitan ver exactamente lo mismo. Con dos
   * consultas separadas, una podría traer una lista que la otra ya no tiene.
   */
  listasPrecios: ["listas-precios"] as const,
  stock: {
    detalle: (productoId: string) => ["stock", "detalle", productoId] as const,
  },
  clientes: {
    listado: ["clientes", "listado"] as const,
    /** Los avisos de cuenta corriente del día. Cuelga de `listado` a
     * propósito: todo lo que invalida el listado (un cobro, un ajuste, la
     * configuración) invalida también los avisos por prefijo. */
    avisos: ["clientes", "listado", "avisos"] as const,
    detalle: (clienteId: string) => ["clientes", "detalle", clienteId] as const,
  },
  categorias: {
    atributos: (categoriaId: string) =>
      ["categorias", "atributos", categoriaId] as const,
  },
};

/**
 * configuracion_pos viaja dentro de las 3 queries de catálogo (posName en
 * las tres, mostrar_sin_stock/permitir_venta_sin_stock en pos y stock,
 * cc_anticipo_default/recargo_mora en clientes). Cualquier guardado en
 * Configuración debe invalidar estas tres para no esperar el staleTime.
 */
export const CATALOG_QUERY_KEYS = [
  queryKeys.catalogo,
  queryKeys.clientes.listado,
] as const;

/**
 * Qué queries se guardan en el celular para poder abrir la app sin señal
 * (ver `shared/lib/cache-offline.ts`).
 *
 * La lista es CORTA a propósito y es una decisión de plata, no de
 * performance: entra el catálogo —lo que hace falta para consultar un precio
 * o ver si hay stock— y NO entra nada que el comercio use para cobrar. Caja,
 * turnos y el listado de clientes (que trae los saldos de cuenta corriente)
 * quedan afuera: una foto vieja de un saldo no es un dato incompleto, es un
 * dato equivocado, y alguien lo usa para cobrar.
 *
 * `stock.detalle` tampoco entra: es por producto y solo hace falta con el
 * sheet de edición abierto, que es justo cuando SÍ se necesita estar online
 * para guardar.
 *
 * Con el catálogo unificado esto es UNA entrada y no dos. Antes se guardaban
 * `pos.productos` y `stock.index` por separado, o sea ~4 MB de payload
 * duplicado en el disco del celular.
 */
const QUERIES_PERSISTIBLES: readonly (readonly string[])[] = [
  queryKeys.catalogo,
];

export function esQueryPersistible(clave: readonly unknown[]): boolean {
  return QUERIES_PERSISTIBLES.some((persistible) =>
    persistible.every((parte, indice) => clave[indice] === parte),
  );
}
