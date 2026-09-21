"use server";

import { cookies } from "next/headers";
import * as XLSX from "xlsx";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { formatearNumeroComprobante } from "@/shared/lib/facturacion";
import { etiquetaMovimiento } from "../lib/movimiento-financiero";

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
  | "AJUSTE";

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
  /** OPERATIVO | RETIRO_SOCIO | COMPRA_MERCADERIA | DEVOLUCION, solo en egresos. */
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
};

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
};

export type PaginaMovimientos = {
  total: number;
  filas: MovimientoFinancieroFila[];
};

export async function getMovimientosFinancierosAction(
  filtros: FiltrosMovimientos = {},
): Promise<{ data: PaginaMovimientos | null; error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("movimientos_financieros_negocio", {
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
  });

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
  for (let pagina = 0; pagina < TOPE_PAGINAS_EXPORT && filas.length < total; pagina++) {
    const { data, error } = await supabase.rpc("movimientos_financieros_negocio", {
      p_desde: filtros.desde ?? null,
      p_hasta: filtros.hasta ?? null,
      p_cuenta_id: filtros.cuentaId ?? null,
      p_origen_tipos: filtros.origenTipos?.length ? filtros.origenTipos : null,
      p_categoria_id: filtros.categoriaId ?? null,
      p_sin_categoria: Boolean(filtros.sinCategoria),
      p_metodo_pago_id: filtros.metodoPagoId ?? null,
      p_usuario_id: filtros.usuarioId ?? null,
      p_busqueda: filtros.busqueda ?? null,
      p_limite: TOPE_PAGINA_EXPORT,
      p_offset: pagina * TOPE_PAGINA_EXPORT,
    });
    if (error) {
      console.error("Error exportando movimientos financieros:", error);
      return { error: "No se pudo armar la exportación." };
    }
    const p = (data ?? { total: 0, filas: [] }) as PaginaMovimientos;
    total = p.total;
    filas.push(...p.filas);
    if (p.filas.length < TOPE_PAGINA_EXPORT) break;
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
