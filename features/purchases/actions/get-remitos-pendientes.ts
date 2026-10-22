"use server";

import { diasSinIngresar } from "../lib/pago-remito";
import { getResumenPagosRemitosAction } from "./pago-remito";

export type RemitosPendientesResumen = {
  /** Remitos subidos cuya mercadería no ingresó (PENDIENTE). */
  cantidad: number;
  diasMasAntiguo: number;
  idMasAntiguo: string;
  /** Remitos aprobados que se deben (A_PAGAR) y sin responder si se pagaron. */
  aPagarCantidad: number;
  aPagarTotal: number;
  sinResponder: number;
};

/**
 * Resumen de remitos para el Advisor del panel: mercadería sin ingresar por un
 * lado, deuda con proveedores por el otro (antes era una sola alerta, "sin
 * conciliar", que solo hablaba de lo primero). Sale de
 * `resumen_pagos_remitos`, el mismo criterio que Compras.
 * `creado_en` (momento de subida) es la antigüedad relevante, no
 * `fecha_remito` (fecha del papel).
 */
export async function getRemitosPendientesAction(): Promise<RemitosPendientesResumen | null> {
  const remitos = await getResumenPagosRemitosAction();

  const sinIngresar = remitos.filter((r) => r.situacion === "SIN_INGRESAR");
  const aPagar = remitos.filter((r) => r.situacion === "A_PAGAR");
  const masAntiguo = sinIngresar.reduce<(typeof sinIngresar)[number] | null>(
    (min, r) => (!min || r.creado_en < min.creado_en ? r : min),
    null,
  );

  return {
    cantidad: sinIngresar.length,
    diasMasAntiguo: masAntiguo ? diasSinIngresar(masAntiguo.creado_en) : 0,
    idMasAntiguo: masAntiguo?.id ?? "",
    aPagarCantidad: aPagar.length,
    aPagarTotal: aPagar.reduce((s, r) => s + r.saldo_pendiente, 0),
    sinResponder: remitos.filter((r) => r.situacion === "SIN_RESPONDER").length,
  };
}
