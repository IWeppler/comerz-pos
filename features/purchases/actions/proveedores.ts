"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";

export interface Proveedor {
  id: string;
  nombre: string;
  telefono: string | null;
  plazo_pago_dias: number | null;
}

/** Los proveedores activos del negocio (RLS acota), por nombre. */
export async function listarProveedoresAction(): Promise<Proveedor[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("proveedores")
    .select("id, nombre, telefono, plazo_pago_dias")
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) {
    console.error("[listarProveedoresAction]", error);
    return [];
  }
  return (data ?? []) as Proveedor[];
}

/**
 * Alta rápida desde el selector. El nombre es único por negocio sin importar
 * mayúsculas ni espacios (`proveedores_nombre_unico`): si ya existe, se
 * devuelve ese en vez de fallar. Escribir "mayorista" cuando ya está
 * "Mayorista" es elegirlo, no un error.
 */
export async function crearProveedorAction(
  nombre: string,
): Promise<{ proveedor: Proveedor | null; error: string | null }> {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) return { proveedor: null, error: "Escribí el nombre del proveedor." };
  if (limpio.length > 120) {
    return { proveedor: null, error: "El nombre es demasiado largo." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("proveedores")
    .insert({ nombre: limpio })
    .select("id, nombre, telefono, plazo_pago_dias")
    .single();

  if (!error && data) return { proveedor: data as Proveedor, error: null };

  if (error?.code === "23505") {
    const { data: existentes } = await supabase
      .from("proveedores")
      .select("id, nombre, telefono, plazo_pago_dias, activo");
    const clave = limpio.toLowerCase();
    const existente = (existentes ?? []).find(
      (p) => String(p.nombre).trim().toLowerCase() === clave,
    );
    if (existente?.activo) {
      return { proveedor: existente as Proveedor, error: null };
    }
    return {
      proveedor: null,
      error: "Ya hay un proveedor con ese nombre dado de baja.",
    };
  }

  console.error("[crearProveedorAction]", error);
  return {
    proveedor: null,
    error:
      error?.code === "42501"
        ? "No tenés permiso para cargar proveedores."
        : "No se pudo crear el proveedor.",
  };
}
