"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { FRECUENCIAS, type Frecuencia } from "../lib/egreso-programado";

/**
 * La agenda de gastos que se repiten (`20260923120000`).
 *
 * Nada de acá mueve plata. Lo único que registra un egreso es
 * `confirmarEgresoProgramadoAction`, y lo hace por el camino de siempre: la
 * RPC es SECURITY INVOKER, así que pasa por la policy de `egresos` y por sus
 * triggers (cuenta por defecto, turno obligatorio si se arquea, bitácora).
 */

export type EgresoProgramado = {
  id: string;
  concepto: string;
  monto: number;
  tipo: string;
  categoria_id: string | null;
  categoria_nombre: string | null;
  cuenta_origen_id: string | null;
  cuenta_nombre: string | null;
  frecuencia: string;
  proxima_fecha: string;
  dia_ancla: number | null;
  activo: boolean;
};

type Fila = Omit<EgresoProgramado, "categoria_nombre" | "cuenta_nombre"> & {
  categorias_egreso: { nombre: string } | { nombre: string }[] | null;
  cuentas_financieras: { nombre: string } | { nombre: string }[] | null;
};

const unaRelacion = (v: { nombre: string } | { nombre: string }[] | null) =>
  (Array.isArray(v) ? v[0] : v)?.nombre ?? null;

/**
 * Toda la agenda del negocio, vencidos primero.
 *
 * Trae también los dados de baja: sin ellos, un programado que se desactivó
 * por error desaparece y la única salida es cargarlo de nuevo — que es cómo se
 * termina con el alquiler dos veces en la lista.
 */
export async function getEgresosProgramadosAction(): Promise<
  EgresoProgramado[]
> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("egresos_programados")
    .select(
      "id, concepto, monto, tipo, categoria_id, cuenta_origen_id, frecuencia, proxima_fecha, dia_ancla, activo, categorias_egreso(nombre), cuentas_financieras(nombre)",
    )
    .order("activo", { ascending: false })
    .order("proxima_fecha", { ascending: true });

  if (error) {
    console.error("Error cargando los egresos programados:", error);
    return [];
  }

  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
    concepto: f.concepto,
    monto: Number(f.monto),
    tipo: f.tipo,
    categoria_id: f.categoria_id,
    categoria_nombre: unaRelacion(f.categorias_egreso),
    cuenta_origen_id: f.cuenta_origen_id,
    cuenta_nombre: unaRelacion(f.cuentas_financieras),
    frecuencia: f.frecuencia,
    proxima_fecha: f.proxima_fecha,
    dia_ancla: f.dia_ancla,
    activo: f.activo,
  }));
}

type Resultado = { error: string | null; success: boolean };

function leerFormulario(formData: FormData) {
  const concepto = String(formData.get("concepto") ?? "").trim();
  const monto = Number(formData.get("monto"));
  const frecuencia = String(formData.get("frecuencia") ?? "") as Frecuencia;
  const proximaFecha = String(formData.get("proxima_fecha") ?? "");
  const tipo = String(formData.get("tipo") ?? "OPERATIVO");
  // Espejo del CHECK: solo un gasto OPERATIVO lleva categoría. Se descarta en
  // silencio en vez de rebotar, igual que en `registrarEgresoAction`.
  const categoriaId =
    tipo === "OPERATIVO"
      ? String(formData.get("categoria_id") ?? "") || null
      : null;
  const cuentaOrigenId = String(formData.get("cuenta_origen_id") ?? "") || null;

  return { concepto, monto, frecuencia, proximaFecha, tipo, categoriaId, cuentaOrigenId };
}

function validar(datos: ReturnType<typeof leerFormulario>): string | null {
  if (!datos.concepto) return "Ingresá un concepto.";
  if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
    return "Ingresá un monto mayor a cero.";
  }
  if (!FRECUENCIAS.includes(datos.frecuencia)) {
    return "Elegí cada cuánto se repite.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.proximaFecha)) {
    return "Elegí la fecha del próximo vencimiento.";
  }
  if (!["OPERATIVO", "RETIRO_SOCIO", "COMPRA_MERCADERIA"].includes(datos.tipo)) {
    // Una devolución la generan `anular_venta` y `registrar_devolucion` a
    // partir de una venta: no hay forma de programarla.
    return "Ese tipo de gasto no se puede programar.";
  }
  return null;
}

export async function crearEgresoProgramadoAction(
  _prev: Resultado,
  formData: FormData,
): Promise<Resultado> {
  const datos = leerFormulario(formData);
  const problema = validar(datos);
  if (problema) return { error: problema, success: false };

  const supabase = createClient(await cookies());

  const { error } = await supabase.from("egresos_programados").insert({
    concepto: datos.concepto,
    monto: datos.monto,
    tipo: datos.tipo,
    categoria_id: datos.categoriaId,
    cuenta_origen_id: datos.cuentaOrigenId,
    frecuencia: datos.frecuencia,
    proxima_fecha: datos.proximaFecha,
    // El ancla sale del día que eligió el comercio. Es lo que hace que una
    // mensual del 31 vuelva al 31 después de pasar por febrero.
    dia_ancla:
      datos.frecuencia === "SEMANAL" ||
      datos.frecuencia === "QUINCENAL" ||
      datos.frecuencia === "UNICO"
        ? null
        : Number(datos.proximaFecha.slice(8, 10)),
  });

  if (error) {
    console.error("Error creando el egreso programado:", error);
    return {
      error: error.code === "42501"
        ? "Solo una administradora puede programar gastos."
        : "No se pudo guardar el gasto programado.",
      success: false,
    };
  }

  revalidatePath("/caja");
  return { error: null, success: true };
}

