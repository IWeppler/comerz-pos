import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import type { ProgresoActivacion } from "@/features/onboarding/lib/pasos-activacion";

/**
 * La barra de la prueba gratis: cuántos días quedan y qué conviene hacer hoy.
 *
 * Módulo puro (sin IO) como `pasos-activacion.ts`: el texto cambia según la
 * etapa del comercio, y esas etapas son reglas de negocio que se testean sin
 * base.
 *
 * Las etapas, en orden de prioridad:
 *  1. Ya pidió un plan → no se lo apura más: se le confirma que está en curso.
 *     Insistir con "elegí un plan" a quien ya eligió es ruido que enoja.
 *  2. Prueba vencida → conversión, tono de error.
 *  3. Quedan pocos días → conversión: elegir plan.
 *  4. No vendió todavía → activación: el próximo paso de la guía, con nombre.
 *     "Continuar configuración" no dice qué falta; "Cargá tus productos" sí.
 *  5. Ya vende → se le muestra lo que ya hizo (sus ventas) y, si queda algo
 *     de la guía, ese paso; si no, los planes.
 */

/** A partir de acá la barra deja de pedir configuración y pide un plan. */
export const DIAS_PRUEBA_CONVERSION = 3;

export type TonoBarraPrueba = "neutral" | "aviso" | "error" | "exito";

export interface BarraPrueba {
  /** La parte que se lee primero: los días. */
  titulo: string;
  /** Lo que conviene hacer o lo que ya hizo. */
  detalle: string;
  cta: { etiqueta: string; href: string } | null;
  tono: TonoBarraPrueba;
  /** Lo que queda de la prueba, 0–100. null = no se dibuja la barra. */
  porcentajeRestante: number | null;
}

export const HREF_PLANES = "/perfil?tab=plan";

/**
 * Días de calendario argentino entre hoy y el vencimiento. 0 = vence hoy,
 * negativo = ya venció.
 *
 * Por día comercial y no por milisegundos: `plan_vencimiento` es un instante
 * (timestamptz) y el servidor corre en UTC. A las 22 de Buenos Aires ya es el
 * día siguiente en UTC, y contar ahí le restaría un día a la prueba de noche.
 */
export function diasCalendario(
  desde: Date | string,
  hasta: Date | string,
): number {
  const a = Date.parse(`${diaComercial(desde)}T00:00:00Z`);
  const b = Date.parse(`${diaComercial(hasta)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function cuandoTermina(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  return `en ${dias} días`;
}

export function construirBarraPrueba(params: {
  /** `negocios.plan_vencimiento`. */
  vencimiento: string;
  /** `negocios.created_at`: el arranque de la prueba, para el largo de la barra. */
  inicio: string;
  ahora?: Date;
  /** Null si no se pudo leer: la barra cae a los días y los planes. */
  activacion: ProgresoActivacion | null;
  /** Ventas no anuladas. Null si no se pudo contar. */
  ventas: number | null;
  /** Nombre del plan pedido y todavía no aplicado. */
  planSolicitado: string | null;
}): BarraPrueba {
  const ahora = params.ahora ?? new Date();
  const dias = diasCalendario(ahora, params.vencimiento);
  const total = Math.max(1, diasCalendario(params.inicio, params.vencimiento));
  const porcentajeRestante = Math.min(
    100,
    Math.max(0, Math.round((dias / total) * 100)),
  );

  if (params.planSolicitado) {
    return {
      titulo: `Pediste el plan ${params.planSolicitado}`,
      detalle: "Te escribimos para activarlo. Mientras tanto seguís usando Comerz.",
      cta: { etiqueta: "Ver pedido", href: HREF_PLANES },
      tono: "exito",
      porcentajeRestante: null,
    };
  }

  if (dias < 0) {
    return {
      titulo: "Tu prueba terminó",
      detalle: "Elegí un plan para seguir usando Comerz.",
      cta: { etiqueta: "Elegir plan", href: HREF_PLANES },
      tono: "error",
      porcentajeRestante: null,
    };
  }

  if (dias <= DIAS_PRUEBA_CONVERSION) {
    return {
      titulo: `Tu prueba termina ${cuandoTermina(dias)}`,
      detalle: "Elegí un plan para seguir usando Comerz.",
      cta: { etiqueta: "Elegir plan", href: HREF_PLANES },
      tono: "aviso",
      porcentajeRestante,
    };
  }

  const titulo = `Te quedan ${dias} días de prueba`;
  const activacion = params.activacion;
  const activado = activacion?.activado ?? true;
  // Antes de vender, solo los obligatorios: "Sumá a tu equipo" no acerca a la
  // primera venta, y `siguiente` de la guía sí incluye los opcionales.
  const siguiente = activado
    ? (activacion?.siguiente ?? null)
    : (activacion?.pasos.find((p) => !p.hecho && !p.opcional) ?? null);
  // Un paso con `accion` no se resuelve navegando (abrir la caja es el modal
  // del navbar): se manda al inicio, donde la guía tiene el botón que lo hace.
  const ctaPaso = siguiente
    ? {
        etiqueta: siguiente.accion ? "Ver guía" : siguiente.cta,
        href: siguiente.accion ? "/" : siguiente.href,
      }
    : null;

  // Todavía no vendió: lo que importa es llegar a la primera venta, y el
  // camino es el próximo paso obligatorio de la guía.
  if (!activado && siguiente) {
    return {
      titulo,
      detalle: siguiente.titulo,
      cta: ctaPaso,
      tono: "neutral",
      porcentajeRestante,
    };
  }

  const ventas = params.ventas ?? 0;
  return {
    titulo,
    detalle:
      ventas > 0
        ? `Ya hiciste ${ventas} ${ventas === 1 ? "venta" : "ventas"} con Comerz`
        : "Aprovechalos para probar todo",
    cta: ctaPaso ?? { etiqueta: "Ver planes", href: HREF_PLANES },
    tono: "neutral",
    porcentajeRestante,
  };
}
