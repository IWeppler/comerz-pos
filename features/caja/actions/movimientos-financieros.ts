"use server";

import { cookies } from "next/headers";
import * as XLSX from "xlsx";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { formatearNumeroComprobante } from "@/shared/lib/facturacion";
import { etiquetaMovimiento } from "../lib/movimiento-financiero";
import { esMovimientoDeCuentas } from "../lib/movimiento-de-cuentas";

/**
 * La tabla general de movimientos (`movimientos_financieros_negocio`,
 * `20260921230000`): una fila por movimiento del ledger, de todas las
 * cuentas, con lo que hace falta para leerla sin abrir otra pantalla.
 *
 * Todo lo que importa lo decide la RPC: el saldo posterior se calcula sobre
 * el ledger ENTERO de la cuenta antes de filtrar (si no, sería el saldo "de
 * lo que se ve"), la categoría se lee viva de `egresos`, el método sale del
 * snapshot congelado del cobro, y se pagina antes de enriquecer. Acá solo se
 * traducen los filtros y se tipa la respuesta.
 *
 * Los filtros viajan como llegan; el tope de 200 lo recorta la base porque
 * el número viene del navegador.
 */

export type OrigenMovimiento =
  | "VENTA_PAGO"
  | "EGRESO"
  | "TRANSFERENCIA"
  | "ACREDITACION"
  | "TURNO_CAJA"
  | "AJUSTE"
  | "INGRESO";

export type MovimientoFinancieroFila = {
  id: number;
  /** Fecha ECONÓMICA del movimiento: la que define el saldo. */
  fecha: string;
  /** Cuándo se escribió la fila. Difiere de `fecha` en correcciones y
   * anulaciones, que se fechan en el egreso original. */
  registrado_en: string;
  evento: string;
  origen_tipo: OrigenMovimiento | string;
  origen_id: string;
  operacion_id: string;
  importe: number | string;
  impacto_resultado: number | string;
  saldo_posterior: number | string;
  descripcion: string | null;
  cuenta_id: string;
  cuenta_nombre: string;
  cuenta_tipo: string;
  /** En una transferencia, la otra cuenta ("→ Mercado Pago"). */
  cuenta_contraparte_nombre: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  /** El TIPO del origen, cuando lo tiene: en egresos OPERATIVO |
   * RETIRO_SOCIO | COMPRA_MERCADERIA | DEVOLUCION; en ingresos libres
   * APORTE_SOCIO | PRESTAMO | INGRESO_EXTRAORDINARIO (la RPC lo lee de
   * `datos->>'tipo'`, que los dos escriben). El nombre quedó del primer
   * consumidor. */
  egreso_tipo: string | null;
  metodo_pago_id: string | null;
  metodo_nombre: string | null;
  metodo_tipo: string | null;
  usuario_id: string | null;
  usuario_nombre: string | null;
  turno_caja_id: string | null;
  venta_id: string | null;
  cliente_nombre: string | null;
  /** Crudo: se formatea con `formatearNumeroComprobante`. Sin comprobante,
   * la pantalla cae al prefijo del UUID de la venta, como el ticket. */
  comprobante_tipo: string | null;
  comprobante_punto_venta: number | null;
  comprobante_numero: number | null;
  orden_compra_id: string | null;
  proveedor: string | null;
  /** Si el movimiento es la reversa de una transferencia, la original. */
  revierte_a: string | null;
  /** Cuántos movimientos reales hay detrás de la fila: 1 en todo lo que no se
   * consolidó, N en una fila "Cobros del día". La pantalla lo usa para decir
   * "9 cobros" en vez de inventar una descripción. Puede faltar mientras la
   * migración de `p_vista` no esté aplicada. */
  cantidad?: number;
};

/**
 * Qué tabla se está pidiendo. `COMPLETA` es una fila por movimiento del
 * ledger; `CUENTAS` es la vista de Dinero — los cobros de venta entran
 * consolidados por cuenta y por día, y el detalle del cajón queda afuera
 * porque ya se ve en el turno. El corte lo hace la BASE: consolidar desde acá
 * dejaría el `total` de la paginación contando filas que no se muestran.
 */
export type VistaMovimientos = "COMPLETA" | "CUENTAS";

export type FiltrosMovimientos = {
  /** ISO. `hasta` es exclusivo. */
  desde?: string | null;
  hasta?: string | null;
  cuentaId?: string | null;
  origenTipos?: OrigenMovimiento[] | null;
  categoriaId?: string | null;
  /** Solo gastos operativos sin categoría. Excluyente con `categoriaId`. */
  sinCategoria?: boolean;
  metodoPagoId?: string | null;
  usuarioId?: string | null;
  busqueda?: string | null;
  limite?: number;
  offset?: number;
  vista?: VistaMovimientos;
};

export type PaginaMovimientos = {
  total: number;
  filas: MovimientoFinancieroFila[];
};

