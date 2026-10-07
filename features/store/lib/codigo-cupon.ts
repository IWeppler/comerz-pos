/** Espejo del CHECK SQL: sin espacios, 4–20 letras ASCII o números. */
export function normalizarCodigoCupon(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.trim() === "") return null;
  return valor.replace(/\s/g, "").toUpperCase();
}

export function codigoCuponValido(codigo: string | null): boolean {
  return codigo === null || /^[A-Z0-9]{4,20}$/.test(codigo);
}
