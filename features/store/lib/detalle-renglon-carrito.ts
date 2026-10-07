import type { CartItemStore } from "@/entities/cart/types";

/**
 * La variante elegida, como se lee en el carrito público: "Talle 40 · Color
 * Negro". Con los atributos guardados en la línea dice qué es cada valor; sin
 * ellos (carrito guardado antes, producto sin atributos) cae al texto de la
 * variante ("Negro / 40"). Una variante única no tiene nada que decir: null.
 */
export function detalleVarianteCarrito(
  item: Pick<CartItemStore, "variante" | "atributosVariante" | "ventaLibre">,
): string | null {
  if (item.ventaLibre) return null;
  const atributos = Object.entries(item.atributosVariante ?? {}).filter(
    ([clave, valor]) => clave.trim() && String(valor ?? "").trim(),
  );
  if (atributos.length > 0) {
    return atributos.map(([clave, valor]) => `${clave} ${String(valor).trim()}`).join(" · ");
  }
  const variante = item.variante?.trim();
  if (!variante || /^(unico|único)$/i.test(variante)) return null;
  return variante;
}

/**
 * La categoría de la línea. `tipo` guarda el nombre de la categoría como texto
 * y a veces es una lista ("CAMISETAS,BUZOS,CAMPERAS"): se muestra con espacios
 * después de cada coma para que se pueda leer y cortar.
 */
export function categoriaCarrito(item: Pick<CartItemStore, "tipo">): string | null {
  const tipo = item.tipo?.trim();
  if (!tipo || /^(general|categoria desconocida)$/i.test(tipo)) return null;
  return tipo.split(",").map((parte) => parte.trim()).filter(Boolean).join(", ");
}