export async function getMovimientosFinancierosAction(
  filtros: FiltrosMovimientos = {},
): Promise<{ data: PaginaMovimientos | null; error: string | null }> {
  const supabase = createClient(await cookies());
  const argumentos = {
    p_desde: filtros.desde ?? null,
    p_hasta: filtros.hasta ?? null,
    p_cuenta_id: filtros.cuentaId ?? null,
    p_origen_tipos: filtros.origenTipos?.length ? filtros.origenTipos : null,
    p_categoria_id: filtros.categoriaId ?? null,
    p_sin_categoria: Boolean(filtros.sinCategoria),
    p_metodo_pago_id: filtros.metodoPagoId ?? null,
    p_usuario_id: filtros.usuarioId ?? null,
    p_busqueda: filtros.busqueda ?? null,
    p_limite: filtros.limite ?? 100,
    p_offset: filtros.offset ?? 0,
  };

  let { data, error } = await supabase.rpc("movimientos_financieros_negocio", {
    ...argumentos,
    p_vista: filtros.vista ?? "COMPLETA",
  });

  // Compatibilidad de despliegue: la app puede salir antes que la migración
  // que agrega `p_vista`. Sin esto, la pantalla entera devuelve PGRST202 (la
  // firma no existe) en vez de degradar. Mismo patrón que
  // `getPosicionDineroAction` con `posicion_dinero_ledger`.
  //
  // Lo que se pierde mientras tanto es la consolidación, no la exactitud: se
  // ven los cobros uno por uno, que es lo que se ve hoy.
  if (error?.code === "PGRST202") {
    console.warn(
      "movimientos_financieros_negocio todavía no acepta p_vista; se pide la vista completa.",
    );
    ({ data, error } = await supabase.rpc(
      "movimientos_financieros_negocio",
      argumentos,
    ));
  }

  if (error) {
    console.error("Error cargando movimientos financieros:", error);
    const mensaje = error.message.includes("SIN_PERMISO")
      ? "No tenés permiso para ver los movimientos."
      : "No se pudieron cargar los movimientos.";
    return { data: null, error: mensaje };
  }

  const pagina = (data ?? { total: 0, filas: [] }) as PaginaMovimientos;
  return { data: pagina, error: null };
}

export type UsuarioFiltro = { id: string; nombre: string };

/**
 * Usuarios para el filtro "Usuario" de la tabla general.
 *
 * OJO — límite conocido: `usuarios_negocios` no tiene policy de aislamiento
 * por negocio para cualquier miembro, solo `usuario_id = auth.uid()` (ver
 * `usuarios_negocios_select_propio`) o `is_admin()`. Un ADMIN ve a todo el
 * equipo; alguien con `caja.ver_movimientos` pero SIN ser admin (hoy, un
 * ENCARGADO de un solo negocio) ve solo su propia fila. No es un bug: el
 * filtro queda angosto para ese caso en vez de fallar, y ensancharlo pide
 * una RPC propia que no existe todavía.
 */
