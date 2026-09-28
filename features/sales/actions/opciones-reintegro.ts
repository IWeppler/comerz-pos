"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import type { TipoMetodo } from "@/entities/payments/types";

/** Un método por el que se puede devolver la plata. Es la misma lista con la
 * que el comercio cobra: devolver por un medio que no usa no tiene sentido. */
export interface MetodoReintegro {
  id: string;
  nombre: string;
  tipo: TipoMetodo;
  /** Ese método fue el que cobró esta venta. La pantalla lo marca para que
   * "devolver por donde vino" siga siendo la opción más fácil de encontrar. */
  esElDelCobro: boolean;
}

export interface OpcionesReintegro {
  /** Sin el permiso no hay selector y la devolución sale por el medio del
   * cobro, que es lo que pasaba siempre. */
  puedeElegir: boolean;
  /** Lo que se cobró de verdad (base, sin el recargo por método, que no se
   * devuelve). Cero en una venta 100% fiada: ahí no hay plata que devolver. */
  montoCobrado: number;
  /** Cómo se cobró, para poder nombrarlo en la pantalla. Vacío si es fiado. */
  medioDelCobro: string | null;
  metodos: MetodoReintegro[];
  /**
   * Se puede dejar a cuenta del cliente (saldo a favor, 20260928240000): la
   * venta tiene cliente. NO depende de `puedeElegir`: un vale no saca plata
   * del cajón, así que alcanza con poder devolver (decidido el 28/9/2026).
   */
  puedeDejarACuenta: boolean;
  /** Para nombrar a quién le queda el saldo a favor. */
  clienteNombre: string | null;
}

const SIN_OPCIONES: OpcionesReintegro = {
  puedeElegir: false,
  montoCobrado: 0,
  medioDelCobro: null,
  metodos: [],
  puedeDejarACuenta: false,
  clienteNombre: null,
};

/**
 * Qué puede elegir quien está por anular o devolver.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL PERMISO SE PREGUNTA ACÁ Y TAMBIÉN EN LA BASE
 *
 * Esta respuesta decide si la pantalla MUESTRA el selector. No decide nada
 * más: la RPC vuelve a pedir `ventas.elegir_medio_devolucion` antes de tocar
 * plata, porque un server action es un endpoint y el botón escondido no es
 * control de acceso. Si alguna vez las dos discrepan, gana la base.
 *
 * Ante cualquier error se devuelve "no podés elegir": el comportamiento de
 * siempre. Un selector que aparece por un error de red es peor que no tenerlo.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function getOpcionesReintegroAction(
  ventaId: string,
): Promise<OpcionesReintegro> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const [puedeElegir, { data: pagos }, { data: metodos }, { data: venta }] =
      await Promise.all([
      tienePermiso(supabase, PERMISOS.VENTAS_ELEGIR_MEDIO_DEVOLUCION),
      supabase
        .from("venta_pagos")
        .select("metodo_pago_id, metodo_nombre, monto_base")
        .eq("venta_id", ventaId)
        .eq("tipo_movimiento", "PAGO_VENTA")
        .neq("estado_pago_operacion", "ANULADO"),
      supabase
        .from("metodos_pago")
        .select("id, nombre, tipo")
        .eq("activo", true)
        .order("nombre"),
      supabase
        .from("ventas")
        .select("cliente_id, clientes(nombre)")
        .eq("id", ventaId)
        .maybeSingle(),
    ]);

    // PostgREST devuelve la relación como objeto o como array según cómo
    // infiere la FK; se normaliza.
    const relacionCliente = venta?.clientes as unknown as
      | { nombre: string | null }
      | { nombre: string | null }[]
      | null;
    const cliente = Array.isArray(relacionCliente)
      ? (relacionCliente[0] ?? null)
      : relacionCliente;

    const cobros = pagos ?? [];
    const idsDelCobro = new Set(
      cobros.map((pago) => pago.metodo_pago_id).filter(Boolean) as string[],
    );

    return {
      puedeElegir,
      montoCobrado: cobros.reduce(
        (acc, pago) => acc + Number(pago.monto_base || 0),
        0,
      ),
      // Con más de un cobro no hay UN medio que nombrar, y decir el primero
      // sería la misma mentira que `ventas.metodo_pago`.
      medioDelCobro:
        cobros.length === 1 ? (cobros[0].metodo_nombre ?? null) : null,
      metodos: (metodos ?? []).map((metodo) => ({
        id: metodo.id as string,
        nombre: metodo.nombre as string,
        tipo: metodo.tipo as TipoMetodo,
        esElDelCobro: idsDelCobro.has(metodo.id as string),
      })),
      puedeDejarACuenta: Boolean(venta?.cliente_id),
      clienteNombre: cliente?.nombre ?? null,
    };
  } catch (err) {
    console.error("[REINTEGRO] No se pudieron leer las opciones:", err);
    return SIN_OPCIONES;
  }
}
