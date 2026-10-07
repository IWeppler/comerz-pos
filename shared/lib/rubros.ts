import type { Rubro } from "@/entities/config/types";

/**
 * Rubro COMERCIAL: de qué dice ser el comercio que se da de alta.
 *
 * Vive acá y no en una server action porque un archivo "use server" sólo puede
 * exportar funciones async, y esta lista la consume un componente cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OJO, son DOS rubros distintos y confundirlos rompe cosas:
 *
 *   `rubro_comercial` (esto)      17 valores. Segmentación: para saber a quién
 *                                 le estás vendiendo. Se lee en /admincomerz.
 *
 *   `configuracion_pos.rubro`     9 valores, con CHECK en la base. OPERATIVO:
 *                                 decide cómo se muestra la identidad del
 *                                 producto en Inventario — indumentaria razona
 *                                 por talle/color ("N var."), electro por
 *                                 modelo + EAN.
 *
 * El operativo se DERIVA del comercial en el alta (ver `rubroOperativoDesde`)
 * y después queda editable en Configuración. Lo que contestó en el formulario
 * es un punto de partida, no una condena: una ferretería puede querer la
 * identidad de electro y tiene que poder cambiarla sin pelear.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const RUBROS = [
  { valor: "indumentaria", etiqueta: "Indumentaria y textil" },
  { valor: "cosmetica", etiqueta: "Cosmética y cuidado personal" },
  { valor: "suplementos", etiqueta: "Suplementos y nutrición" },
  { valor: "bazar", etiqueta: "Bazar y decoración del hogar" },
  { valor: "electronica", etiqueta: "Electrónica y tecnología" },
  { valor: "ferreteria", etiqueta: "Ferretería y materiales" },
  { valor: "pintureria", etiqueta: "Pinturería" },
  { valor: "libreria", etiqueta: "Librería y papelería" },
  { valor: "jugueteria", etiqueta: "Juguetería" },
  { valor: "farmacia", etiqueta: "Farmacia" },
  { valor: "gastronomia", etiqueta: "Gastronomía" },
  { valor: "panaderia", etiqueta: "Panadería y confitería" },
  { valor: "almacen", etiqueta: "Almacén y dietética" },
  { valor: "bebidas", etiqueta: "Bebidas" },
  { valor: "mascotas", etiqueta: "Mascotas" },
  // Se agregó el 8/9/2026 porque faltaba: El Nono Cacho se dio de alta como
  // "Otro" —lo único que le quedaba— y su operativo terminó en indumentaria,
  // o sea con la plantilla de talles y colores de una tienda de ropa.
  { valor: "cotillon", etiqueta: "Cotillón y fiestas" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

export type RubroComercial = (typeof RUBROS)[number]["valor"];

export function etiquetaRubro(valor: string | null | undefined) {
  if (!valor) return "Sin rubro";
  return RUBROS.find((r) => r.valor === valor)?.etiqueta ?? valor;
}

/**
 * Traducción de los 17 rubros comerciales a los 9 operativos.
 *
 * El criterio NO es "qué vende" sino "cómo se identifica su mercadería y qué
 * columnas necesita la planilla de ingreso": dos celulares del mismo modelo se
 * distinguen por IMEI, dos remeras por talle, dos fiambres por peso. Por eso
 * ferretería es su propio operativo (medida + material) y no "electro", y por
 * eso cosmética y suplementos caen en `farmacia`, que es el que aporta
 * `presentacion` (50ml, x60 cápsulas) — que es exactamente cómo se pide esa
 * mercadería.
 *
 * El Record es EXHAUSTIVO a propósito: agregar un rubro comercial a `RUBROS`
 * sin decidir su operativo es un error de compilación, no un valor que cae en
 * silencio a indumentaria. Ese silencio es justo lo que estuvo roto: hasta acá
 * el mapa era un Set de dos valores y TODO lo demás —farmacia, almacén,
 * panadería, gastronomía, bebidas, mascotas, bazar, librería, juguetería,
 * cosmética y suplementos— se configuraba como indumentaria y recibía la
 * plantilla de ropa, con columnas de talle y color.
 *
 * OJO: hoy NINGÚN rubro comercial mapea al operativo `quioscos`, así que sus
 * columnas (`columnas-por-rubro.ts`) son inalcanzables. Falta el valor
 * comercial "Kiosco / autoservicio" en `RUBROS`; hasta que exista, un kiosco
 * se da de alta como "Almacén" y cae en `alimentos`, que es un SUPERCONJUNTO
 * de las columnas de quioscos (agrega `peso`) — o sea que le sobra una columna,
 * no le falta ninguna. Mandar `almacen` a `quioscos` sería el error caro: le
 * sacaría el peso a las dietéticas, que lo usan de verdad.
 */
