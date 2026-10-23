/**
 * ¿Hay que anular la contraseña que traía la cuenta en la que acaba de entrar
 * alguien con Google?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AGUJERO (auditoría de seguridad del 22/10/2026, ver `auth-google.ts`).
 *
 * "Confirm email" está apagado desde el 9/9/2026: cualquiera puede registrar
 * con contraseña un mail que no es suyo, y Supabase le pone
 * `email_confirmed_at` en el acto. Cuando el dueño real del mail entra con
 * Google, Supabase VINCULA la identidad nueva a esa cuenta (el mail coincide y
 * Google lo da por verificado). El dueño queda adentro de una cuenta cuya
 * contraseña la eligió otro, y ese otro sigue entrando.
 *
 * LA SALIDA, sin volver a poner el mail en el camino del alta: en el login que
 * vincula Google, si el mail de la cuenta nunca se probó por link, la
 * contraseña previa no vale nada — se reemplaza por una aleatoria y se cierran
 * las otras sesiones. El dueño sigue con Google y, si quiere clave, la
 * recupera por mail (eso SÍ prueba el mail).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA SEÑAL. `email_confirmed_at` no sirve: con la confirmación apagada se llena
 * en el alta. La que sirve es `identity_data.email_verified` de la identidad
 * `email`: queda en false hasta que la persona abre un link de Supabase (el de
 * verificación del banner es un magic link). Medido el 22/10/2026: de 17 altas
 * propias con mail posteriores al 9/9 (sin contar invitados), 6 la tienen en
 * true.
 *
 * SOLO EN EL LOGIN QUE VINCULA (identidad de Google de hace minutos). Las
 * cuentas ya vinculadas antes de esto se revisaron a mano el 22/10 (son dos,
 * las dos legítimas): anular su clave en cada login con Google no protegería
 * nada y le sacaría la contraseña a gente que la usa.
 *
 * Módulo puro: recibe el usuario resuelto y la hora, y se testea sin red.
 */

/** Cuánto puede tener la identidad de Google para contar como "recién vinculada". */
export const MINUTOS_VINCULO_RECIENTE = 10;

/** Marca en `app_metadata` (solo la escribe service_role): fecha de la anulación. */
export const MARCA_CREDENCIAL_ANULADA = "credencial_previa_anulada_en";

interface IdentidadMinima {
  provider: string;
  created_at?: string | null;
  identity_data?: Record<string, unknown> | null;
}

export interface UsuarioMinimo {
  identities?: IdentidadMinima[] | null;
  app_metadata?: Record<string, unknown> | null;
}

/** `email_verified` llega como booleano o como texto según de dónde salió. */
function verificado(valor: unknown): boolean {
  return valor === true || valor === "true";
}

export function debeAnularCredencialPrevia(
  usuario: UsuarioMinimo,
  ahora: Date = new Date(),
): boolean {
  const identidades = usuario.identities ?? [];

  const mail = identidades.find((i) => i.provider === "email");
  // Sin identidad de mail no hay contraseña de nadie que anular.
  if (!mail) return false;
  if (verificado(mail.identity_data?.email_verified)) return false;

  if (usuario.app_metadata?.[MARCA_CREDENCIAL_ANULADA]) return false;

  const google = identidades.find((i) => i.provider === "google");
  if (!google?.created_at) return false;

  const vinculada = new Date(google.created_at).getTime();
  if (Number.isNaN(vinculada)) return false;

  const minutos = (ahora.getTime() - vinculada) / 60_000;
  // Un reloj apenas adelantado del lado de Auth da un valor negativo chico:
  // sigue siendo "recién vinculada".
  return minutos <= MINUTOS_VINCULO_RECIENTE;
}
