/**
 * El pago de un remito al proveedor (docs/asistente-ia.md, C1).
 *
 * El criterio de "a pagar" vive en SQL (`resumen_pagos_remitos`, migración
 * 20261022160000): acá solo se agrupa y se rotula lo que la base ya decidió,
 * para no tener dos respuestas a la misma pregunta.
 */

/** Espejo de `resumen_pagos_remitos().situacion`. */
export type SituacionRemito =
  | "A_PAGAR"
  | "SIN_RESPONDER"
  | "PAGADO"
  | "ANTERIOR"
  | "SIN_INGRESAR"
  | "DESCARTADO";

/** Lo que se elige en "¿Lo pagaste?" (`definir_pago_remito.p_opcion`). */
export type OpcionPagoRemito = "PAGAR_AHORA" | "PAGAR_DESPUES" | "PAGADO_FUERA";

export interface RemitoResumenPago {
  id: string;
  /** Nombre del ingreso (columna `ordenes_compra.proveedor`, histórica). */
  nombre: string;
  fecha_remito: string | null;
  creado_en: string;
  aprobado_en: string | null;
  estado: string;
  pago_modo: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  valor: number;
  total_pagado: number;
  saldo_pendiente: number;
  situacion: SituacionRemito;
}

export interface DeudaProveedor {
  /** null = remitos a pagar sin proveedor (se pagó a medias con "Sí, ahora"). */
  proveedorId: string | null;
  proveedorNombre: string;
  total: number;
  remitos: RemitoResumenPago[];
}

export const SIN_PROVEEDOR = "Sin proveedor";

/**
 * Los remitos A_PAGAR agrupados por proveedor, el que más se debe primero.
 * Dentro de cada proveedor, el remito más viejo primero: es el que se paga
 * antes.
 */
export function agruparDeudaPorProveedor(
  remitos: readonly RemitoResumenPago[],
): DeudaProveedor[] {
  const grupos = new Map<string, DeudaProveedor>();
  for (const r of remitos) {
    if (r.situacion !== "A_PAGAR") continue;
    const clave = r.proveedor_id ?? "";
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        proveedorId: r.proveedor_id,
        proveedorNombre: r.proveedor_nombre ?? SIN_PROVEEDOR,
        total: 0,
        remitos: [],
      };
      grupos.set(clave, grupo);
    }
    grupo.total += Number(r.saldo_pendiente);
    grupo.remitos.push(r);
  }
  for (const g of grupos.values()) {
    g.remitos.sort((a, b) => fechaRemito(a).localeCompare(fechaRemito(b)));
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

function fechaRemito(r: RemitoResumenPago): string {
  return r.fecha_remito ?? r.creado_en;
}

/** Días desde que se subió un remito que todavía no ingresó. */
export function diasSinIngresar(creadoEn: string, ahora = new Date()): number {
  return Math.max(
    0,
    Math.floor((ahora.getTime() - new Date(creadoEn).getTime()) / 86_400_000),
  );
}

/** Concepto del gasto que arma "Pagar": dice a quién y qué remito. */
export function conceptoPagoRemito(
  r: Pick<RemitoResumenPago, "nombre" | "proveedor_nombre">,
): string {
  const remito = r.nombre?.trim() || "remito";
  return r.proveedor_nombre
    ? `Pago a ${r.proveedor_nombre} · ${remito}`
    : `Pago de ${remito}`;
}

const MENSAJES: Record<string, string> = {
  PROVEEDOR_REQUERIDO: "Para dejarlo a pagar, elegí a qué proveedor se le debe.",
  PROVEEDOR_INVALIDO: "Ese proveedor no está disponible. Elegí otro.",
  REMITO_NO_APROBADO: "El remito todavía no ingresó: primero aprobalo.",
  REMITO_NO_ENCONTRADO: "No encontramos ese remito.",
  REMITO_PAGO_ANTERIOR: "Ese remito es anterior al registro de pagos: no hay nada que declarar.",
  REMITO_CON_PAGOS:
    "Ese remito ya tiene pagos cargados desde Comerz. Para cambiarlo, anulá esos gastos primero.",
  REMITO_DESCARTADO: "Ese remito está descartado.",
  REMITO_NO_DESCARTABLE: "Solo se descarta un remito cuya mercadería no ingresó.",
  SIN_PERMISO: "No tenés permiso para ingresar remitos.",
  OPCION_PAGO_INVALIDA: "Elegí una de las opciones.",
};

/** Traduce los códigos que levantan la base y sus triggers. */
export function mensajeErrorRemito(mensaje: string | undefined | null): string | null {
  if (!mensaje) return null;
  const codigo = Object.keys(MENSAJES).find((c) => mensaje.includes(c));
  return codigo ? MENSAJES[codigo] : null;
}
