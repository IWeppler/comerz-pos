"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";

import {
  CATEGORIAS_GASTO,
  type CategoriaGasto,
  type TipoGasto,
} from "@/features/admin/lib/categorias-gasto";
import { usdAPesos } from "@/features/admin/lib/cotizacion-mep";
import { getCotizacionMepAction } from "@/features/admin/actions/cotizacion-mep";
import type { Moneda } from "@/features/admin/lib/finanzas-comerz";

export interface GastoComerz {
  id: string;
  mes: string;
  hasta: string | null;
  tipo: TipoGasto;
  categoria: CategoriaGasto;
  concepto: string;
  /** Siempre en PESOS (para un gasto en USD, el equivalente al cargarlo). */
  monto: number;
  nota: string | null;
  moneda: Moneda;
  /** Monto original en dólares, si `moneda` es USD. */
  montoUsd: number | null;
  /** MEP con que se cargó, si `moneda` es USD. */
  cotizacion: number | null;
  /** Comercio y cobro que originan una comisión. */
  negocioOrigenId: string | null;
  pagoOrigenId: string | null;
}

/** Primer día del mes de una fecha, en UTC y como "YYYY-MM-01". */
function primerDiaDelMes(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * TODOS los gastos anotados.
 *
 * No filtra por mes a propósito: un gasto FIJO no tiene una fila por mes sino
 * UNA que aplica a un rango, así que "los de marzo" es una cuenta y no una
 * consulta. Esa cuenta vive en `gastos-por-mes.ts`, con tests, y la usan tanto
 * el gráfico (doce meses) como el resumen del mes en curso.
 *
 * Son las filas de un solo negocio —el propio— así que traerlas todas no es
 * un problema de volumen: son decenas, no miles.
 */
export async function getGastosAction(): Promise<GastoComerz[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("gastos_comerz")
    .select(
      "id, mes, hasta, tipo, categoria, concepto, monto, nota, moneda, monto_usd, cotizacion_mep, negocio_origen_id, pago_origen_id",
    )
    .order("mes", { ascending: false })
    .order("concepto");

  if (error) {
    console.error("[GASTOS COMERZ] No se pudieron leer:", error);
    return [];
  }

  return (data ?? []).map((g) => ({
    id: g.id as string,
    mes: g.mes as string,
    hasta: (g.hasta as string | null) ?? null,
    tipo: g.tipo as TipoGasto,
    categoria: g.categoria as CategoriaGasto,
    concepto: g.concepto as string,
    monto: Number(g.monto ?? 0),
    nota: (g.nota as string | null) ?? null,
    moneda: g.moneda === "USD" ? "USD" : "ARS",
    montoUsd: g.monto_usd === null || g.monto_usd === undefined ? null : Number(g.monto_usd),
    cotizacion:
      g.cotizacion_mep === null || g.cotizacion_mep === undefined
        ? null
        : Number(g.cotizacion_mep),
    negocioOrigenId: (g.negocio_origen_id as string | null) ?? null,
    pagoOrigenId: (g.pago_origen_id as string | null) ?? null,
  }));
}

export interface EstadoGasto {
  error: string | null;
  success: boolean;
}

const CATEGORIAS_VALIDAS = new Set<string>(
  CATEGORIAS_GASTO.map((c) => c.valor),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COTIZACION_MAXIMA = 1_000_000;

type SupabaseServidor = ReturnType<typeof createClient>;

interface Dinero {
  monto: number;
  moneda: Moneda;
  montoUsd: number | null;
  cotizacion: number | null;
}

/**
 * Cuánto es el gasto en pesos y en su moneda, validado en el SERVER.
 *
 * En dólares, la cotización NUNCA la manda el navegador como verdad: sale del
 * MEP que lee el servidor, o de un valor manual que se valida (rango) — el
 * monto en pesos lo calcula acá. Si no hay cotización disponible no se
 * inventa: se pide cargarlo en pesos o reintentar.
 *
 * Al EDITAR un gasto que ya estaba en dólares se conserva su cotización: un
 * cambio de concepto o de nota no tiene que repreciar el gasto al dólar de hoy.
 */
async function leerDinero(
  formData: FormData,
  cotizacionPrevia: number | null,
): Promise<Dinero | { error: string }> {
  const moneda: Moneda = formData.get("moneda") === "USD" ? "USD" : "ARS";
  const importe = Number(formData.get("monto"));
  if (!Number.isFinite(importe) || importe <= 0) {
    return { error: "El monto no es válido." };
  }
  if (moneda === "ARS") {
    return { monto: importe, moneda, montoUsd: null, cotizacion: null };
  }

  const manual = Number(formData.get("cotizacion"));
  let cotizacion: number | null = null;
  if (Number.isFinite(manual) && manual > 0) {
    if (manual > COTIZACION_MAXIMA) return { error: "La cotización no es válida." };
    cotizacion = manual;
  } else if (cotizacionPrevia !== null) {
    cotizacion = cotizacionPrevia;
  } else {
    const mep = await getCotizacionMepAction();
    if (!mep) {
      return {
        error:
          "No pude leer el dólar MEP ahora. Cargalo en pesos o probá en un rato.",
      };
    }
    cotizacion = mep.venta;
  }

  return {
    monto: usdAPesos(importe, cotizacion),
    moneda,
    montoUsd: importe,
    cotizacion,
  };
}

/**
 * El comercio y el cobro que originan una comisión. Solo valen en la categoría
 * `comision` (la base lo exige) y el cobro tiene que ser de ESE comercio:
 * validado contra la base, no contra lo que mandó el formulario.
 */
async function leerOrigen(
  supabase: SupabaseServidor,
  formData: FormData,
  categoria: string,
): Promise<
  { negocioOrigenId: string | null; pagoOrigenId: string | null } | { error: string }
> {
  const sinOrigen = { negocioOrigenId: null, pagoOrigenId: null };
  if (categoria !== "comision") return sinOrigen;

  const negocio = ((formData.get("negocio_origen_id") as string) ?? "").trim();
  const pago = ((formData.get("pago_origen_id") as string) ?? "").trim();
  if (!negocio && !pago) return sinOrigen;
  if (!UUID.test(negocio) || (pago && !UUID.test(pago))) {
    return { error: "El comercio o el cobro de la comisión no son válidos." };
  }

  if (pago) {
    const { data, error } = await supabase
      .from("pagos_suscripcion")
      .select("id")
      .eq("id", pago)
      .eq("negocio_id", negocio)
      .maybeSingle();
    if (error || !data) {
      return { error: "Ese cobro no es de ese comercio." };
    }
  }
  return { negocioOrigenId: negocio, pagoOrigenId: pago || null };
}

/**
 * Anota un gasto.
 *
 * INSERT y no upsert, al revés que la versión vieja: antes había una fila por
 * proveedor y por mes, y volver a cargar Vercel corregía la anterior. Ahora un
 * mes puede tener varios gastos de la misma categoría —tres campañas de
 * marketing distintas son tres gastos, no una corrección— así que cada uno es
 * su propia fila.
 *
 * (La versión vieja además declaraba `onConflict: "mes,proveedor"` sobre un
 * índice único que no existía: habría fallado en el primer uso real.)
 */
export async function registrarGastoAction(
  _prev: EstadoGasto | null,
  formData: FormData,
): Promise<EstadoGasto> {
  const concepto = ((formData.get("concepto") as string) ?? "").trim();
  const tipo = (formData.get("tipo") as string) || "UNICO";
  const categoria = (formData.get("categoria") as string) || "otro";
  const nota = ((formData.get("nota") as string) ?? "").trim() || null;
  const mes = (formData.get("mes") as string) || primerDiaDelMes(new Date());

  if (!concepto) return { error: "Poné un concepto.", success: false };
  // Se validan acá aunque el form ya los limite: un select es una sugerencia
  // del navegador, no un control. La base tiene además su CHECK.
  if (tipo !== "FIJO" && tipo !== "UNICO") {
    return { error: "Tipo de gasto inválido.", success: false };
  }
  if (!CATEGORIAS_VALIDAS.has(categoria)) {
    return { error: "Categoría inválida.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: esSuper } = await supabase.rpc("is_super_admin");
  if (!esSuper) return { error: "No autorizado.", success: false };

  const dinero = await leerDinero(formData, null);
  if ("error" in dinero) return { error: dinero.error, success: false };
  const origen = await leerOrigen(supabase, formData, categoria);
  if ("error" in origen) return { error: origen.error, success: false };

  const { error } = await supabase.from("gastos_comerz").insert({
    mes,
    tipo,
    categoria,
    concepto,
    monto: dinero.monto,
    moneda: dinero.moneda,
    monto_usd: dinero.montoUsd,
    cotizacion_mep: dinero.cotizacion,
    negocio_origen_id: origen.negocioOrigenId,
    pago_origen_id: origen.pagoOrigenId,
    nota,
    registrado_por: user?.id ?? null,
  });

  if (error) {
    console.error("[GASTOS COMERZ]", error);
    return { error: "No se pudo guardar el gasto.", success: false };
  }

  revalidatePath("/admincomerz");
  return { error: null, success: true };
}

/**
 * Corrige un gasto ya anotado.
 *
 * Acepta `hasta` porque es la forma correcta de terminar un gasto FIJO: se le
 * pone el último mes en que aplicó y listo. Borrarlo también se puede (ver
 * abajo), pero son cosas distintas — dar de baja conserva la historia, borrar
 * la reescribe.
 */
export async function actualizarGastoAction(
  _prev: EstadoGasto | null,
  formData: FormData,
): Promise<EstadoGasto> {
  const id = (formData.get("id") as string) || "";
  const concepto = ((formData.get("concepto") as string) ?? "").trim();
  const tipo = (formData.get("tipo") as string) || "UNICO";
  const categoria = (formData.get("categoria") as string) || "otro";
  const nota = ((formData.get("nota") as string) ?? "").trim() || null;
  const hastaCrudo = ((formData.get("hasta") as string) ?? "").trim();

  if (!id) return { error: "Falta el gasto a editar.", success: false };
  if (!concepto) return { error: "Poné un concepto.", success: false };
  if (tipo !== "FIJO" && tipo !== "UNICO") {
    return { error: "Tipo de gasto inválido.", success: false };
  }
  if (!CATEGORIAS_VALIDAS.has(categoria)) {
    return { error: "Categoría inválida.", success: false };
  }

  // La base tiene un CHECK que impide `hasta` en un ÚNICO. Se limpia acá para
  // no depender de que el form haya escondido el campo: si el tipo cambió a
  // ÚNICO en la misma edición, el `hasta` viejo tiene que irse con él.
  const hasta = tipo === "FIJO" && hastaCrudo ? hastaCrudo : null;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: esSuper } = await supabase.rpc("is_super_admin");
  if (!esSuper) return { error: "No autorizado.", success: false };

  // La cotización con que se cargó se conserva si sigue en dólares.
  const { data: actual } = await supabase
    .from("gastos_comerz")
    .select("moneda, cotizacion_mep")
    .eq("id", id)
    .maybeSingle();
  const cotizacionPrevia =
    actual?.moneda === "USD" && actual.cotizacion_mep !== null
      ? Number(actual.cotizacion_mep)
      : null;

  const dinero = await leerDinero(formData, cotizacionPrevia);
  if ("error" in dinero) return { error: dinero.error, success: false };
  const origen = await leerOrigen(supabase, formData, categoria);
  if ("error" in origen) return { error: origen.error, success: false };

  // `.select("id")` y chequeo de filas: un UPDATE filtrado por RLS es un éxito
  // silencioso con 0 filas.
  const { data: filas, error } = await supabase
    .from("gastos_comerz")
    .update({
      concepto,
      monto: dinero.monto,
      moneda: dinero.moneda,
      monto_usd: dinero.montoUsd,
      cotizacion_mep: dinero.cotizacion,
      negocio_origen_id: origen.negocioOrigenId,
      pago_origen_id: origen.pagoOrigenId,
      tipo,
      categoria,
      nota,
      hasta,
    })
    .eq("id", id)
    .select("id");

  if (error || !filas || filas.length === 0) {
    console.error("[GASTOS COMERZ] update", error);
    return { error: "No se pudo guardar el cambio.", success: false };
  }

  revalidatePath("/admincomerz");
  return { error: null, success: true };
}

/**
 * Borra un gasto.
 *
 * Existe para corregir un error de carga —un monto mal tipeado, un gasto
 * duplicado—, no para terminar un gasto fijo. Para eso está `hasta`: borrar un
 * FIJO cambia el margen de TODOS los meses en que estuvo vigente, y un mes ya
 * cerrado no debería cambiar de resultado el año que viene.
 */
export async function eliminarGastoAction(id: string): Promise<EstadoGasto> {
  if (!id) return { error: "Falta el gasto a borrar.", success: false };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: esSuper } = await supabase.rpc("is_super_admin");
  if (!esSuper) return { error: "No autorizado.", success: false };

  const { error } = await supabase.from("gastos_comerz").delete().eq("id", id);

  if (error) {
    console.error("[GASTOS COMERZ] delete", error);
    return { error: "No se pudo borrar el gasto.", success: false };
  }

  revalidatePath("/admincomerz");
  return { error: null, success: true };
}
