/**
 * Cómo se le entrega un archivo generado en el navegador (el PDF del
 * comprobante) a la persona que lo pidió.
 *
 * Hay dos caminos y el dispositivo decide cuál:
 *
 * - COMPARTIR (hoja nativa, Web Share API con archivos): en el celular. Es lo
 *   que la vendedora quiere hacer con un comprobante desde el teléfono:
 *   mandárselo a la clienta por WhatsApp.
 * - DESCARGAR (`<a download>` con un blob): en la PC. Ahí el comprobante se
 *   baja para imprimirlo o archivarlo, y abrir la hoja de compartir de Windows
 *   sería un paso de más.
 *
 * POR QUÉ existe (15/9/2026, Estilo Bonito): en iOS el `<a download>` de un
 * blob no descarga nada. Safari abre el PDF en una pestaña cuya dirección es
 * `blob:https://app.comerz.app/e84645a5-…`, y cuando Romina lo compartía desde
 * ahí, WhatsApp mandaba ESA dirección, no el archivo. Un `blob:` vive solo en
 * la pestaña que lo creó, así que a la clienta le llegaba un link a la nada
 * ("404"). Con la hoja nativa viaja el PDF de verdad.
 *
 * La decisión celular/PC va por puntero y no por user-agent: un iPad con
 * teclado sigue siendo un dispositivo donde se comparte, y el criterio es el
 * mismo de `puedeCompartirNativo` (capability, no UA). Se exige `pointer:
 * coarse` ADEMÁS de `canShare`, porque Chrome en Windows también sabe
 * compartir archivos y ahí no es lo que se quiere.
 */
export type ModoEntrega = "compartir" | "descargar";

export type EntornoEntrega = {
  /** `navigator.canShare({ files })` dijo que sí para este archivo. */
  puedeCompartirArchivo: boolean;
  /** `(pointer: coarse)`: el puntero principal es un dedo. */
  punteroGrueso: boolean;
};

export function decidirModoEntrega(entorno: EntornoEntrega): ModoEntrega {
  return entorno.puedeCompartirArchivo && entorno.punteroGrueso
    ? "compartir"
    : "descargar";
}

export function leerEntornoEntrega(file: File): EntornoEntrega {
  const puedeCompartirArchivo =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });
  const punteroGrueso =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return { puedeCompartirArchivo, punteroGrueso };
}

/**
 * Descarga clásica. El `revokeObjectURL` va DIFERIDO: revocarlo en el mismo
 * tick que el click es una carrera que en Safari se pierde —el navegador
 * todavía no leyó el blob cuando la URL ya no existe—.
 */
export function descargarArchivo(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Entrega el archivo por el camino que corresponda. Devuelve `false` solo si
 * no se pudo entregar por ningún camino.
 *
 * Si la persona cierra la hoja nativa sin elegir nada (AbortError) NO se cae
 * a la descarga: cancelar es una decisión, y encima en iOS la descarga es
 * justo la pestaña con el `blob:` que se quiere evitar. Cualquier otro error
 * del share (por ejemplo NotAllowedError, si el PDF tardó tanto en generarse
 * que el gesto del click ya no vale) sí cae a la descarga.
 */
export async function entregarArchivo(
  file: File,
  titulo: string,
): Promise<boolean> {
  const modo = decidirModoEntrega(leerEntornoEntrega(file));

  if (modo === "compartir") {
    try {
      await navigator.share({ files: [file], title: titulo });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return true;
      console.warn("[COMPROBANTE] Share nativo falló, cae a descarga", error);
    }
  }

  try {
    descargarArchivo(file);
    return true;
  } catch (error) {
    console.error("[COMPROBANTE] No se pudo descargar el archivo", error);
    return false;
  }
}
