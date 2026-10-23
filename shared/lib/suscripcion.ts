/**
 * Derivaciones de la suscripción, del lado del código.
 *
 * IMPORTANTE — el modelo real de Comerz hoy:
 *
 * No hay pasarela de pagos ni cobro automático. La suscripción son cuatro
 * columnas en `negocios` (plan_id, plan_vencimiento, estado, modalidad) que
 * hoy sólo mueve un admin de Comerz desde /admincomerz. Por eso:
 *
 * - `plan_vencimiento` es una fecha de FIN real, no un "próximo cobro": nada
 *   se renueva solo. La UI dice "vence", nunca "se renovará automáticamente".
 * - Los únicos estados que existen son los del CHECK de la base:
 *   'activo' | 'suspendido' | 'cancelado'. No hay PAYMENT_FAILED ni
 *   CANCEL_AT_PERIOD_END: inventarlos en el frontend sería mostrar un estado
 *   que la base no puede tener.
 *
 * Cuando exista facturación real, este módulo es el lugar donde agregar los
 * estados nuevos — no la UI.
 */

import type { ReglasPlan } from "@/shared/lib/planes";

/** Estado que se le muestra al comercio, derivado del estado crudo + la fecha. */
export type EstadoSuscripcion =
  | "SIN_PLAN"
  | "ACTIVA"
  | "POR_VENCER"
  | "VENCIDA"
  | "SUSPENDIDA"
  | "CANCELADA";

/** Umbral a partir del cual se avisa que se acerca el vencimiento. */
export const DIAS_AVISO_VENCIMIENTO = 7;
/** Por debajo de esto el aviso pasa de informativo a urgente. */
export const DIAS_VENCIMIENTO_URGENTE = 3;

/**
 * Días completos que faltan para el vencimiento. Negativo si ya pasó.
 *
 * Compara a medianoche local y no por diferencia de milisegundos: si vence
 * mañana a las 9 y son las 20 de hoy, faltan "1 día", no "0". Contar en horas
 * hace que el mismo día calendario muestre números distintos según la hora.
 */
export function diasHastaVencimiento(
  vencimiento: string | Date | null | undefined,
  ahora: Date = new Date(),
): number | null {
  if (!vencimiento) return null;
  const fin = vencimiento instanceof Date ? vencimiento : new Date(vencimiento);
  if (Number.isNaN(fin.getTime())) return null;

  const aMedianoche = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  return Math.round((aMedianoche(fin) - aMedianoche(ahora)) / 86_400_000);
}

export function derivarEstadoSuscripcion(params: {
  /** `negocios.estado` crudo. */
  estado: string | null | undefined;
  /** Nombre del plan; null cuando el negocio todavía no tiene uno asignado. */
  plan: string | null | undefined;
  vencimiento: string | null | undefined;
  ahora?: Date;
}): EstadoSuscripcion {
  const { estado, plan, vencimiento, ahora } = params;

  // El estado crudo manda sobre todo lo demás: un negocio suspendido lo está
  // aunque su fecha todavía no haya llegado.
  if (estado === "suspendido") return "SUSPENDIDA";
  if (estado === "cancelado") return "CANCELADA";

  // Sin plan no se bloquea nada (mismo criterio que tieneFeature y que la
  // base): son los comercios que ya venían trabajando antes de los planes.
  if (!plan) return "SIN_PLAN";

  const dias = diasHastaVencimiento(vencimiento, ahora);
  if (dias === null) return "ACTIVA";
  if (dias < 0) return "VENCIDA";
  if (dias <= DIAS_AVISO_VENCIMIENTO) return "POR_VENCER";
  return "ACTIVA";
}

export type TonoEstado = "neutral" | "exito" | "aviso" | "urgente" | "error";

export const PRESENTACION_ESTADO: Record<
  EstadoSuscripcion,
  { etiqueta: string; tono: TonoEstado }
> = {
  SIN_PLAN: { etiqueta: "Sin plan", tono: "neutral" },
  ACTIVA: { etiqueta: "Activa", tono: "exito" },
  POR_VENCER: { etiqueta: "Por vencer", tono: "aviso" },
  VENCIDA: { etiqueta: "Vencida", tono: "error" },
  SUSPENDIDA: { etiqueta: "Suspendida", tono: "error" },
  CANCELADA: { etiqueta: "Cancelada", tono: "error" },
};

