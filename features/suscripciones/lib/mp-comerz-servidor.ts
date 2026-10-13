import "server-only";

/**
 * Mercado Pago con la cuenta de COMERZ (la dueña de la app), para cobrarle a
 * los comercios. No es el OAuth de los comercios (`features/cobros-online`):
 * otra cuenta, otro token (`MP_COMERZ_ACCESS_TOKEN`), nunca se mezclan.
 *
 * Sin la env var no hay débito automático: las funciones devuelven null y la
 * UI dice que no está disponible. Nada de esto loguea el token.
 */

const API_MP = "https://api.mercadopago.com";

export function tokenComerz(): string | null {
  return process.env.MP_COMERZ_ACCESS_TOKEN || null;
}

export async function mpComerz(
  ruta: string,
  init?: RequestInit & { idempotencia?: string },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null } | null> {
  const token = tokenComerz();
  if (!token) return null;
  const { idempotencia, ...resto } = init ?? {};
  try {
    const respuesta = await fetch(`${API_MP}${ruta}`, {
      ...resto,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {}),
        ...(resto.headers ?? {}),
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: respuesta.ok, status: respuesta.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}
