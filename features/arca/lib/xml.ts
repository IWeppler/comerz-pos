/**
 * Lo mínimo de XML que hace falta para hablar con los web services de ARCA.
 *
 * Sin librería SOAP a propósito: los dos servicios que se usan (WSAA y
 * WSFEv1) tienen un puñado de operaciones con XML chato y predecible, y una
 * librería de SOAP arrastra un parser entero, un cliente HTTP propio y un
 * modelo de WSDL que acá no aporta nada. Node no trae DOMParser en el
 * server, así que la lectura es por etiquetas.
 */

export function escaparXml(valor: string | number): string {
  return String(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function desescaparXml(valor: string): string {
  return valor
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * Primer `<tag>…</tag>` del texto, sin importar el prefijo de namespace
 * (`<ns:tag>` matchea igual). Devuelve el contenido desescapado, o null.
 */
export function leerEtiqueta(xml: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`,
  );
  const m = re.exec(xml);
  if (!m) return null;
  // CDATA: el contenido viene tal cual, sin escapar.
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata ? cdata[1] : desescaparXml(m[1]).trim();
}

/** Todos los bloques `<tag>…</tag>`, en orden. Para listas (Errors, Obs). */
export function leerEtiquetas(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`,
    "g",
  );
  const bloques: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) bloques.push(m[1]);
  return bloques;
}

/** Envoltorio SOAP 1.2, que es el que aceptan los dos servicios. */
export function sobreSoap(cuerpo: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>${cuerpo}</soap12:Body></soap12:Envelope>`
  );
}