/** Un límite del plan, ya resuelto contra el uso real. */
export type UsoLimite = {
  clave: string;
  nombre: string;
  /** null = no se puede contar todavía (no existe la fuente de datos). */
  usado: number | null;
  /** null = sin límite. */
  limite: number | null;
  /** Aclaración opcional (ej. que las invitaciones pendientes ocupan lugar). */
  detalle?: string;
  /** Tope blando: avisa al llegar, pero nunca frena nada. No tiene "cerca" (el
   * aviso es recién al tope) y la UI lo dice con otras palabras. */
  blando?: boolean;
};

export type NivelUso = "sin-limite" | "desconocido" | "ok" | "cerca" | "lleno";

/** A partir de qué proporción del límite se considera "cerca". */
export const UMBRAL_CERCA_DEL_LIMITE = 0.8;

export function nivelDeUso(uso: UsoLimite): NivelUso {
  if (uso.limite === null) return "sin-limite";
  if (uso.usado === null) return "desconocido";
  if (uso.usado >= uso.limite) return "lleno";
  if (uso.blando) return "ok";
  if (uso.limite > 0 && uso.usado / uso.limite >= UMBRAL_CERCA_DEL_LIMITE) {
    return "cerca";
  }
  return "ok";
}

/** Porcentaje para la barra. null cuando no corresponde dibujarla. */
export function porcentajeDeUso(uso: UsoLimite): number | null {
  if (uso.limite === null || uso.limite <= 0 || uso.usado === null) return null;
  return Math.min(100, Math.round((uso.usado / uso.limite) * 100));
}

/**
 * Agrupación de features para la UI. Las claves son las mismas que viajan en
 * `planes.reglas.features` — si aparece una clave nueva que no está acá, cae
 * en "Otras funcionalidades" en vez de desaparecer de la lista.
 */
export const GRUPOS_FEATURES: { titulo: string; claves: string[] }[] = [
  {
    titulo: "Ventas",
    claves: ["pos", "caja", "ventas", "tickets", "multicaja", "historial_ventas"],
  },
  {
    titulo: "Gestión",
    claves: [
      "stock",
      "clientes",
      "cuenta_corriente",
      "cuenta_corriente_ilimitada",
      "catalogo_publico",
    ],
  },
  { titulo: "Análisis", claves: ["reportes", "reportes_exportar"] },
  {
    titulo: "Administración",
    claves: ["roles", "auditoria", "permisos_avanzados"],
  },
  {
    titulo: "Sucursales",
    claves: [
      "multisucursal",
      "stock_por_sucursal",
      "transferencias_sucursal",
      "dashboard_consolidado",
    ],
  },
  {
    titulo: "Integraciones",
    claves: ["facturacion_electronica", "integraciones", "api"],
  },
];

export function agruparFeatures(
  features: string[] | null | undefined,
): { titulo: string; claves: string[] }[] {
  const presentes = new Set(features ?? []);
  if (presentes.size === 0) return [];

  const grupos = GRUPOS_FEATURES.map((g) => ({
    titulo: g.titulo,
    claves: g.claves.filter((c) => presentes.has(c)),
  })).filter((g) => g.claves.length > 0);

  const clasificadas = new Set(GRUPOS_FEATURES.flatMap((g) => g.claves));
  const sueltas = [...presentes].filter((c) => !clasificadas.has(c));
  if (sueltas.length > 0) {
    grupos.push({ titulo: "Otras funcionalidades", claves: sueltas });
  }

  return grupos;
}

/**
 * Diferencia entre el plan actual y otro, para la sección "otros planes".
 * Compara por `orden` y no por precio: el orden es el que define la escalera
 * comercial, y dos planes podrían llegar a costar lo mismo.
 */
export type RelacionPlan = "actual" | "superior" | "inferior";

export function relacionConPlanActual(
  ordenActual: number | null,
  ordenOtro: number,
): RelacionPlan {
  if (ordenActual === null) return "superior";
  if (ordenOtro === ordenActual) return "actual";
  return ordenOtro > ordenActual ? "superior" : "inferior";
}

/** Features que tiene `otro` y no tiene el plan actual. */
export function featuresExtra(
  reglasActual: ReglasPlan | null | undefined,
  reglasOtro: ReglasPlan,
): string[] {
  const actuales = new Set(reglasActual?.features ?? []);
  return (reglasOtro.features ?? []).filter((f) => !actuales.has(f));
}
