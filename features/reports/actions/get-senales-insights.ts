"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Las señales de Comerz Intelligence que viven en la base, en una sola action.
 *
 * Todas están gateadas por `caja.ver_gerencial` y LANZAN sin permiso, así que
 * cada una se trae por separado y el error se traga: una vendedora no ve
 * ninguna tarjeta gerencial y la página no se rompe. Van juntas en un
 * `Promise.all` para que las seis consulten en paralelo y no en cascada — con
 * la base en Ohio y las funciones en Cleveland cada viaje se paga una vez, y
 * seis en serie serían seis veces eso.
 *
 * Cada señal se reduce acá a lo mínimo que necesita una tarjeta. El resto del
 * JSON que devuelven las RPC (rankings, tramos, peores deudores) es para
 * pantallas de análisis, no para una lista de cinco líneas.
 */

export type SenalesInsights = {
  metodoQuePierde: MetodoQuePierde | null;
  descuentosResignados: DescuentosResignados | null;
  renglonesSinCosto: RenglonesSinCosto | null;
  renglonAdicional: RenglonAdicional | null;
  momentoDelDia: MomentoDelDia | null;
  cuentaCorrienteDescuadrada: CuentaCorrienteDescuadrada | null;
};

export type MetodoQuePierde = {
  medio: string;
  neto: number;
  base: number;
  recargo: number;
  comision: number;
  operaciones: number;
};

export type DescuentosResignados = {
  monto: number;
  margenPct: number;
  margenPctAPrecioLleno: number;
  unidades: number;
};

export type RenglonesSinCosto = {
  renglones: number;
  total: number;
};

export type RenglonAdicional = {
  /** Margen promedio de la prenda que se SUMA en un ticket de dos. */
  margenPromedio: number;
  ticketsDeUnRenglon: number;
  pctDeUnRenglon: number;
};

export type MomentoDelDia = {
  diaFuerte: string;
  ventasPorDiaFuerte: number;
  diaFlojo: string;
  ventasPorDiaFlojo: number;
};

export type CuentaCorrienteDescuadrada = {
  clientes: number;
  clientesConDeuda: number;
};

const num = (v: unknown) => Number(v ?? 0);

/** Piso para que valga una tarjeta de método: la pérdida tiene que ser
 * sistemática, no un redondeo. */
const PERDIDA_MINIMA_PCT = 0.5;

/** Sin permiso gerencial la función lanza 42501, y eso es lo ESPERADO para
 * cualquier vendedora: no es un error que haya que mirar. */
const SIN_PERMISO = "42501";

/**
 * Llama una señal y se traga el fallo: la tarjeta simplemente no aparece.
 *
 * Lo que NO se traga es el aviso. Hasta el 31/8/2026 este helper devolvía null
 * en silencio ante cualquier error, y así estuvo 8 días llamando
 * `antiguedad_saldo_cc` con `p_desde/p_hasta` cuando esa función recibe
 * `p_limite`: PostgREST devolvía 404 en CADA carga del panel, la señal no se
 * mostró nunca y nadie se enteró hasta leer los logs de Supabase por otro
 * motivo. Una tarjeta que no aparece se ve igual que una tarjeta sin nada que
 * decir — por eso el error va al log, menos el de permiso.
 */
async function correrSenal(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, string | number>,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc(fn, args);

  if (error) {
    if (error.code !== SIN_PERMISO) {
      console.error(`[INSIGHTS] ${fn} falló:`, error.message);
    }
    return null;
  }

  return data ? (data as Record<string, unknown>) : null;
}

/** Una señal del PERÍODO: recibe el rango que el usuario eligió. */
async function rpcGerencial(
  supabase: SupabaseClient,
  fn: string,
  desde: string,
  hasta: string,
): Promise<Record<string, unknown> | null> {
  return correrSenal(supabase, fn, { p_desde: desde, p_hasta: hasta });
}

/**
 * El método de pago que más plata pierde, si hay alguno.
 *
 * El hallazgo que la hace valiosa: **recargo igual a comisión pierde plata**,
 * porque la comisión se cobra sobre el BRUTO y el recargo se calcula sobre la
 * BASE. 15% y 15% sobre 100 dan bruto 115, comisión 17,25 y neto 97,75.
 */
function reducirMetodos(
  data: Record<string, unknown> | null,
): MetodoQuePierde | null {
  if (!data) return null;
  const medios = (data.medios ?? []) as Record<string, unknown>[];

  let peor: MetodoQuePierde | null = null;
  for (const m of medios) {
    const base = num(m.base);
    const neto = num(m.neto);
    if (base <= 0 || neto >= 0) continue;
    if ((Math.abs(neto) * 100) / base < PERDIDA_MINIMA_PCT) continue;

    if (!peor || neto < peor.neto) {
      peor = {
        medio: String(m.medio ?? "Método sin nombre"),
        neto,
        base,
        recargo: num(m.recargo),
        comision: num(m.comision),
        operaciones: num(m.operaciones),
      };
    }
  }
  return peor;
}

/**
 * Cuánto se resignó en descuentos y cuántos puntos de margen costó. Es donde
 * vive la variación real de la rentabilidad: con markup uniforme el margen no
 * varía por producto, varía por descuento.
 */
function reducirDescuentos(
  data: Record<string, unknown> | null,
): DescuentosResignados | null {
  const totales = data?.totales as Record<string, unknown> | undefined;
  if (!totales) return null;

  const monto = num(totales.descuento_resignado);
  if (monto <= 0) return null;

  return {
    monto,
    margenPct: num(totales.margen_pct),
    margenPctAPrecioLleno: num(totales.margen_pct_a_precio_lleno),
    unidades: num(totales.unidades),
  };
}

