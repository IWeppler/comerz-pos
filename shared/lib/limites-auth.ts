import { createHash } from "node:crypto";

/**
 * Topes de intentos de las acciones de autenticación (auditoría de seguridad
 * del 22/10/2026, punto 4). El efecto contra la base vive en `limite-auth.ts`;
 * acá están las reglas, puras y con tests.
 *
 * Por qué por IP Y por mail: la IP sola no frena a quien reparte el ataque
 * entre muchas; el mail solo deja que alguien pruebe una clave contra cada
 * cuenta. Un tope por mail permite que alguien bloquee a otra persona a
 * propósito, por eso la ventana es corta (15 min) y el tope del login cuenta
 * solo FALLIDOS.
 *
 * La IP de un local la comparten todas las vendedoras (mismo wifi): el tope
 * por IP del login es holgado a propósito.
 */

export type AccionAuth = "LOGIN" | "RECUPERAR" | "REGISTRO" | "VERIFICACION";

interface ReglaAuth {
  ventanaSeg: number;
  /** null = esta acción no limita por esa clave. */
  maxPorIp: number | null;
  maxPorEmail: number | null;
}

export const REGLAS_AUTH: Record<AccionAuth, ReglaAuth> = {
  // Solo intentos FALLIDOS (los anota `anotarIntentoFallido`).
  LOGIN: { ventanaSeg: 15 * 60, maxPorIp: 30, maxPorEmail: 10 },
  // Cada pedido manda un mail: cuenta todo.
  RECUPERAR: { ventanaSeg: 60 * 60, maxPorIp: 10, maxPorEmail: 5 },
  REGISTRO: { ventanaSeg: 60 * 60, maxPorIp: 10, maxPorEmail: null },
  VERIFICACION: { ventanaSeg: 60 * 60, maxPorIp: 20, maxPorEmail: 5 },
};

export const MENSAJE_DEMASIADOS_INTENTOS =
  "Demasiados intentos. Esperá unos minutos y probá de nuevo.";

/**
 * La IP de quien hace el pedido. En Vercel, `x-forwarded-for` lo escribe la
 * plataforma (pisa lo que mande el cliente) y la primera es la del cliente.
 */
export function ipDelPedido(
  xForwardedFor: string | null | undefined,
  xRealIp?: string | null,
): string | null {
  const primera = xForwardedFor?.split(",")[0]?.trim();
  if (primera) return primera;
  const real = xRealIp?.trim();
  return real || null;
}

function hash(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/**
 * Las claves (hasheadas: la base no guarda mails ni IPs) y los topes que la
 * acción aplica. null = no hay nada que controlar (sin IP ni mail).
 */
export function consultaDeCupo(
  accion: AccionAuth,
  datos: { ip: string | null; email: string | null | undefined },
): { claves: string[]; maximos: number[]; ventanaSeg: number } | null {
  const regla = REGLAS_AUTH[accion];
  const claves: string[] = [];
  const maximos: number[] = [];

  if (regla.maxPorIp !== null && datos.ip) {
    claves.push(hash(`ip:${datos.ip}`));
    maximos.push(regla.maxPorIp);
  }

  const email = datos.email?.trim().toLowerCase();
  if (regla.maxPorEmail !== null && email) {
    claves.push(hash(`email:${email}`));
    maximos.push(regla.maxPorEmail);
  }

  if (claves.length === 0) return null;
  return { claves, maximos, ventanaSeg: regla.ventanaSeg };
}
