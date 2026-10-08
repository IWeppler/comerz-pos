"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import {
  calcularSaldoConRecargo,
  type BasesMora,
  type RecargoMoraConfig,
} from "@/features/clients/lib/calcular-saldo-con-recargo";
import { calcularDiasVencido } from "@/features/clients/lib/calcular-dias-vencido";
import type { MetodoPago } from "@/entities/payments/types";

export type ClienteConDeuda = {
  id: string;
  nombre: string;
  telefono: string | null;
  saldo: number;
  /** Mora ya devengada según la config del comercio. Es lo que el server va a
   * volver a calcular al cobrar: acá viaja solo para poder mostrarla. */
  mora: number;
  diasVencido: number;
};

export type DatosCobroCuentaCorriente = {
  clientes: ClienteConDeuda[];
  metodosPago: MetodoPago[];
  error: string | null;
};

/**
 * Todo lo que necesita el modal de cobro, en UNA sola llamada.
 *
 * Tres motivos para que esto sea una action y no tres queries desde el
 * navegador (que es lo que hace `ClientSelector`):
 *
 * 1. Un viaje en vez de tres. Con la base en Ohio, cada uno se paga caro; el
 *    modal se abre en el mostrador con alguien esperando.
 * 2. La mora se calcula donde vive su configuración. `recargo_mora_tipo` y
 *    `recargo_mora_valor` son de `configuracion_pos`, y el número tiene que
 *    salir de la MISMA función que usa `registrarPagoDeudaAction` para que el
 *    monto sugerido no discrepe de lo que se cobra.
 * 3. Devuelve SOLO clientes con saldo. Para cobrar no sirven los 156 clientes
 *    de Evens sino los que deben — y ordenados por vencido primero, que es a
 *    quien hay que cobrarle.
 */
export async function getDatosCobroCuentaCorrienteAction(): Promise<DatosCobroCuentaCorriente> {
  const vacio = { clientes: [], metodosPago: [] };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!(await tienePermiso(supabase, PERMISOS.CLIENTES_COBRAR_CC))) {
    return {
      ...vacio,
      error: "No tenés permiso para cobrar cuenta corriente.",
    };
  }

  const [
    { data: clientes, error: errorClientes },
    { data: metodos },
    { data: config },
    { data: vencidos },
  ] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nombre, telefono, saldo_pendiente, fecha_vencimiento_deuda")
      .gt("saldo_pendiente", 0)
      .order("nombre"),
    supabase
      .from("metodos_pago")
      .select(
        "id, nombre, tipo, comision, recargo_porcentaje, acreditacion_dias, activo",
      )
      // Por comisión ascendente: el efectivo (0%) primero, igual que en el
      // carrito del POS. No hay columna de orden en la tabla.
      .eq("activo", true)
      .order("comision", { ascending: true }),
    supabase
      .from("configuracion_pos")
      .select("recargo_mora_tipo, recargo_mora_valor, recargo_mora_base")
      .single(),
    // La porción vencida de cada cliente, imputando FIFO. Es la base del
    // recargo por mora: sobre el saldo entero se le cobra interés a compras
    // que todavía no vencieron. Ver `deuda_cc_vencida`.
    supabase.rpc("deuda_cc_vencida"),
  ]);

  // El error NO se traga: una lista vacía por RLS se ve igual que un comercio
  // sin deudores, y ahí el cobro se vuelve "no aparece la clienta" sin motivo.
  if (errorClientes) {
    console.error("[COBRO CC] error cargando clientes:", errorClientes);
    return { ...vacio, error: "No se pudieron cargar los clientes con deuda." };
  }

  const recargoConfig: RecargoMoraConfig = {
    recargo_mora_tipo: config?.recargo_mora_tipo ?? "NINGUNO",
    recargo_mora_valor: config?.recargo_mora_valor ?? 0,
    recargo_mora_base: config?.recargo_mora_base ?? "SALDO_COMPLETO",
  };

  const vencidoPorCliente = new Map<string, number>(
    ((vencidos ?? []) as { cliente_id: string; vencido: number | null }[]).map(
      (v) => [v.cliente_id, Number(v.vencido ?? 0)],
    ),
  );
  // Recargos anteriores impagos: se sacan de la base del próximo recargo, para
  // que la mora no se calcule sobre mora.
  const moraPreviaPorCliente = new Map<string, number>(
    (
      (vencidos ?? []) as { cliente_id: string; mora_viva: number | null }[]
    ).map((v) => [v.cliente_id, Number(v.mora_viva ?? 0)]),
  );
  // Capital vencido (base con PORCION_VENCIDA) y lo que ya pagó su recargo.
  const basesMoraPorCliente = new Map<string, BasesMora>(
    ((vencidos ?? []) as ({ cliente_id: string } & BasesMora)[]).map((v) => [
      v.cliente_id,
      {
        capital_vencido: v.capital_vencido,
        recargado_saldo: v.recargado_saldo,
        recargado_vencido: v.recargado_vencido,
        ventas_vencidas_nuevas: v.ventas_vencidas_nuevas,
      },
    ]),
  );

  const conDeuda: ClienteConDeuda[] = (clientes ?? []).map((c) => {
    const { saldoBase, montoRecargo } = calcularSaldoConRecargo(
      {
        monto_pendiente: c.saldo_pendiente,
        fecha_vencimiento: c.fecha_vencimiento_deuda,
        monto_vencido: vencidoPorCliente.get(c.id) ?? 0,
        mora_previa: moraPreviaPorCliente.get(c.id) ?? 0,
        ...basesMoraPorCliente.get(c.id),
      },
      recargoConfig,
    );

    return {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      saldo: saldoBase,
      mora: montoRecargo,
      diasVencido: Math.max(
        0,
        calcularDiasVencido(c.fecha_vencimiento_deuda) ?? 0,
      ),
    };
  });

  // Vencidos primero y, entre ellos, el más atrasado arriba. Después el resto
  // por nombre, que es como los busca quien atiende.
  conDeuda.sort((a, b) => {
    if (a.diasVencido !== b.diasVencido) return b.diasVencido - a.diasVencido;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  return {
    clientes: conDeuda,
    metodosPago: (metodos ?? []) as MetodoPago[],
    error: null,
  };
}
