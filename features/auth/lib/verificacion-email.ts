/**
 * Cuánto margen tiene una cuenta para verificar su correo.
 *
 * La verificación dejó de ser una puerta y pasó a ser una deuda: el alta entra
 * derecho al sistema y el mail se manda igual, pero no frena nada. El motivo
 * es medible — el paso de "andá a tu casilla y volvé" es donde se caen las
 * altas, porque obliga a cambiar de app en el único momento en que la persona
 * todavía no vio nada del producto.
 *
 * Lo que reemplaza a la puerta es este plazo: se avisa desde el primer día y a
 * los 7 se vuelve urgente. El plazo existe porque un mail sin verificar no es
 * gratis — es la única forma de recuperar la contraseña, y también lo que
 * evita que alguien se registre con el mail de otro.
 *
 * Módulo puro: recibe las fechas resueltas y se testea sin reloj ni sesión.
 */

export const DIAS_PARA_VERIFICAR = 7;

/**
 * Marca propia en `app_metadata` (solo la escribe service_role): cuándo la
 * persona abrió un link que le llegó al correo. La escribe `/auth/callback` o
 * `/auth/confirm` según el método con que se abrió la sesión.
 */
export const MARCA_MAIL_VERIFICADO = "email_verificado_en";

/**
 * Métodos de sesión (claim `amr` del token) que solo se pueden completar
 * abriendo un link o un código que llegó a la casilla. `password` y `oauth` no
 * prueban nada del correo de ESTA cuenta.
 */
const METODOS_QUE_PRUEBAN_EL_MAIL = new Set([
  "otp",
  "magiclink",
  "recovery",
  "invite",
  "signup",
  "email/signup",
  "email_change",
]);

export function metodoPruebaElMail(metodos: readonly string[]): boolean {
  return metodos.some((m) => METODOS_QUE_PRUEBAN_EL_MAIL.has(m));
}

interface UsuarioParaVerificar {
  identities?: { provider: string; identity_data?: Record<string, unknown> | null }[] | null;
  app_metadata?: Record<string, unknown> | null;
}

/**
 * ¿El correo de esta cuenta está probado?
 *
 * NO es `email_confirmed_at`: con "Confirm email" apagado (desde el 9/9/2026)
 * Supabase lo llena en el mismo alta, y el banner que lo miraba no aparecía
 * nunca (auditoría del 22/10/2026). Cuenta como probado cualquiera de:
 *  - nuestra marca, que se escribe al abrir un link del correo;
 *  - `email_verified` de la identidad `email` (las altas de cuando la
 *    confirmación estaba prendida y los invitados lo tienen en true);
 *  - una identidad de Google: Google ya verificó ese correo.
 */
export function mailVerificado(usuario: UsuarioParaVerificar): boolean {
  if (usuario.app_metadata?.[MARCA_MAIL_VERIFICADO]) return true;
  return (usuario.identities ?? []).some((i) => {
    if (i.provider === "google") return true;
    const v = i.identity_data?.email_verified;
    return i.provider === "email" && (v === true || v === "true");
  });
}

export type EstadoVerificacion =
  /** Ya verificó: no se muestra nada. */
  | { estado: "verificado" }
  /** Todavía tiene plazo. Aviso suave, con los días que le quedan. */
  | { estado: "pendiente"; diasRestantes: number }
  /** Se le pasaron los 7 días. El aviso pasa a ser urgente. */
  | { estado: "vencido"; diasVencido: number };

const DIA_MS = 86_400_000;

export function estadoVerificacionEmail({
  emailConfirmado,
  creadoEn,
  ahora = new Date(),
}: {
  emailConfirmado: boolean;
  /** Alta de la cuenta (`auth.users.created_at`). */
  creadoEn: string | Date | null | undefined;
  ahora?: Date;
}): EstadoVerificacion {
  if (emailConfirmado) return { estado: "verificado" };

  // Sin fecha de alta no se puede contar el plazo. Se trata como recién
  // creada —aviso suave con el plazo completo— y no como vencida: apurar a
  // alguien por un dato que falta de nuestro lado es peor que avisar de más.
  if (!creadoEn) {
    return { estado: "pendiente", diasRestantes: DIAS_PARA_VERIFICAR };
  }

  const alta = new Date(creadoEn).getTime();
  if (Number.isNaN(alta)) {
    return { estado: "pendiente", diasRestantes: DIAS_PARA_VERIFICAR };
  }

  const diasTranscurridos = Math.floor((ahora.getTime() - alta) / DIA_MS);
  const restantes = DIAS_PARA_VERIFICAR - diasTranscurridos;

  if (restantes > 0) return { estado: "pendiente", diasRestantes: restantes };

  return { estado: "vencido", diasVencido: Math.abs(restantes) };
}

/**
 * Segundos que hay que esperar entre dos envíos del mail de verificación.
 *
 * No es una regla nuestra: el SMTP por defecto de Supabase tiene un límite de
 * mensajes por hora bajísimo, y gastarlo con dos clicks seguidos deja a la
 * persona sin poder verificar durante una hora — exactamente lo contrario de
 * lo que busca el botón. El botón se apaga solo durante este rato.
 */
export const SEGUNDOS_ENTRE_ENVIOS = 60;
