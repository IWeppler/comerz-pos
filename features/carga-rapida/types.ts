import type {
  Opcion,
  ProductoCreado,
  VarianteInput,
} from "@/features/stock/types";
import type { UnidadMedida } from "@/shared/lib/fiscal-producto";
import type { Presentacion } from "@/shared/lib/presentaciones";

export type LineaCargaExistente = {
  kind: "EXISTENTE";
  clienteLineaId: string;
  varianteId: string;
  productoId: string;
  nombreDisplay: string;
  nombreProducto: string;
  sku: string | null;
  cantidad: number;
  precioCosto: number;
  precioVenta: number;
  /** La del producto que ya existe. Decide si `cantidad` admite fracción
   * (0,5 kg de crema) y con qué abreviatura se muestra. */
  unidadMedida: UnidadMedida;
  /**
   * Las presentaciones que aplican a ESTA variante (resueltas con
   * `presentacionesDeVariante`), para que la fila ofrezca "kg | Balde 4,7 kg".
   * Vacío = solo se recibe en la unidad base.
   */
  presentaciones: Presentacion[];
  /**
   * En qué forma viene `cantidad`: null = unidad base; un id = esa
   * presentación, y entonces `cantidad` es entera y el stock que entra es
   * `cantidad × factor`. El factor se vuelve a leer en el server.
   */
  presentacionId: string | null;
};

type LineaCargaNuevaBase = {
  kind: "NUEVA";
  clienteLineaId: string;
  queryOriginal: string;
  nombre: string;
  codigo: string | null;
  marca: string | null;
  /** Modelo oficial (T4/T5). Se precarga del Catálogo Maestro cuando el EAN
   * matchea, y queda editable. */
  modelo: string | null;
  categoriaId: string | null;
  precioCompra: number;
  precioVenta: number;
  /**
   * Por qué se vende: unidad, kilo, litro… Se elige inline en la fila y viaja
   * a `crearProductoAction` como `unidad_medida`. Sin esto la carga rápida
   * creaba todo por UNIDAD: "1" de crema era una crema, no un kilo, y después
   * no se podía vender de a 0,250 sin ir a editar el producto.
   */
  unidadMedida: UnidadMedida;
  /** Referencia al producto del maestro del que se precargó, si hubo match.
   * Los datos ya están COPIADOS en los campos de arriba: esto es solo
   * trazabilidad, nada de la venta depende de poder resolverlo después. */
  idMaster: string | null;
};

/** Producto nuevo simple: una sola línea, cantidad editable inline en la
 * lista, igual que hoy.
 *
 * `atributos` son los de variante que el RUBRO carga inline en la fila
 * (`atributos-inline-por-rubro.ts`: talle y color en indumentaria, peso en
 * un kiosco, medida y material en ferretería), por clave de planilla y
 * OPCIONALES. Si alguno viene cargado, la línea deja de crear un producto
 * "Único" y crea UNA combinación con esos atributos (ver procesarLineaNueva
 * en confirmar-carga.ts). No se guardan como texto suelto: viajan como
 * opción + variante, así pasan por la MISMA canonicalización de atributos
 * que el alta completa y "ROJO" no entra como una marca distinta de "Rojo". */
export type LineaCargaNuevaSimple = LineaCargaNuevaBase & {
  tieneVariantes: false;
  cantidad: number;
  atributos: Record<string, string>;
};

/** Producto nuevo con variantes (talle/color/etc): el stock y precio
 * viven por combinación, igual que en el alta completa de Stock — no hay
 * una "cantidad" única a nivel línea. Se edita reabriendo el modal. */
export type LineaCargaNuevaConVariantes = LineaCargaNuevaBase & {
  tieneVariantes: true;
  opciones: Opcion[];
  variantes: VarianteInput[];
  /**
   * Label fijo de la combinación cuando la variante YA vino resuelta del
   * Catálogo Maestro (ej. "Black / 64 GB").
   *
   * En electro cada combinación memoria/color es una fila distinta del
   * maestro, con su propio EAN y su propia caja: no hay matriz que armar. Con
   * este campo la lista muestra la variante como texto fijo y edita precio y
   * cantidad inline, en vez de mandar al modal de combinaciones (que existe
   * para el caso de indumentaria: 5 talles x 3 colores en UN producto).
   *
   * undefined = el empleado armó las variantes a mano, el modal manda.
   */
  varianteFijaLabel?: string;
};

export type LineaCargaNueva =
  LineaCargaNuevaSimple | LineaCargaNuevaConVariantes;

export type LineaCarga = LineaCargaExistente | LineaCargaNueva;

/**
 * Lo que una línea dejó efectivamente cargado, con la forma mínima para
 * poder usarlo sin releer el catálogo.
 *
 * Existe para el contexto de retorno: cuando la Carga rápida se abre desde
 * el POS, la venta tiene que poder seguir con el producto recién cargado sin
 * esperar a que React Query refresque. Es la MISMA forma para una línea
 * NUEVA (producto recién creado) que para una EXISTENTE (producto que ya
 * estaba y solo recibió stock): quien invoca no necesita distinguirlas.
 */
export type ProductoCargado = ProductoCreado;

export type ResultadoLineaCarga = {
  clienteLineaId: string;
  ok: boolean;
  error?: string;
  /** Presente solo si la línea se procesó OK. */
  cargado?: ProductoCargado;
};

export type ConfirmarCargaResponse = {
  resultados: ResultadoLineaCarga[];
  totalOk: number;
  totalError: number;
};
