import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { crearCifrador } from "@/shared/lib/cifrado";
import type { FilaConexion, RepoConexion } from "./conexion-mercadopago";

/**
 * `RepoConexion` sobre la base real.
 *
 * `mercadopago_conexiones` y `mercadopago_oauth_estados` no tienen policies:
 * solo el cliente service_role las toca, y este módulo es la ÚNICA puerta (mismo
 * criterio que `arca_credenciales`). Quien llama ya resolvió el negocio desde
 * la sesión o desde el state; acá nunca entra un id que haya elegido el
 * navegador.
 *
 * Tokens y code_verifier se guardan cifrados con `MP_CLAVE_CIFRADO`, propia de
 * Mercado Pago (no la de ARCA). Nada de esto se loguea.
 */

export const cifradorMp = crearCifrador("MP_CLAVE_CIFRADO", "credenciales de Mercado Pago");

interface FilaDb {
  negocio_id: string;
  mp_user_id: string;
  access_token_cifrado: string;
  refresh_token_cifrado: string;
  expira_en: string;
  estado: FilaConexion["estado"];
}

const desdeDb = (fila: FilaDb): FilaConexion => ({
  negocioId: fila.negocio_id,
  mpUserId: fila.mp_user_id,
  accessToken: cifradorMp.descifrar(fila.access_token_cifrado),
  refreshToken: cifradorMp.descifrar(fila.refresh_token_cifrado),
  expiraEn: new Date(fila.expira_en),
  estado: fila.estado,
});

export function crearRepoConexionSupabase(): RepoConexion {
  const db = createAdminClient();

  return {
    async crearEstado({ stateHash, negocioId, usuarioId, codeVerifier, expiraEn }) {
      const { error } = await db.from("mercadopago_oauth_estados").insert({
        state_hash: stateHash,
        negocio_id: negocioId,
        usuario_id: usuarioId,
        code_verifier_cifrado: cifradorMp.cifrar(codeVerifier),
        expira_en: expiraEn.toISOString(),
      });
      if (error) throw new Error(`[MP OAUTH] no se pudo guardar el state: ${error.code}`);
    },

    async consumirEstado(stateHash) {
      // UPDATE condicional: el que marca `usado_en` es el único que sigue.
      const { data, error } = await db
        .from("mercadopago_oauth_estados")
        .update({ usado_en: new Date().toISOString() })
        .eq("state_hash", stateHash)
        .is("usado_en", null)
        .gt("expira_en", new Date().toISOString())
        .select("negocio_id, usuario_id, code_verifier_cifrado");
      if (error) throw new Error(`[MP OAUTH] no se pudo consumir el state: ${error.code}`);
      const fila = data?.[0];
      if (!fila) return null;
      return {
        negocioId: fila.negocio_id,
        usuarioId: fila.usuario_id,
        codeVerifier: cifradorMp.descifrar(fila.code_verifier_cifrado),
      };
    },

    async guardarConexion(negocioId, usuarioId, tokens) {
      const ahora = new Date().toISOString();
      const { data, error } = await db
        .from("mercadopago_conexiones")
        .upsert(
          {
            negocio_id: negocioId,
            mp_user_id: tokens.mpUserId,
            access_token_cifrado: cifradorMp.cifrar(tokens.accessToken),
            refresh_token_cifrado: cifradorMp.cifrar(tokens.refreshToken),
            expira_en: tokens.expiraEn.toISOString(),
            estado: "ACTIVA",
            ultimo_error: null,
            conectado_en: ahora,
            conectado_por: usuarioId,
            renovado_en: null,
            actualizado_en: ahora,
          },
          { onConflict: "negocio_id" },
        )
        .select("negocio_id");
      if (error || !data?.length) {
        throw new Error(`[MP OAUTH] no se pudo guardar la conexión: ${error?.code ?? "0 filas"}`);
      }
    },

    async leerConexion(negocioId) {
      const { data, error } = await db
        .from("mercadopago_conexiones")
        .select("negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en, estado")
        .eq("negocio_id", negocioId)
        .maybeSingle();
      if (error) throw new Error(`[MP OAUTH] no se pudo leer la conexión: ${error.code}`);
      return data ? desdeDb(data as FilaDb) : null;
    },

    async reemplazarTokens(negocioId, refreshTokenUsado, tokens) {
      // El refresh está cifrado con IV aleatorio: no se puede comparar en SQL.
      // Se lee, se compara en claro y se escribe condicionado al CIFRADO leído,
      // que identifica esa versión de la fila de forma exacta.
      const { data: actual, error: errLectura } = await db
        .from("mercadopago_conexiones")
        .select("refresh_token_cifrado")
        .eq("negocio_id", negocioId)
        .maybeSingle();
      if (errLectura) throw new Error(`[MP OAUTH] no se pudo leer la conexión: ${errLectura.code}`);
      if (!actual || cifradorMp.descifrar(actual.refresh_token_cifrado) !== refreshTokenUsado) {
        return false;
      }
      const ahora = new Date().toISOString();
      const { data, error } = await db
        .from("mercadopago_conexiones")
        .update({
          access_token_cifrado: cifradorMp.cifrar(tokens.accessToken),
          refresh_token_cifrado: cifradorMp.cifrar(tokens.refreshToken),
          expira_en: tokens.expiraEn.toISOString(),
          estado: "ACTIVA",
          ultimo_error: null,
          renovado_en: ahora,
          actualizado_en: ahora,
        })
        .eq("negocio_id", negocioId)
        .eq("refresh_token_cifrado", actual.refresh_token_cifrado)
        .select("negocio_id");
      if (error) throw new Error(`[MP OAUTH] no se pudo renovar la conexión: ${error.code}`);
      return (data?.length ?? 0) > 0;
    },

    async marcarRequiereReconexion(negocioId, motivo) {
      const { error } = await db
        .from("mercadopago_conexiones")
        .update({
          estado: "REQUIERE_RECONEXION",
          ultimo_error: motivo.slice(0, 500),
          actualizado_en: new Date().toISOString(),
        })
        .eq("negocio_id", negocioId);
      if (error) throw new Error(`[MP OAUTH] no se pudo marcar la conexión: ${error.code}`);
    },
  };
}

/** Lo que el panel puede ver de la conexión. Sin tokens. */
export interface EstadoConexionMp {
  conectado: boolean;
  estado: FilaConexion["estado"] | null;
  mpUserId: string | null;
  conectadoEn: string | null;
  ultimoError: string | null;
}

export async function leerEstadoConexionMp(negocioId: string): Promise<EstadoConexionMp> {
  const { data, error } = await createAdminClient()
    .from("mercadopago_conexiones")
    .select("estado, mp_user_id, conectado_en, ultimo_error")
    .eq("negocio_id", negocioId)
    .maybeSingle();
  if (error) throw new Error(`[MP OAUTH] no se pudo leer el estado: ${error.code}`);
  return {
    conectado: data?.estado === "ACTIVA",
    estado: (data?.estado as FilaConexion["estado"] | undefined) ?? null,
    mpUserId: data?.mp_user_id ?? null,
    conectadoEn: data?.conectado_en ?? null,
    ultimoError: data?.ultimo_error ?? null,
  };
}

export async function borrarConexionMp(negocioId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("mercadopago_conexiones")
    .delete()
    .eq("negocio_id", negocioId);
  if (error) throw new Error(`[MP OAUTH] no se pudo desconectar: ${error.code}`);
}