export async function getUsuariosDelNegocioAction(): Promise<UsuarioFiltro[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("usuarios_negocios")
    .select("usuario_id, perfiles(nombre)")
    .order("usuario_id");

  if (error) {
    console.error("Error cargando usuarios del negocio:", error);
    return [];
  }

  return (data ?? [])
    .map((fila) => {
      const perfil = Array.isArray(fila.perfiles)
        ? fila.perfiles[0]
        : fila.perfiles;
      return { id: fila.usuario_id as string, nombre: perfil?.nombre || "Sin nombre" };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export type MetodoPagoFiltro = { id: string; nombre: string };

/** Métodos de pago para el filtro "Método". Lectura simple: `metodos_pago`
 * es legible por cualquier autenticado del negocio (sin restricción de fila
 * más allá del aislamiento por negocio_id). */
export async function getMetodosPagoParaFiltroAction(): Promise<
  MetodoPagoFiltro[]
> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("metodos_pago")
    .select("id, nombre")
    .order("nombre");

  if (error) {
    console.error("Error cargando métodos de pago:", error);
    return [];
  }
  return (data ?? []) as MetodoPagoFiltro[];
}

export interface ResultadoExportacionMovimientos {
  error: string | null;
  archivoBase64?: string;
  nombreArchivo?: string;
  filas?: number;
  /** true si había más filas de las que se exportaron (tope de seguridad). */
  truncado?: boolean;
}

const TOPE_PAGINA_EXPORT = 200; // el mismo tope que recorta la RPC.
const TOPE_PAGINAS_EXPORT = 25; // 5.000 filas como mucho por descarga.

/**
 * Exporta a Excel EXACTAMENTE lo que la tabla general tiene filtrado: mismos
* filtros, mismo orden. Pagina la RPC hasta 5.000 filas (25 páginas de 200,
* su tope) — hoy el negocio con más movimientos del SaaS (Evens) tiene 2.595
* en TODA su historia, así que el tope es un techo de seguridad, no un límite
* que alguien vaya a chocar mañana.
*
* Se arma en el SERVER, no en el cliente: los datos ya vienen filtrados por
* RLS y por el permiso de la RPC, armar el libro acá evita mandar filas de
* más al navegador para después tirarlas.
 */
export async function exportarMovimientosAction(
  filtros: FiltrosMovimientos = {},
): Promise<ResultadoExportacionMovimientos> {
  const supabase = createClient(await cookies());

  if (!(await tienePermiso(supabase, PERMISOS.CAJA_VER_MOVIMIENTOS))) {
    return { error: "No tenés permiso para exportar los movimientos." };
  }

  const filas: MovimientoFinancieroFila[] = [];
  let total = Infinity;
  // Pagina por la MISMA action que usa la tabla, y no por una llamada propia
  // a la RPC: así hereda los filtros, la vista y el fallback de `p_vista` sin
  // que haya dos lugares donde acordarse de agregar un parámetro. Es lo que
  // garantiza que el Excel diga exactamente lo que se ve en pantalla.
  for (let pagina = 0; pagina < TOPE_PAGINAS_EXPORT && filas.length < total; pagina++) {
    const { data, error } = await getMovimientosFinancierosAction({
      ...filtros,
      limite: TOPE_PAGINA_EXPORT,
      offset: pagina * TOPE_PAGINA_EXPORT,
    });
    if (error || !data) {
      console.error("Error exportando movimientos financieros:", error);
      return { error: "No se pudo armar la exportación." };
    }
    total = data.total;
    filas.push(...data.filas);
    if (data.filas.length < TOPE_PAGINA_EXPORT) break;
  }

  if (filas.length === 0) {
    return { error: "No hay movimientos con estos filtros." };
  }

  const filasPlanas = filas.map((f) => ({
    Fecha: new Date(f.fecha).toLocaleString("es-AR"),
    Concepto: f.descripcion ?? "",
    Tipo: etiquetaMovimiento(f.origen_tipo, f.evento, Number(f.importe)),
    Categoria: f.categoria_nombre ?? "",
    Cuenta: f.cuenta_nombre,
    Metodo: f.metodo_nombre ?? "",
    // Cuántos movimientos hay detrás de la fila: 1 salvo en los cobros
    // consolidados por día. Sin esta columna, un contador que suma el Excel
    // no tiene cómo saber que una línea son nueve cobros.
    Movimientos: f.cantidad ?? 1,
    Importe: Number(f.importe),
    "Saldo posterior": Number(f.saldo_posterior),
    Usuario: f.usuario_nombre ?? "",
    Cliente: f.cliente_nombre ?? "",
    Comprobante:
      formatearNumeroComprobante(f.comprobante_punto_venta, f.comprobante_numero) ??
      "",
    Proveedor: f.proveedor ?? "",
  }));

  const hoja = XLSX.utils.json_to_sheet(filasPlanas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Movimientos");
  const buffer = XLSX.write(libro, { type: "base64", bookType: "xlsx" });

  const hoy = new Date().toISOString().slice(0, 10);
  return {
    error: null,
    archivoBase64: buffer,
    nombreArchivo: `movimientos_${hoy}.xlsx`,
    filas: filas.length,
    truncado: filas.length < total,
  };
}

export type FiltrosActividadCuentas = {
  busqueda?: string | null;
  origenTipo?: Extract<OrigenMovimiento, "INGRESO" | "EGRESO" | "TRANSFERENCIA"> | null;
  cuentaId?: string | null;
  limite?: number;
  offset?: number;
};

/**
 * La tabla "Actividad de cuentas" de la pestaña Dinero. Usa la MISMA vista
 * consolidada que la tabla completa, pero ofrece solo los filtros cotidianos
 * de este contexto: texto y clase de operación.
 *
 * `esMovimientoDeCuentas` sigue como espejo defensivo para el intervalo de
 * despliegue en que el código puede salir antes que la RPC con `p_vista`.
 */
export async function getActividadDeCuentasAction(
  filtros: FiltrosActividadCuentas = {},
): Promise<{ data: PaginaMovimientos | null; error: string | null }> {
  const limite = filtros.limite ?? 10;
  const { data, error } = await getMovimientosFinancierosAction({
    vista: "CUENTAS",
    busqueda: filtros.busqueda,
    origenTipos: filtros.origenTipo ? [filtros.origenTipo] : null,
    cuentaId: filtros.cuentaId,
    limite,
    offset: filtros.offset ?? 0,
  });

  if (error || !data) return { data: null, error: error ?? "" };

  const filas = data.filas.filter((f) =>
    esMovimientoDeCuentas(f.origen_tipo, f.cuenta_tipo),
  );
  return {
    data: { total: data.total, filas },
    error: null,
  };
}
