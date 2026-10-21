import type { createClient } from "@/shared/config/supabase/server";

type Supabase = ReturnType<typeof createClient>;

/**
 * Pendiente ACTUAL de cada venta, desde la cuenta corriente.
 *
 * Solo consulta a los clientes que tienen ventas con algo congelado como
 * pendiente: si una venta se cerró sin fiado, no tiene débitos y su pendiente
 * es 0. Así no se consulta a todo el padrón en cada carga.
 *
 * Devuelve `null` para una venta cuyo cliente no respondió. Quien lo use decide
 * (la exportación lo trata como error; la pantalla, como fallback).
 */
export async function pendientesActualesDeVentas(
  supabase: Supabase,
  ventas: readonly { id: string; cliente_id?: string | null; monto_pendiente?: number | string | null }[],
): Promise<Map<string, number | null>> {
  const resultado = new Map<string, number | null>();

  const candidatas = ventas.filter(
    (v) => v.cliente_id && Number(v.monto_pendiente ?? 0) > 0,
  );
  for (const v of ventas) resultado.set(v.id, 0);
  if (candidatas.length === 0) return resultado;

  // Una sola llamada para todas las ventas candidatas (migración 20261021130000).
  const { data, error } = await supabase.rpc("pendientes_ventas_cc", {
    p_venta_ids: candidatas.map((v) => v.id),
  });
  if (error) {
    console.error("[PENDIENTE VENTA] pendientes_ventas_cc:", error.message);
    for (const v of candidatas) resultado.set(v.id, null);
    return resultado;
  }
  const porVenta = new Map(
    ((data ?? []) as { venta_id: string; pendiente: number | string }[]).map((f) => [
      f.venta_id,
      Math.max(0, Number(f.pendiente) || 0),
    ]),
  );
  for (const v of candidatas) {
    // Una venta candidata que la función no devolvió no es visible para quien
    // consulta: no se asume un cero, queda desconocida.
    resultado.set(v.id, porVenta.has(v.id) ? (porVenta.get(v.id) ?? 0) : null);
  }
  return resultado;
}
