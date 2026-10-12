import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { crearClienteOAuthMp, leerConfigAppMp } from "@/features/cobros-online/lib/cliente-oauth-mp";
import { crearRepoConexionSupabase } from "@/features/cobros-online/lib/repo-conexion-supabase";
import { completarCallback } from "@/features/cobros-online/lib/conexion-mercadopago";
import type { CodigoResultadoOAuth } from "@/features/cobros-online/lib/mensajes-oauth";

/**
 * Vuelta de Mercado Pago después de autorizar (o cancelar).
 *
 * Registrada en la app de MP como redirect URI:
 * https://app.comerz.app/api/mercadopago/oauth/callback
 *
 * Toda la lógica está en `completarCallback` (probada sin red): consume el
 * state una sola vez, exige que vuelva el mismo usuario que empezó, canjea el
 * código con el verifier de PKCE y guarda los tokens cifrados. El negocio sale
 * de la fila del state, nunca de la URL.
 *
 * Siempre termina en Cobros con un código cerrado (`?mp=conectado`, etc.): ni
 * el error de MP ni nada de la query se muestra crudo.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const volver = (codigo: CodigoResultadoOAuth) =>
    NextResponse.redirect(
      new URL(`/configuracion?seccion=cobrosOnline&mp=${codigo}`, request.url),
    );

  const config = leerConfigAppMp();
  if (!config) return volver("sin_configurar");

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const r = await completarCallback(
      { repo: crearRepoConexionSupabase(), mp: crearClienteOAuthMp(config) },
      {
        code: params.get("code"),
        state: params.get("state"),
        error: params.get("error"),
        usuarioSesionId: user?.id ?? null,
      },
    );
    if (r.resultado === "conectado") {
      console.info("[MP OAUTH] conectado", { negocio: r.negocioId, mpUser: r.mpUserId });
    }
    return volver(r.resultado);
  } catch (e) {
    console.error("[MP OAUTH] callback", (e as Error).message);
    return volver("error");
  }
}
