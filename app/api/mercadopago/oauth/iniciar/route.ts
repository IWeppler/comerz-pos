import { NextResponse, type NextRequest } from "next/server";
import { contextoCobros } from "@/features/cobros-online/lib/contexto-cobros";
import { crearClienteOAuthMp, leerConfigAppMp } from "@/features/cobros-online/lib/cliente-oauth-mp";
import { crearRepoConexionSupabase } from "@/features/cobros-online/lib/repo-conexion-supabase";
import { iniciarConexion } from "@/features/cobros-online/lib/conexion-mercadopago";
import type { CodigoResultadoOAuth } from "@/features/cobros-online/lib/mensajes-oauth";

/**
 * "Conectar Mercado Pago": el botón de Cobros es un link a esta ruta.
 *
 * Verifica ADMIN + módulo prendido (contra la base), guarda un `state` atado al
 * negocio y al usuario, y redirige a la pantalla de autorización de MP. Es un
 * GET para que el botón sea un link común y la conexión entre en dos o tres
 * toques desde el celular. Hacerla desde otro sitio no sirve de nada: termina
 * en la autorización de MP de la propia cuenta de quien la abre.
 */

const volverACobros = (request: NextRequest, codigo: CodigoResultadoOAuth) =>
  NextResponse.redirect(new URL(`/configuracion?seccion=cobrosOnline&mp=${codigo}`, request.url));

export async function GET(request: NextRequest) {
  const ctx = await contextoCobros();
  if (!ctx.ok) {
    if (ctx.error === "sin_sesion") return NextResponse.redirect(new URL("/ingresar", request.url));
    return volverACobros(request, ctx.error === "modulo_apagado" ? "modulo_apagado" : "sin_permiso");
  }

  const config = leerConfigAppMp();
  if (!config) return volverACobros(request, "sin_configurar");

  try {
    const url = await iniciarConexion(
      { repo: crearRepoConexionSupabase(), mp: crearClienteOAuthMp(config) },
      {
        negocioId: ctx.negocioId,
        usuarioId: ctx.usuarioId,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
      },
    );
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[MP OAUTH] iniciar", (e as Error).message);
    return volverACobros(request, "error");
  }
}
