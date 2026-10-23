import type { EtapaAlta } from "./embudo-alta";

/**
 * Qué mail le corresponde a cada etapa del embudo de alta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MAIL POR ETAPA Y NO UNO SOLO
 *
 * Las dos personas que motivaron esto quedaron en lugares distintos y
 * necesitan cosas opuestas:
 *
 *   - `maxi_l93@hotmail.com` (29/8/2026): creó la cuenta, NUNCA confirmó el
 *     mail y NUNCA entró. Decirle "te falta configurar tu negocio" es hablarle
 *     de un paso que está tres escalones más adelante del suyo.
 *   - `daitri94gallardo@gmail.com` (9/9/2026): confirmó a los 30 segundos, se
 *     le emitió sesión 2 segundos después y no volvió. Ahí sí el paso que
 *     falta es crear el negocio.
 *
 * Un mail único le erra a los dos. Por eso la campaña sale de `etapa`, que ya
 * la calcula `embudo-alta.ts`, y no de una lista escrita a mano.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO ES CONTENIDO, NO ENVÍO
 *
 * Módulo puro y sin IO: recibe la etapa y los datos, devuelve asunto + texto +
 * HTML. Así la copia entera se testea sin proveedor y sin base — mismo
 * criterio que `determinar-comprobante.ts`.
 *
 * `CREO_NEGOCIO` no tiene campaña y devuelve `null`: llegó al final del
 * embudo. Escribirle "te falta un paso" a alguien que ya está adentro es la
 * forma más rápida de que marque el mail como spam.
 */

/** Cómo contactar a un humano. Va en el pie de todas las campañas. */
export const TELEFONO_COMERZ = "+54 1154702118";
export const FIRMA_COMERZ = "Equipo Comerz";
export const SITIO_COMERZ = "comerz.app";

export interface Campana {
  /** Clave estable. Se guarda en `envios_email.campana` y es la unidad de
   *  idempotencia: cambiar este string vuelve a habilitar el envío a todos. */
  clave: string;
  asunto: string;
  /** Párrafos antes del botón. */
  intro: string[];
  cta: { texto: string; ruta: string };
  /** Bullets después del botón. Vacío = no se dibuja la lista. */
  beneficios: string[];
  /** Párrafos después de los bullets, antes de la firma. */
  cierre: string[];
}

const BENEFICIOS_BASE = [
  "Registrar tus ventas y ver tu caja al día",
  "Controlar el stock sin planillas",
  "Llevar las cuentas corrientes de tus clientes y saber quién te debe",
  "Compartir tu catálogo por WhatsApp con un link",
];

const PRUEBA_Y_AYUDA = [
  "Tenés 14 días de prueba gratis. No pedimos tarjeta.",
  `¿Necesitás ayuda para arrancar? Respondé este mail o contactate con nosotros al ${TELEFONO_COMERZ} y te acompañamos en la configuración.`,
];

/**
 * La campaña de cada etapa. `null` = a esa etapa no se le escribe.
 *
 * Ojo con las rutas: son relativas y se resuelven contra la URL base del
 * envío. Con una absoluta acá, probar en local mandaría a producción.
 */
export const CAMPANAS: Record<EtapaAlta, Campana | null> = {
  /**
   * Creó la cuenta y no confirmó el mail. Puede que ni lo haya visto: el mail
   * de confirmación pudo caer en spam, y a esta altura pedirle que busque uno
   * viejo es pedirle trabajo. El CTA lo manda a entrar, que es lo que destraba
   * todo lo demás.
   */
  REGISTRADO: {
    clave: "alta_sin_confirmar",
    asunto: "Tu cuenta de Comerz quedó a mitad de camino",
    intro: [
      "Creaste tu cuenta en Comerz y todavía no entraste. Si el mail de confirmación no te llegó o se te traspapeló, no hace falta buscarlo: entrá directo desde acá.",
    ],
    cta: { texto: "Entrar a Comerz", ruta: "/auth" },
    beneficios: BENEFICIOS_BASE,
    cierre: PRUEBA_Y_AYUDA,
  },

  /**
   * Confirmó el mail pero nunca se le emitió una sesión. Es raro y por eso el
   * texto no inventa una explicación: le ofrece la puerta y un teléfono.
   */
  CONFIRMADO: {
    clave: "confirmado_sin_entrar",
    asunto: "Ya confirmaste tu mail, ahora entrá a Comerz",
    intro: [
      "Confirmaste tu correo pero todavía no iniciaste sesión. Es un solo paso y quedás adentro.",
    ],
    cta: { texto: "Entrar a Comerz", ruta: "/auth" },
    beneficios: BENEFICIOS_BASE,
    cierre: PRUEBA_Y_AYUDA,
  },

  /**
   * El caso de daitri: abrió el link del mail y no volvió. Es el texto que
   * escribió Ignacio, palabra por palabra — la copia la valida quien vende, no
   * quien programa.
   */
  SESION: {
    clave: "sin_negocio_creado",
    asunto: "Te falta un paso para empezar a usar Comerz",
    intro: [
      "Creaste tu cuenta en Comerz pero todavía no configuraste tu negocio. Te faltan menos de dos minutos para empezar a usarlo.",
    ],
    cta: { texto: "Crear mi negocio", ruta: "/empezar" },
    beneficios: BENEFICIOS_BASE,
    cierre: PRUEBA_Y_AYUDA,
  },

  /**
   * Vio el formulario del negocio y lo abandonó ahí. A diferencia del de
   * arriba, esta persona SÍ vio la pantalla: el mail no le explica qué es
   * Comerz, le dice que lo que dejó escrito no se perdió.
   */
  VIO_FORMULARIO: {
    clave: "formulario_abandonado",
    asunto: "Quedaste a un paso de tener tu negocio en Comerz",
    intro: [
      "Abriste el formulario para crear tu negocio y no llegaste a terminarlo. Son tres datos —nombre, rubro y ubicación— y ya podés empezar a cargar tus productos.",
      "Si algo del formulario no te cerró, escribinos: saberlo nos sirve tanto como que lo completes.",
    ],
    cta: { texto: "Terminar de crear mi negocio", ruta: "/empezar" },
    beneficios: BENEFICIOS_BASE,
    cierre: PRUEBA_Y_AYUDA,
  },

  /** Ya está adentro. No se le escribe. */
  CREO_NEGOCIO: null,
};

