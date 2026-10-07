import type { Rubro } from "@/entities/config/types";

/**
 * Diccionario de TÉRMINOS por rubro: qué categoría le corresponde a un
 * producto según las palabras de su nombre.
 *
 * Existe porque el que ya había (`category-suggestions.ts`) devuelve los
 * nombres LITERALES de las categorías de Evens ("CAMPERAS Y CHALECOS DE
 * HOMBRE", con doble espacio incluido). Sirve para Evens y para nadie más:
 * un comercio nuevo, que es justo el caso del modo carga inicial, no tiene
 * ninguna categoría con ese nombre y se queda sin sugerencia.
 *
 * Acá los nombres son GENÉRICOS a propósito ("Camperas", no "CAMPERAS Y
 * CHALECOS DE  HOMBRE"). Se resuelven contra el árbol real del comercio por
 * slug (ver inferir-categoria-fila.ts), y si el comercio no tiene esa
 * categoría, el nombre genérico es el que se le propone crear. Un comercio
 * que arranca con el catálogo vacío necesita que alguien le proponga las
 * categorías, no solo que se las pida.
 *
 * NO reemplaza a `category-suggestions.ts`: ese sigue siendo el que resuelve
 * el árbol por audiencia (Ropa Mujer › Camperas), que es más preciso cuando
 * el comercio ya lo tiene armado. Este es el escalón de abajo.
 *
 * Los términos van sin tildes y en minúscula: se comparan contra el nombre
 * normalizado. El orden importa — el primero que matchea gana, así que lo
 * más específico va arriba ("camiseta" antes que "camisa").
 */
export type ReglaTermino = {
  /** Basta con que UNO aparezca en el nombre. */
  terminos: string[];
  /** Nombre genérico de la categoría. Es el que se muestra y el que se
   * propone crear si el comercio no la tiene. */
  categoria: string;
};

const INDUMENTARIA: ReglaTermino[] = [
  {
    terminos: ["campera", "chaleco", "tapado", "abrigo", "piloto"],
    categoria: "Camperas",
  },
  { terminos: ["buzo", "hoodie", "canguro"], categoria: "Buzos" },
  {
    terminos: ["camiseta", "remera", "musculosa", "top"],
    categoria: "Remeras",
  },
  { terminos: ["camisa", "blusa"], categoria: "Camisas y blusas" },
  {
    terminos: ["sueter", "sweater", "pullover", "cardigan"],
    categoria: "Sweaters",
  },
  { terminos: ["bermuda", "short"], categoria: "Shorts y bermudas" },
  {
    terminos: [
      "jean",
      "pantalon",
      "babucha",
      "jogging",
      "joggin",
      "cargo",
      "palazo",
    ],
    categoria: "Pantalones",
  },
  { terminos: ["calza", "legging"], categoria: "Calzas" },
  { terminos: ["pollera", "falda"], categoria: "Polleras" },
  { terminos: ["vestido"], categoria: "Vestidos" },
  { terminos: ["conjunto"], categoria: "Conjuntos" },
  {
    terminos: [
      "body",
      "bodies",
      "enterito",
      "ranita",
      "osito",
      "pilucho",
      "jardinero",
    ],
    categoria: "Bodies y enteritos",
  },
  { terminos: ["pijama", "camison"], categoria: "Pijamas" },
  {
    terminos: ["malla", "bikini", "traje de bano"],
    categoria: "Trajes de baño",
  },
  {
    terminos: ["bombacha", "corpino", "boxer", "calzoncillo", "culotte"],
    categoria: "Ropa interior",
  },
  { terminos: ["media", "soquete"], categoria: "Medias" },
  {
    terminos: [
      "zapatilla",
      "botita",
      "bota",
      "borcego",
      "sandalia",
      "ojota",
      "zapato",
    ],
    categoria: "Calzado",
  },
  {
    terminos: [
      "gorra",
      "gorro",
      "cinturon",
      "billetera",
      "mochila",
      "bufanda",
      "guante",
      "panuelo",
      "rinonera",
      "cartera",
    ],
    categoria: "Accesorios",
  },
];

