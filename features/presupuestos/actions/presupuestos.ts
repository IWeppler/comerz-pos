"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import {
  payloadRpc,
  renglonesDesdeCarrito,
  type RenglonCarrito,
  type RenglonCatalogo,
} from "../lib/renglones-desde-carrito";
import { mensajeErrorPresupuesto, esErrorConocido } from "../lib/errores";
import { moduloPresupuestosHabilitado } from "../lib/modulo-habilitado";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Modalidad = "AL_INICIO" | "AL_FINALIZAR";

export type CrearPresupuestoInput = {
  /** Lo genera el modal al abrirse: es la clave de idempotencia. */
  id: string;
  items: RenglonCarrito[];
  modalidad: Modalidad;
  clienteId?: string | null;
  clienteNombre?: string | null;
  vigenciaDias?: number | null;
  nota?: string | null;
};

export type CrearPresupuestoResultado =
  | { ok: true; id: string; numero: number; total: number; yaRegistrado: boolean }
  | { ok: false; error: string };

/**
 * Crea la cotización con `crear_presupuesto`, que es la ÚNICA puerta: las
 * tablas no tienen INSERT para `authenticated`. La RPC chequea módulo y
 * permiso y resuelve el precio; acá solo se arma el payload y se completa la
 * variante de los renglones que el carrito trajo sin id.
 */
export async function crearPresupuestoAction(
  input: CrearPresupuestoInput,
): Promise<CrearPresupuestoResultado> {
  if (!UUID.test(input?.id ?? "")) {
    return { ok: false, error: "La cotización no tiene identificador. Cerrá y volvé a abrir." };
  }
  if (input.modalidad !== "AL_INICIO" && input.modalidad !== "AL_FINALIZAR") {
    return { ok: false, error: "Elegí cuándo se entrega la mercadería." };
  }
  if (input.clienteId && !UUID.test(input.clienteId)) {
    return { ok: false, error: "El cliente elegido no es válido." };
  }

  const armado = renglonesDesdeCarrito(input.items);
  if (!armado.ok) return { ok: false, error: armado.error };

  const supabase = createClient(await cookies());

  // Renglones sin varianteId (un carrito viejo en localStorage): se
  // resuelven por nombre dentro de SU producto, igual que la venta. Si no
  // aparece, se falla con el nombre puesto: cotizar "el precio del producto"
  // a ciegas podría no ser el de la variante que el cliente eligió.
  const sinVariante = armado.renglones.filter(
    (r): r is RenglonCatalogo => r.tipo === "CATALOGO" && !r.varianteId,
  );
  const resueltas = new Map<RenglonCatalogo, string>();
  if (sinVariante.length > 0) {
    const productoIds = [...new Set(sinVariante.map((r) => r.productoId))];
    if (productoIds.some((id) => !UUID.test(id))) {
      return { ok: false, error: "Un producto del carrito no es válido." };
    }
    const { data: variantes, error } = await supabase
      .from("producto_variantes")
      .select("id, producto_id, nombre_display")
      .in("producto_id", productoIds);
    if (error) {
      console.error("[PRESUPUESTOS] Resolviendo variantes:", error);
      return { ok: false, error: "No se pudo leer el catálogo. Probá de nuevo." };
    }
    for (const r of sinVariante) {
      const deEste = (variantes ?? []).filter((v) => v.producto_id === r.productoId);
      const match =
        deEste.find((v) => v.nombre_display === r.varianteNombre) ??
        (deEste.length === 1 ? deEste[0] : undefined);
      if (!match) {
        return {
          ok: false,
          error: `No se encontró la variante de "${r.nombre}". Actualizá el catálogo y volvé a agregarlo.`,
        };
      }
      resueltas.set(r, match.id as string);
    }
  }

  const { data, error } = await supabase.rpc("crear_presupuesto", {
    p_id: input.id,
    p_items: payloadRpc(armado.renglones, (r) => r.varianteId ?? resueltas.get(r)!),
    p_modalidad_entrega: input.modalidad,
    p_cliente_id: input.clienteId || null,
    p_cliente_nombre: input.clienteId ? null : input.clienteNombre?.trim() || null,
    p_vigencia_dias: input.vigenciaDias ?? null,
    p_nota: input.nota?.trim() || null,
  });

  if (error) {
    if (!esErrorConocido(error)) console.error("[PRESUPUESTOS] crear_presupuesto:", error);
    return { ok: false, error: mensajeErrorPresupuesto(error) };
  }

  const r = data as { id: string; numero: number; total: number; ya_registrado: boolean };
  revalidatePath("/presupuestos");
  return {
    ok: true,
    id: r.id,
    numero: r.numero,
    total: Number(r.total),
    yaRegistrado: r.ya_registrado,
  };
}

