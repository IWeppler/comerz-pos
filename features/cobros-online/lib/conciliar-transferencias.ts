/**
 * Conciliación automática de transferencias: qué transferencia recibida en el
 * Mercado Pago del comercio paga qué orden. PURA, sin red ni base.
 *
 * Lo que dice el spike (docs/pagos-auditoria.md §11): una transferencia al
 * CVU/alias aparece en `/v1/payments/search` aprobada al instante, con monto y
 * fecha exactos, pero SIN referencia a la orden (la clienta no tiene dónde
 * ponerla). El único dato para emparejar es el MONTO, así que:
 *
 *   - solo transferencias ENTRANTES (`money_transfer` desde otra cuenta de MP,
 *     `account_fund` desde un banco al CVU), aprobadas, en pesos, cobradas por
 *     la cuenta conectada y sin `external_reference` (esas son de checkout);
 *   - monto EXACTO y fecha dentro de la ventana de la orden (desde un poco
 *     antes de crearla hasta que vence);
 *   - UNA candidata de cada lado. Si una transferencia sirve para dos órdenes,
 *     o una orden tiene dos transferencias posibles, no se adivina: queda para
 *     el botón "Confirmar transferencia". Equivocarse acá es darle por pagada
 *     la orden a quien no pagó.
 */

export interface OrdenPendienteTransferencia {
  id: string;
  total: number;
  creadoEn: Date;
  venceEn: Date;
}

export interface PagoMp {
  id: number | string;
  status?: string;
  operation_type?: string;
  payment_type_id?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string | null;
  date_created?: string;
  collector_id?: number | string;
  external_reference?: string | null;
}

export interface Coincidencia {
  ordenId: string;
  pago: PagoMp;
}

/** Margen antes de crear la orden: relojes y la clienta que transfiere mientras confirma. */
export const TOLERANCIA_PREVIA_MS = 2 * 60 * 1000;

const OPERACIONES_ENTRANTES = new Set(["money_transfer", "account_fund"]);

export function esTransferenciaEntrante(pago: PagoMp, mpUserId: string): boolean {
  return (
    pago.status === "approved" &&
    pago.currency_id === "ARS" &&
    OPERACIONES_ENTRANTES.has(pago.operation_type ?? "") &&
    String(pago.collector_id ?? "") === mpUserId &&
    !pago.external_reference
  );
}

const fechaDelPago = (pago: PagoMp): Date | null => {
  const iso = pago.date_approved ?? pago.date_created;
  const fecha = iso ? new Date(iso) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha : null;
};

const mismoMonto = (a: number, b: number) => Math.abs(a - b) < 0.005;

function encaja(orden: OrdenPendienteTransferencia, pago: PagoMp): boolean {
  const fecha = fechaDelPago(pago);
  if (!fecha || !Number.isFinite(Number(pago.transaction_amount))) return false;
  return (
    mismoMonto(Number(pago.transaction_amount), orden.total) &&
    fecha.getTime() >= orden.creadoEn.getTime() - TOLERANCIA_PREVIA_MS &&
    fecha.getTime() <= orden.venceEn.getTime()
  );
}

export function conciliarTransferencias({
  ordenes,
  pagos,
  mpUserId,
  pagosYaUsados = new Set<string>(),
}: {
  ordenes: OrdenPendienteTransferencia[];
  pagos: PagoMp[];
  mpUserId: string;
  /** Ids de pagos que ya están en otra orden: no se vuelven a usar. */
  pagosYaUsados?: Set<string>;
}): { coincidencias: Coincidencia[]; ambiguas: number } {
  const candidatos = pagos.filter(
    (p) => esTransferenciaEntrante(p, mpUserId) && !pagosYaUsados.has(String(p.id)),
  );

  const ordenesPorPago = new Map<string, OrdenPendienteTransferencia[]>();
  const pagosPorOrden = new Map<string, PagoMp[]>();
  for (const pago of candidatos) {
    for (const orden of ordenes) {
      if (!encaja(orden, pago)) continue;
      ordenesPorPago.set(String(pago.id), [...(ordenesPorPago.get(String(pago.id)) ?? []), orden]);
      pagosPorOrden.set(orden.id, [...(pagosPorOrden.get(orden.id) ?? []), pago]);
    }
  }

  const coincidencias: Coincidencia[] = [];
  let ambiguas = 0;
  for (const [pagoId, ordenesDelPago] of ordenesPorPago) {
    const pago = candidatos.find((p) => String(p.id) === pagoId)!;
    if (ordenesDelPago.length !== 1) {
      ambiguas++;
      continue;
    }
    const orden = ordenesDelPago[0];
    if ((pagosPorOrden.get(orden.id) ?? []).length !== 1) {
      ambiguas++;
      continue;
    }
    coincidencias.push({ ordenId: orden.id, pago });
  }
  return { coincidencias, ambiguas };
}