const OPERATIVO_POR_COMERCIAL: Record<RubroComercial, Rubro> = {
  indumentaria: "indumentaria",

  // Identidad por modelo + código, con unidades trazables una por una.
  electronica: "electro",

  // Medida y material son lo que distingue un tornillo de otro. Antes caía en
  // `electro`, que no tiene ninguna de las dos columnas.
  ferreteria: "ferreteria",
  pintureria: "pintureria",

  // Presentación + laboratorio/marca. No es por peso: es por envase.
  farmacia: "farmacia",
  cosmetica: "farmacia",
  suplementos: "farmacia",

  // Todo lo que se pide por peso o por envase con contenido declarado.
  // `mascotas` entra acá porque el grueso de la facturación es alimento
  // balanceado en bolsas de x kg, no los accesorios.
  almacen: "alimentos",
  panaderia: "alimentos",
  gastronomia: "alimentos",
  bebidas: "alimentos",
  mascotas: "alimentos",

  // Sin columnas propias que agregar: se identifican por nombre y código de
  // barras, que es lo que ya trae `otros`. Inventarles una columna sería peor
  // que no dársela — una columna siempre vacía enseña a ignorar columnas.
  // Tiene operativo propio y no cae en `otros` porque sí aporta columnas: el
  // COLOR parte variantes (el mismo globo en ocho colores) y la UNIDAD DE
  // MEDIDA hace falta para las golosinas sueltas, que se venden por kilo en el
  // mismo mostrador donde la piñata se vende por unidad.
  cotillon: "cotillon",

  bazar: "otros",
  libreria: "otros",
  jugueteria: "otros",
  otro: "otros",
};

/**
 * Traduce el rubro comercial al operativo.
 *
 * Fail-safe a indumentaria (no a `otros`) para un valor desconocido —fila
 * vieja, typo, alta hecha antes de que el rubro existiera—: es el mismo default
 * que `RUBRO_DEFAULT` y `normalizarRubro`, y tener dos fallbacks distintos para
 * la misma pregunta termina en dos configuraciones distintas para el mismo
 * comercio.
 */
export function rubroOperativoDesde(
  rubroComercial: string | null | undefined,
): Rubro {
  return (
    OPERATIVO_POR_COMERCIAL[rubroComercial as RubroComercial] ?? "indumentaria"
  );
}

/**
 * Cuánta gente trabaja en el comercio. Segmentación pura: no cambia ninguna
 * regla del sistema — los topes de usuarios los pone el plan, no esto.
 * Sirve para saber a qué tamaño de comercio le está sirviendo Comerz.
 */
export const TAMANOS_EQUIPO = [
  { valor: "solo_yo", etiqueta: "Solo yo" },
  { valor: "2_a_5", etiqueta: "2 a 5 personas" },
  { valor: "6_a_10", etiqueta: "6 a 10 personas" },
  { valor: "mas_de_10", etiqueta: "Más de 10 personas" },
] as const;

export type TamanoEquipo = (typeof TAMANOS_EQUIPO)[number]["valor"];

export function etiquetaTamanoEquipo(valor: string | null | undefined) {
  if (!valor) return "Sin dato";
  return TAMANOS_EQUIPO.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

/** Condición frente al IVA del EMISOR. Espejo del CHECK de
 * `configuracion_pos.condicion_iva`; "Consumidor Final" queda afuera porque no
 * es una condición con la que un comercio emita. */
export const CONDICIONES_IVA = [
  { valor: "Monotributo", etiqueta: "Monotributista" },
  { valor: "Responsable Inscripto", etiqueta: "Responsable Inscripto" },
  { valor: "Exento", etiqueta: "Exento" },
] as const;