export type PresupuestoResumen = {
  id: string;
  numero: number;
  estado: string;
  cliente_nombre: string | null;
  total: number;
  vigencia_hasta: string;
  creado_en: string;
  modalidad_entrega: Modalidad;
};

/** Últimas cotizaciones del negocio (la RLS ya filtra negocio y permiso). */
export async function listarPresupuestosAction(): Promise<{
  data: PresupuestoResumen[];
  error: string | null;
}> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("presupuestos")
    .select("id, numero, estado, cliente_nombre, total, vigencia_hasta, creado_en, modalidad_entrega")
    .order("creado_en", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[PRESUPUESTOS] listar:", error);
    return { data: [], error: "No se pudieron cargar las cotizaciones." };
  }
  return {
    data: (data ?? []).map((p) => ({ ...p, total: Number(p.total) })) as PresupuestoResumen[],
    error: null,
  };
}

export type PresupuestoDetalle = PresupuestoResumen & {
  cliente_telefono: string | null;
  tasas_financiacion: unknown;
  frecuencia: string;
  nota: string | null;
  vendedor_id: string;
  resuelto_en: string | null;
  items: {
    orden: number;
    descripcion: string;
    variante: string | null;
    unidad_medida: string;
    cantidad: number;
    precio_unitario: number;
    es_venta_libre: boolean;
  }[];
};

export async function obtenerPresupuestoAction(
  id: string,
): Promise<{ data: PresupuestoDetalle | null; error: string | null }> {
  if (!UUID.test(id)) return { data: null, error: "Cotización inexistente." };
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("presupuestos")
    .select(
      "id, numero, estado, cliente_nombre, cliente_telefono, total, vigencia_hasta, creado_en, modalidad_entrega, tasas_financiacion, frecuencia, nota, vendedor_id, resuelto_en, items:presupuestos_items(orden, descripcion, variante, unidad_medida, cantidad, precio_unitario, es_venta_libre)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[PRESUPUESTOS] detalle:", error);
    return { data: null, error: "No se pudo cargar la cotización." };
  }
  if (!data) return { data: null, error: null };
  const items = [...(data.items ?? [])]
    .sort((a, b) => a.orden - b.orden)
    .map((i) => ({ ...i, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario) }));
  return {
    data: { ...(data as unknown as PresupuestoDetalle), total: Number(data.total), items },
    error: null,
  };
}

/**
 * Rechazar (el cliente dijo que no) o anular (error de carga). Qué se puede
 * cambiar lo decide la trigger; quién, la policy (quien la hizo o un ADMIN).
 * Un UPDATE filtrado por RLS devuelve 0 filas sin error: se chequea.
 */
export async function cerrarPresupuestoAction(
  id: string,
  estado: "RECHAZADO" | "ANULADO",
): Promise<{ ok: boolean; error: string | null }> {
  if (!UUID.test(id)) return { ok: false, error: "Cotización inexistente." };
  if (estado !== "RECHAZADO" && estado !== "ANULADO") {
    return { ok: false, error: "Ese cambio de estado no está permitido." };
  }
  const supabase = createClient(await cookies());
  // Con el módulo apagado no se opera, aunque queden cotizaciones viejas.
  if (!(await moduloPresupuestosHabilitado(supabase))) {
    return { ok: false, error: mensajeErrorPresupuesto({ message: "MODULO_NO_HABILITADO" }) };
  }
  const { data, error } = await supabase
    .from("presupuestos")
    .update({ estado })
    .eq("id", id)
    .eq("estado", "VIGENTE")
    .select("id");
  if (error) {
    if (!esErrorConocido(error)) console.error("[PRESUPUESTOS] cerrar:", error);
    return { ok: false, error: mensajeErrorPresupuesto(error) };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "No se cambió nada: la cotización ya estaba cerrada o la hizo otra persona (solo ella o un administrador la pueden cerrar).",
    };
  }
  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${id}`);
  return { ok: true, error: null };
}