const ELECTRO: ReglaTermino[] = [
  {
    terminos: ["celular", "smartphone", "iphone", "moto ", "galaxy"],
    categoria: "Celulares",
  },
  { terminos: ["notebook", "laptop", "netbook"], categoria: "Notebooks" },
  { terminos: ["tablet", "ipad"], categoria: "Tablets" },
  { terminos: ["smart tv", "televisor", "tv "], categoria: "Televisores" },
  {
    terminos: [
      "heladera",
      "freezer",
      "lavarropas",
      "secarropas",
      "cocina",
      "horno",
      "microondas",
      "lavavajilla",
    ],
    categoria: "Electrodomésticos",
  },
  {
    terminos: [
      "aire acondicionado",
      "split",
      "ventilador",
      "calefactor",
      "estufa",
    ],
    categoria: "Climatización",
  },
  {
    terminos: ["auricular", "parlante", "soundbar", "audio"],
    categoria: "Audio",
  },
  {
    terminos: [
      "licuadora",
      "batidora",
      "cafetera",
      "tostadora",
      "pava",
      "airfryer",
      "freidora",
    ],
    categoria: "Pequeños electrodomésticos",
  },
  {
    terminos: ["cargador", "cable", "funda", "memoria", "pendrive"],
    categoria: "Accesorios",
  },
];

const ALIMENTOS: ReglaTermino[] = [
  {
    terminos: ["gaseosa", "agua", "jugo", "cerveza", "vino", "fernet"],
    categoria: "Bebidas",
  },
  {
    terminos: [
      "galletita",
      "alfajor",
      "chocolate",
      "caramelo",
      "snack",
      "papas",
    ],
    categoria: "Golosinas y snacks",
  },
  {
    terminos: [
      "fideo",
      "arroz",
      "harina",
      "azucar",
      "aceite",
      "yerba",
      "cafe",
      "te ",
    ],
    categoria: "Almacén",
  },
  {
    terminos: ["leche", "yogur", "queso", "manteca", "crema"],
    categoria: "Lácteos",
  },
  {
    terminos: ["carne", "pollo", "milanesa", "chorizo", "hamburguesa"],
    categoria: "Carnicería",
  },
  {
    terminos: ["pan", "factura", "bizcocho", "medialuna"],
    categoria: "Panadería",
  },
  {
    terminos: ["detergente", "lavandina", "jabon", "papel", "limpiador"],
    categoria: "Limpieza",
  },
];

const FARMACIA: ReglaTermino[] = [
  {
    terminos: [
      "ibuprofeno",
      "paracetamol",
      "aspirina",
      "antibiotico",
      "comprimido",
    ],
    categoria: "Medicamentos",
  },
  {
    terminos: [
      "shampoo",
      "acondicionador",
      "crema",
      "jabon",
      "desodorante",
      "pasta dental",
    ],
    categoria: "Cuidado personal",
  },
  {
    terminos: ["panal", "toallita", "mamadera", "chupete"],
    categoria: "Bebés",
  },
  {
    terminos: ["venda", "gasa", "alcohol", "termometro", "barbijo"],
    categoria: "Botiquín",
  },
  {
    terminos: ["protector solar", "maquillaje", "labial", "esmalte"],
    categoria: "Cosmética",
  },
];

const FERRETERIA: ReglaTermino[] = [
  {
    terminos: ["martillo", "destornillador", "pinza", "llave", "alicate"],
    categoria: "Herramientas de mano",
  },
  {
    terminos: ["taladro", "amoladora", "sierra", "lijadora", "atornillador"],
    categoria: "Herramientas eléctricas",
  },
  {
    terminos: ["tornillo", "clavo", "tuerca", "bulon", "arandela"],
    categoria: "Bulonería",
  },
  {
    terminos: ["pintura", "latex", "esmalte", "pincel", "rodillo"],
    categoria: "Pinturería",
  },
  {
    terminos: ["cable", "enchufe", "llave de luz", "lampara", "foco"],
    categoria: "Electricidad",
  },
  {
    terminos: ["cano", "canilla", "codo", "union", "flexible"],
    categoria: "Plomería",
  },
];

