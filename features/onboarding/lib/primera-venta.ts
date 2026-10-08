interface Almacen {
  getItem: (clave: string) => string | null;
  setItem: (clave: string, valor: string) => void;
}
const enCurso = new Map<string, Promise<boolean>>();
const resuelto = new Set<string>();
/** Cero consultas en las ventas siguientes, incluso si storage está bloqueado. */
export function detectarPrimeraVenta(
  negocioId: string,
  almacen: Almacen | null,
  contar: () => Promise<number | null>,
): Promise<boolean> {
  const clave = `comerz:primera-venta-festejada:${negocioId}`;
  try {
    if (almacen?.getItem(clave)) return Promise.resolve(false);
  } catch {}
  const pendiente = enCurso.get(negocioId);
  if (pendiente) return pendiente;
  if (resuelto.has(negocioId)) return Promise.resolve(false);
  const promesa = (async () => {
    try {
      const cantidad = await contar();
      // Error de lectura: no inventar una primera venta ni marcar el resultado.
      if (cantidad === null) return false;
      resuelto.add(negocioId);
      try {
        almacen?.setItem(clave, "1");
      } catch {}
      return cantidad === 1;
    } catch {
      return false;
    } finally {
      enCurso.delete(negocioId);
    }
  })();
  enCurso.set(negocioId, promesa);
  return promesa;
}