/**
 * Renglones vendidos SIN costo cargado.
 *
 * `margen_realizado` no lo expone directo, pero sale de restar: los renglones
 * totales menos los que tienen costo. Importa porque un costo en cero no es
 * margen del 100%, es un costo que nadie cargó — y mientras estén ahí, el
 * margen total que muestra el panel está inflado.
 */
function reducirSinCosto(
  data: Record<string, unknown> | null,
): RenglonesSinCosto | null {
  const totales = data?.totales as Record<string, unknown> | undefined;
  const disp = data?.dispersion_markup as Record<string, unknown> | undefined;
  if (!totales || !disp) return null;

  const total = num(totales.renglones);
  const conCosto = num(disp.renglones_con_costo);
  const renglones = total - conCosto;
  if (total <= 0 || renglones <= 0) return null;

  return { renglones, total };
}

/**
 * El margen de la prenda que se SUMA cuando un ticket pasa de uno a dos
 * renglones.
 *
 * Es el único número que se puede prometer acá, y no es la diferencia de
 * ticket promedio entre tickets de uno y de dos: eso compara dos poblaciones
 * distintas (las que venían a comprar una cosa y las que venían a comprar
 * varias), no el valor de una conversión. Lo que se agrega es UNA prenda, y en
 * un ticket de dos la que se suma es la más barata.
 */
function reducirRenglonAdicional(
  data: Record<string, unknown> | null,
): RenglonAdicional | null {
  const adic = data?.renglon_adicional as Record<string, unknown> | undefined;
  if (!adic) return null;

  const margenPromedio = num(adic.margen_promedio);
  const ticketsDeUnRenglon = num(adic.tickets_de_un_renglon);
  if (margenPromedio <= 0 || ticketsDeUnRenglon <= 0) return null;

  return {
    margenPromedio,
    ticketsDeUnRenglon,
    pctDeUnRenglon: num(adic.pct_de_un_renglon),
  };
}

/**
 * Día más fuerte y más flojo, en ventas POR DÍA.
 *
 * La normalización es el punto: comparar sábados contra lunes en un rango de
 * 60 días compara 9 sábados contra 8 lunes, y la diferencia incluiría el
 * calendario. La RPC ya divide por cuántos días de cada tipo hubo en el rango.
 */
function reducirMomento(
  data: Record<string, unknown> | null,
): MomentoDelDia | null {
  const dias = (data?.por_dia_semana ?? []) as Record<string, unknown>[];
  const conVentas = dias.filter((d) => num(d.dias_en_el_rango) > 0);
  if (conVentas.length < 2) return null;

  const ordenados = [...conVentas].sort(
    (a, b) => num(b.ventas_por_dia) - num(a.ventas_por_dia),
  );
  const fuerte = ordenados[0];
  const flojo = ordenados[ordenados.length - 1];

  const ventasPorDiaFuerte = num(fuerte.ventas_por_dia);
  if (ventasPorDiaFuerte <= 0) return null;

  return {
    diaFuerte: String(fuerte.dia ?? ""),
    ventasPorDiaFuerte,
    diaFlojo: String(flojo.dia ?? ""),
    ventasPorDiaFlojo: num(flojo.ventas_por_dia),
  };
}

/**
 * Clientes donde el libro de cuenta corriente (Σ débitos − Σ créditos) no
 * coincide con `clientes.saldo_pendiente`. Es el control de calidad de la
 * propia señal de antigüedad: si crece, la antigüedad deja de cerrar contra el
 * saldo que ve la dueña.
 */
function reducirDescuadre(
  data: Record<string, unknown> | null,
): CuentaCorrienteDescuadrada | null {
  if (!data) return null;
  const clientes = num(data.clientes_descuadrados);
  if (clientes <= 0) return null;

  return { clientes, clientesConDeuda: num(data.clientes_con_deuda) };
}

export async function getSenalesInsightsAction(
  desde: string,
  hasta: string,
): Promise<SenalesInsights> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [metodos, curva, margen, ticket, momento, cc] = await Promise.all([
    rpcGerencial(supabase, "rentabilidad_por_metodo", desde, hasta),
    rpcGerencial(supabase, "curva_de_precio", desde, hasta),
    rpcGerencial(supabase, "margen_realizado", desde, hasta),
    rpcGerencial(supabase, "composicion_ticket", desde, hasta),
    rpcGerencial(supabase, "ventas_por_momento", desde, hasta),
    // La antigüedad de cuenta corriente es una FOTO de ahora: el saldo de un
    // cliente no tiene versión "de julio". Por eso NO recibe el rango, y por
    // eso va por `correrSenal` y no por `rpcGerencial` — su firma es
    // `p_limite`, no `p_desde/p_hasta`. Pasarle el rango era lo que la hacía
    // devolver 404 en cada carga del panel: PostgREST resuelve la función por
    // el NOMBRE DE LOS ARGUMENTOS, así que una firma que no coincide no es un
    // parámetro ignorado, es una función que no existe.
    correrSenal(supabase, "antiguedad_saldo_cc", {}),
  ]);

  return {
    metodoQuePierde: reducirMetodos(metodos),
    descuentosResignados: reducirDescuentos(curva),
    renglonesSinCosto: reducirSinCosto(margen),
    renglonAdicional: reducirRenglonAdicional(ticket),
    momentoDelDia: reducirMomento(momento),
    cuentaCorrienteDescuadrada: reducirDescuadre(cc),
  };
}