const PINTURERIA: ReglaTermino[] = [
  { terminos: ["aerosol"], categoria: "Aerosoles" },
  { terminos: ["latex"], categoria: "Látex" },
  { terminos: ["esmalte", "sintetico"], categoria: "Esmaltes" },
  { terminos: ["barniz", "laca"], categoria: "Barnices" },
  { terminos: ["membrana", "impermeabilizante"], categoria: "Impermeabilizantes" },
  { terminos: ["enduido", "fijador", "sellador", "masilla"], categoria: "Preparación" },
  { terminos: ["aguarras", "thinner", "diluyente"], categoria: "Diluyentes" },
  { terminos: ["pincel", "rodillo", "espatula", "bandeja", "lija", "cinta de papel"], categoria: "Herramientas" },
];

const QUIOSCOS: ReglaTermino[] = [
  {
    terminos: ["cigarrillo", "tabaco", "encendedor"],
    categoria: "Cigarrillos",
  },
  {
    terminos: ["chicle", "caramelo", "chupetin", "alfajor", "chocolate"],
    categoria: "Golosinas",
  },
  {
    terminos: ["gaseosa", "agua", "energizante", "jugo", "cerveza"],
    categoria: "Bebidas",
  },
  { terminos: ["papas", "palito", "mani", "snack"], categoria: "Snacks" },
  { terminos: ["cuaderno", "birome", "lapiz", "goma"], categoria: "Librería" },
];

const COTILLON: ReglaTermino[] = [
  {
    terminos: ["globo", "inflable", "helio"],
    categoria: "Globos",
  },
  {
    terminos: ["piñata", "pinata", "sorpresa", "souvenir", "cotillon"],
    categoria: "Piñatas y souvenirs",
  },
  {
    terminos: ["guirnalda", "banderin", "cartel", "letrero", "adorno"],
    categoria: "Decoración",
  },
  {
    terminos: ["vela", "velita", "numero", "bengala"],
    categoria: "Velas",
  },
  {
    // Antes que "descartable" a secas: el vaso y el plato son lo que se pide
    // por nombre en el mostrador.
    terminos: ["vaso", "plato", "servilleta", "mantel", "descartable", "bandeja"],
    categoria: "Mesa y descartables",
  },
  {
    terminos: ["disfraz", "antifaz", "peluca", "corona", "vincha", "gorro"],
    categoria: "Disfraces y accesorios",
  },
  {
    terminos: ["confite", "gomita", "caramelo", "chupetin", "chocolate", "golosina"],
    categoria: "Golosinas",
  },
  {
    terminos: ["papel", "bolsa", "moño", "cinta", "regalo"],
    categoria: "Envoltorios",
  },
];

/**
 * Rubro → diccionario. `otros` va vacío a propósito: sin saber qué vende el
 * comercio, cualquier término sería una adivinanza, y la fila se completa a
 * mano — que es lo que la persona iba a hacer igual.
 */
export const TERMINOS_POR_RUBRO: Record<Rubro, ReglaTermino[]> = {
  pintureria: PINTURERIA,
  indumentaria: INDUMENTARIA,
  electro: ELECTRO,
  alimentos: ALIMENTOS,
  farmacia: FARMACIA,
  ferreteria: FERRETERIA,
  quioscos: QUIOSCOS,
  cotillon: COTILLON,
  otros: [],
};

/**
 * Primer término del diccionario del rubro que aparece en el texto ya
 * normalizado (minúsculas, sin tildes). Devuelve el nombre genérico de la
 * categoría, o null si ninguno matchea.
 */
export function categoriaPorTerminos(
  textoNormalizado: string,
  rubro: Rubro,
): string | null {
  for (const regla of TERMINOS_POR_RUBRO[rubro]) {
    if (regla.terminos.some((t) => textoNormalizado.includes(t))) {
      return regla.categoria;
    }
  }
  return null;
}
