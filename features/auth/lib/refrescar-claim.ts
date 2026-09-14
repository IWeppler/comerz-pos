import "server-only";
import type { createClient } from "@/shared/config/supabase/server";

/**
 * Vuelve a emitir el token para que traiga las membresías nuevas.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA. El middleware no lee las membresías de la base: las lee
 * del claim `comerz`, que el custom access token hook (`20260903110000`)
 * calculó AL EMITIR EL TOKEN. Si las membresías cambian después, el token
 * sigue diciendo lo de antes hasta que se refresque — hasta una hora.
 *
 * Y cambian en exactamente dos momentos, que son los dos que llaman a esto:
 * cuando alguien crea su primer negocio y cuando un invitado acepta. En el
 * alta el token se emitió en el `signUp`, cuando la persona todavía no tenía
 * ninguno.
 *
 * Sin esto, `/` veía un claim sin negocios y mandaba al selector; el selector
 * consultaba la base, veía uno solo y devolvía a `/`. Loop, medido el 9/9/2026
 * en el alta de `ignacionweppler+5`: cuatro pasadas por el gate del middleware
 * en dos segundos.
 *
 * El middleware tiene su propia red para esto —consulta la base cuando el
 * conteo desmiente al claim— pero eso es un viaje extra en cada request hasta
 * que el token se renueve solo. Esto lo evita: UNA llamada, en el único
 * momento en que se sabe con certeza que el claim quedó viejo.
 *
 * NO PUEDE VOLTEAR LA OPERACIÓN. Cuando corre, el negocio ya está creado o la
 * invitación ya está aceptada: un fallo del refresh se loguea y sigue, porque
 * la red del middleware cubre el caso.
 * ──────────────────────────────────────────────────────────────────────────
 */
export async function refrescarClaimDeMembresias(
  supabase: ReturnType<typeof createClient>,
  contexto: string,
): Promise<void> {
  const { error } = await supabase.auth.refreshSession();
  if (error) {
    console.error(`[CLAIMS] refresh tras ${contexto} falló:`, error.message);
  }
}