export function campanaDeEtapa(etapa: EtapaAlta): Campana | null {
  return CAMPANAS[etapa];
}

export interface DatosRender {
  /** URL base del sitio, sin barra final. Los CTA cuelgan de acá. */
  urlBase: string;
  /**
   * Id de la fila de `envios_email`. Es lo que identifica al envío en el link
   * de baja: un uuid aleatorio que solo está en ESE mail.
   */
  envioId: string;
}

export interface MailRenderizado {
  asunto: string;
  texto: string;
  html: string;
}

/**
 * Escapa lo que va adentro del HTML.
 *
 * Hoy toda la copia es literal de este archivo, así que no hay nada que
 * inyectar — pero el día que un texto tome el nombre del comercio o algo que
 * escribió una persona, esto ya está puesto. Es más barato ahora que después.
 */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderizarCampana(
  campana: Campana,
  { urlBase, envioId }: DatosRender,
): MailRenderizado {
  const base = urlBase.replace(/\/$/, "");
  // La ruta puede ser absoluta: las campañas de cobro apuntan al link de pago
  // de Mercado Pago, que vive fuera de la app. Pegarle la URL base adelante
  // daría un link roto en el único mail donde el link es el punto.
  const urlCta = /^https?:\/\//.test(campana.cta.ruta)
    ? campana.cta.ruta
    : `${base}${campana.cta.ruta}`;
  const urlBaja = `${base}/baja-mails/${envioId}`;

  // ── Texto plano ──────────────────────────────────────────────────────────
  // No es un fallback decorativo: hay clientes que lo muestran, y un mail sin
  // versión de texto puntúa peor en los filtros de spam. El CTA va como URL
  // desnuda porque acá no hay link que valga.
  const texto = [
    ...campana.intro,
    `${campana.cta.texto}: ${urlCta}`,
    ...(campana.beneficios.length > 0
      ? [
          "Apenas lo configures vas a poder:",
          ...campana.beneficios.map((b) => `• ${b}`),
        ]
      : []),
    ...campana.cierre,
    "",
    FIRMA_COMERZ,
    SITIO_COMERZ,
    "",
    `Si no querés recibir más mails nuestros, entrá acá: ${urlBaja}`,
  ].join("\n\n");

  // ── HTML ─────────────────────────────────────────────────────────────────
  // Todo inline y sin <style>: Gmail borra las hojas de estilo del <head>. Una
  // sola columna de 560px, que es lo que entra en un teléfono sin zoom.
  const parrafo = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${escaparHtml(t)}</p>`;

  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          ${campana.intro.map(parrafo).join("\n          ")}

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td style="border-radius:8px;background:#111827;">
              <a href="${escaparHtml(urlCta)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escaparHtml(campana.cta.texto)} &rarr;</a>
            </td></tr>
          </table>
${
  campana.beneficios.length > 0
    ? `
          ${parrafo("Apenas lo configures vas a poder:")}
          <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:#1f2937;">
            ${campana.beneficios.map((b) => `<li>${escaparHtml(b)}</li>`).join("\n            ")}
          </ul>`
    : ""
}
          ${campana.cierre.map(parrafo).join("\n          ")}

          <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#1f2937;">${escaparHtml(FIRMA_COMERZ)}<br><a href="https://${SITIO_COMERZ}" style="color:#6b7280;">${SITIO_COMERZ}</a></p>

          <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#9ca3af;">
            Recibís este mail porque creaste una cuenta en Comerz.
            <a href="${escaparHtml(urlBaja)}" style="color:#9ca3af;">No quiero recibir más mails</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { asunto: campana.asunto, texto, html };
}

/**
 * Si se le puede escribir, y si no, por qué no.
 *
 * Devuelve el motivo en vez de un booleano porque el botón del panel tiene que
 * poder decir "ya se le mandó" y "está dado de baja", que llevan a acciones
 * distintas. Un `false` pelado obliga a la UI a adivinar.
 */
export type MotivoNoEnviar =
  | "SIN_CAMPANA"
  | "YA_ENVIADO"
  | "DADO_DE_BAJA"
  | "ES_PRUEBA";

export function motivoParaNoEnviar(opciones: {
  etapa: EtapaAlta;
  esPrueba: boolean;
  dadoDeBaja: boolean;
  campanasYaEnviadas: ReadonlySet<string>;
}): MotivoNoEnviar | null {
  const campana = campanaDeEtapa(opciones.etapa);
  if (!campana) return "SIN_CAMPANA";
  if (opciones.dadoDeBaja) return "DADO_DE_BAJA";
  // La prueba propia va después de la baja: si las dos aplican, la baja es la
  // que importa saber.
  if (opciones.esPrueba) return "ES_PRUEBA";
  if (opciones.campanasYaEnviadas.has(campana.clave)) return "YA_ENVIADO";
  return null;
}

export const ETIQUETA_NO_ENVIAR: Record<MotivoNoEnviar, string> = {
  SIN_CAMPANA: "Ya está adentro",
  YA_ENVIADO: "Ya se le mandó",
  DADO_DE_BAJA: "Pidió no recibir mails",
  ES_PRUEBA: "Es una cuenta de prueba",
};