export async function actualizarEgresoProgramadoAction(
  id: string,
  formData: FormData,
): Promise<Resultado> {
  const datos = leerFormulario(formData);
  const problema = validar(datos);
  if (problema) return { error: problema, success: false };

  const supabase = createClient(await cookies());

  // `.select("id")` y chequeo de filas: un UPDATE que la RLS filtra vuelve con
  // 0 filas y `error: null`, o sea "guardado" en la pantalla y nada en la base.
  const { data, error } = await supabase
    .from("egresos_programados")
    .update({
      concepto: datos.concepto,
      monto: datos.monto,
      tipo: datos.tipo,
      categoria_id: datos.categoriaId,
      cuenta_origen_id: datos.cuentaOrigenId,
      frecuencia: datos.frecuencia,
      proxima_fecha: datos.proximaFecha,
      dia_ancla:
        datos.frecuencia === "SEMANAL" ||
        datos.frecuencia === "QUINCENAL" ||
        datos.frecuencia === "UNICO"
          ? null
          : Number(datos.proximaFecha.slice(8, 10)),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("Error actualizando el egreso programado:", error);
    return { error: "No se pudo guardar el cambio.", success: false };
  }
  if (!data || data.length === 0) {
    return {
      error: "Solo una administradora puede editar gastos programados.",
      success: false,
    };
  }

  revalidatePath("/caja");
  return { error: null, success: true };
}

/**
 * Dar de baja o reactivar.
 *
 * No se borra: la agenda de un comercio es su memoria de gastos fijos, y un
 * alquiler dado de baja por error se vuelve a prender en vez de tipearse de
 * nuevo con otro monto.
 */
export async function cambiarEstadoEgresoProgramadoAction(
  id: string,
  activo: boolean,
): Promise<Resultado> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("egresos_programados")
    .update({ activo })
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("Error cambiando el estado del programado:", error);
    return { error: "No se pudo cambiar el estado.", success: false };
  }
  if (!data || data.length === 0) {
    return {
      error: "Solo una administradora puede dar de baja gastos programados.",
      success: false,
    };
  }

  revalidatePath("/caja");
  return { error: null, success: true };
}

const MENSAJES: Record<string, string> = {
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
  PROGRAMADO_NO_ENCONTRADO: "Ese gasto programado ya no existe.",
  PROGRAMADO_DADO_DE_BAJA: "Ese gasto programado está dado de baja.",
  MONTO_INVALIDO: "Ingresá un monto mayor a cero.",
  CAJA_DIARIA_REQUIERE_TURNO_ABIERTO:
    "Ese gasto sale de una caja que se arquea: abrí el turno antes de confirmarlo.",
  EGRESO_SOLO_CATEGORIA_Y_CONCEPTO_EDITABLES:
    "Ese gasto ya está registrado y no se puede modificar.",
};

/**
 * Confirmar: se registra el gasto de verdad y la agenda avanza.
 *
 * El turno se resuelve ACÁ con el mismo helper que usa `registrarEgresoAction`
 * y viaja a la RPC. La regla de qué turno corresponde vive en un solo lugar;
 * la base vuelve a validarlo igual (el trigger de `20260921130000` exige que
 * el turno sea de esa cuenta y esté abierto).
 */
export async function confirmarEgresoProgramadoAction(
  id: string,
  opciones: {
    monto?: number | null;
    fechaPago?: string | null;
    cuentaOrigenId?: string | null;
  } = {},
): Promise<Resultado> {
  const supabase = createClient(await cookies());

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado.", success: false };

  // El mensaje amable. El freno real es la policy de `egresos`, que la RPC
  // atraviesa por ser SECURITY INVOKER.
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_REGISTRAR_EGRESO))) {
    return { error: "No tenés permiso para registrar gastos.", success: false };
  }

  const { turnoId } = await resolverTurnoActivo(supabase, user.id);

  const { error } = await supabase.rpc("confirmar_egreso_programado", {
    p_id: id,
    p_monto: opciones.monto ?? null,
    p_fecha_pago: opciones.fechaPago ?? null,
    p_cuenta_origen_id: opciones.cuentaOrigenId ?? null,
    p_turno_caja_id: turnoId,
  });

  if (error) {
    console.error("Error confirmando el egreso programado:", error);
    const clave = Object.keys(MENSAJES).find((k) => error.message?.includes(k));
    return {
      error: clave ? MENSAJES[clave] : "No se pudo registrar el gasto.",
      success: false,
    };
  }

  revalidatePath("/");
  revalidatePath("/caja");
  return { error: null, success: true };
}

/**
 * Omitir: corre la fecha SIN registrar nada.
 *
 * El mes que no se pagó, o que se pagó por fuera de Comerz. Sin esta salida,
 * un vencimiento que no corresponde registrar se queda vencido para siempre y
 * la dueña aprende a ignorar el aviso — que es cómo muere una agenda.
 */
export async function omitirEgresoProgramadoAction(
  id: string,
): Promise<Resultado> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("omitir_egreso_programado", {
    p_id: id,
  });

  if (error) {
    console.error("Error omitiendo el egreso programado:", error);
    const clave = Object.keys(MENSAJES).find((k) => error.message?.includes(k));
    return {
      error: clave ? MENSAJES[clave] : "No se pudo omitir el vencimiento.",
      success: false,
    };
  }

  revalidatePath("/caja");
  return { error: null, success: true };
}
