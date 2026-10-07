/**
 * Marca de un producto de electro deducida del NOMBRE, para cuando el Excel
 * no trae columna "Marca".
 *
 * En electro la marca viene casi siempre al principio del nombre ("SAMSUNG
 * A17", "Moto g15", "iPhone 15"), y el universo es chico y conocido: un
 * diccionario alcanza. En ropa no (la marca es del fabricante y no aparece en
 * el nombre), por eso esto solo mira marcas de electro y no adivina nada fuera
 * de la lista. Caso: ClickTostado cargó 16 celulares con la marca solo en el
 * nombre (7/10/2026).
 *
 * Si el comercio ya usa esa marca con otra escritura ("SAMSUNG" vs
 * "Samsung"), se respeta la suya: dos escrituras de la misma marca parten los
 * filtros.
 */

/** Primera(s) palabra(s) del nombre → marca canónica. Claves en minúscula y
 * sin acentos. */
const MARCAS: Record<string, string> = {
  samsung: "Samsung",
  galaxy: "Samsung",
  motorola: "Motorola",
  moto: "Motorola",
  xiaomi: "Xiaomi",
  redmi: "Redmi",
  poco: "Poco",
  apple: "Apple",
  iphone: "Apple",
  ipad: "Apple",
  macbook: "Apple",
  huawei: "Huawei",
  honor: "Honor",
  zte: "ZTE",
  nokia: "Nokia",
  alcatel: "Alcatel",
  tcl: "TCL",
  lg: "LG",
  realme: "Realme",
  oppo: "Oppo",
  vivo: "Vivo",
  infinix: "Infinix",
  tecno: "Tecno",
  oneplus: "OnePlus",
  google: "Google",
  pixel: "Google",
  lenovo: "Lenovo",
  asus: "Asus",
  acer: "Acer",
  hp: "HP",
  dell: "Dell",
  sony: "Sony",
  playstation: "Sony",
  nintendo: "Nintendo",
  jbl: "JBL",
  philips: "Philips",
  philco: "Philco",
  noblex: "Noblex",
  bgh: "BGH",
  hisense: "Hisense",
  amazfit: "Amazfit",
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function inferirMarca(
  nombre: string,
  marcasExistentes: readonly string[] = [],
): string | null {
  const primera = normalizar(nombre).split(/[\s\-_/.,]+/)[0] ?? "";
  // "moto" solo como palabra entera: "Motosierra" no es Motorola.
  const canonica = MARCAS[primera];
  if (!canonica) return null;

  const existente = marcasExistentes.find(
    (m) => normalizar(m) === normalizar(canonica),
  );
  return existente ?? canonica;
}
