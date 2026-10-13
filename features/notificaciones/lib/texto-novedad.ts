/**
 * El cuerpo de una Novedad (N5): texto plano con DOS marcas, nada más.
 *
 *   **así** ............ negrita
 *   "- " al principio .. viñeta (líneas seguidas forman una lista)
 *   línea en blanco .... párrafo nuevo
 *
 * Se parsea a bloques y se dibuja con elementos de React, nunca con
 * `dangerouslySetInnerHTML`: lo escribe el super admin, pero lo lee TODA la
 * base de usuarios, y un `<script>` pegado sin querer no puede llegar a nadie.
 * Lo mismo que no es una de las dos marcas queda como texto, tal cual.
 */

export type Tramo = { texto: string; negrita: boolean };
export type Bloque =
  | { tipo: "parrafo"; tramos: Tramo[] }
  | { tipo: "lista"; items: Tramo[][] };

/** "Hola **mundo**" → [Hola ][mundo en negrita]. Un ** sin cerrar queda como texto. */
export function tramosDe(linea: string): Tramo[] {
  const tramos: Tramo[] = [];
  let resto = linea;
  while (resto.length > 0) {
    const abre = resto.indexOf("**");
    const cierra = abre >= 0 ? resto.indexOf("**", abre + 2) : -1;
    if (abre < 0 || cierra < 0) {
      tramos.push({ texto: resto, negrita: false });
      break;
    }
    if (abre > 0) tramos.push({ texto: resto.slice(0, abre), negrita: false });
    const dentro = resto.slice(abre + 2, cierra);
    if (dentro.length > 0) tramos.push({ texto: dentro, negrita: true });
    resto = resto.slice(cierra + 2);
  }
  // Une los vecinos del mismo tipo ("a" + "b" sueltos → "ab").
  return tramos.reduce<Tramo[]>((acc, t) => {
    const ultimo = acc[acc.length - 1];
    if (ultimo && ultimo.negrita === t.negrita) ultimo.texto += t.texto;
    else acc.push({ ...t });
    return acc;
  }, []);
}

const VINETA = /^\s*[-•*]\s+/;

export function parsearNovedad(cuerpo: string): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  let lista: string[] = [];

  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: "parrafo", tramos: tramosDe(parrafo.join(" ")) });
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista.length > 0) bloques.push({ tipo: "lista", items: lista.map(tramosDe) });
    lista = [];
  };

  for (const cruda of cuerpo.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.trim();
    if (linea === "") {
      cerrarParrafo();
      cerrarLista();
    } else if (VINETA.test(cruda)) {
      cerrarParrafo();
      lista.push(cruda.replace(VINETA, "").trim());
    } else {
      cerrarLista();
      parrafo.push(linea);
    }
  }
  cerrarParrafo();
  cerrarLista();
  return bloques;
}

/** Los íconos que puede llevar una novedad (el CHECK de la tabla dice lo mismo). */
export const ICONOS_NOVEDAD = ["sparkles", "rocket", "wrench", "megaphone", "gift"] as const;
export type IconoNovedad = (typeof ICONOS_NOVEDAD)[number];

export const NOMBRE_ICONO_NOVEDAD: Record<IconoNovedad, string> = {
  sparkles: "Novedad",
  rocket: "Lanzamiento",
  wrench: "Mejora",
  megaphone: "Aviso",
  gift: "Regalo",
};

export function esIconoNovedad(x: unknown): x is IconoNovedad {
  return typeof x === "string" && (ICONOS_NOVEDAD as readonly string[]).includes(x);
}
