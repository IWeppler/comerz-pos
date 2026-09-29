"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import {
  calcularProgresoActivacion,
  type EstadoActivacion,
} from "@/features/onboarding/lib/pasos-activacion";
import {
  estadoAcceso,
  type EstadoAcceso,
} from "@/features/admin/lib/estado-acceso";

export interface ComercioConUso {
  id: string;
  nombre: string;
  slug: string;
  estado: string;
  duenio: string | null;
  plan_id: string | null;
  plan_nombre: string | null;
  plan_precio: number;
  plan_vencimiento: string | null;
  vencido: boolean;
  usuarios: number;
  clientesCuentaCorriente: number;
  productos: number;
  /** Límites EFECTIVOS: los del plan con `reglas_override` aplicado encima.
   * `null` es sin tope. */
  maxUsuarios: number | null;
  maxClientesCuentaCorriente: number | null;
  maxProductos: number | null;
  /** 'indumentaria' | 'electro' | … Null si el negocio no tiene config. */
  rubro: string | null;
  /** Actividad de los últimos 7 días, sin contar anuladas. Es la señal de si
   * el comercio USA el sistema, que no es lo mismo que si paga. */
  ventas7d: number;
  monto7d: number;
  /** En qué punto quedó el acceso del dueño: si confirmó el mail y si después
   * pudo entrar de verdad. Ver `estadoAcceso`. */
  acceso: EstadoAcceso;
  /** La última señal de vida del dueño (login o refresh de token). */
  ultimaActividad: string | null;
  /** Pasos obligatorios del onboarding hechos sobre el total, con la MISMA
   * regla que ve el comerciante en su guía de inicio. */
  onboarding: { completados: number; total: number; activado: boolean } | null;
  /** WhatsApp del comercio (`configuracion_pos.whatsapp`). Es el número del
   * local: no hay teléfono personal del dueño en ningún lado. */
  whatsapp: string | null;
  /** `negocios.modulo_presupuestos`: si tiene el módulo de presupuestos y
   * planes en cuotas. Lo prende solo el super admin. */
  moduloPresupuestos: boolean;
}

/**
 * Los comercios con su consumo real de cada límite.
 *
 * Los conteos salen de una RPC y no de N consultas desde Node: con un comercio
 * de 1116 productos, traer las filas para contarlas en el cliente es traer el
 * catálogo entero de cada negocio para descartarlo. La RPC cuenta del lado de
 * la base y devuelve números.
 *
 * Los límites salen de `reglas_negocio()` —no de `planes.reglas`— porque un
 * negocio puede tener excepciones: mostrar el tope del plan le diría "50" a
 * alguien que tiene 75 acordados.
 */
export async function getComerciosConUsoAction(): Promise<ComercioConUso[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Los módulos van en una consulta aparte y no dentro de la RPC: sumarle una
  // columna a `comercios_con_uso` obliga a dropearla y recrearla entera (cambia
  // el tipo de retorno) por un booleano que ya se lee directo de `negocios`.
  const [{ data, error }, { data: modulos }] = await Promise.all([
    supabase.rpc("comercios_con_uso"),
    supabase.from("negocios").select("id, modulo_presupuestos"),
  ]);

  if (error) {
    console.error("[COMERCIOS CON USO]", error);
    return [];
  }

  const conPresupuestos = new Set(
    (modulos ?? [])
      .filter((m) => m.modulo_presupuestos === true)
      .map((m) => m.id as string),
  );

  const ahora = Date.now();

  return (data ?? []).map((fila: Record<string, unknown>): ComercioConUso => {
    const vencimiento = (fila.plan_vencimiento as string | null) ?? null;
    return {
      id: fila.id as string,
      nombre: fila.nombre as string,
      slug: fila.slug as string,
      estado: fila.estado as string,
      duenio: (fila.duenio as string | null) ?? null,
      plan_id: (fila.plan_id as string | null) ?? null,
      plan_nombre: (fila.plan_nombre as string | null) ?? null,
      plan_precio: Number(fila.plan_precio ?? 0),
      plan_vencimiento: vencimiento,
      vencido: vencimiento ? new Date(vencimiento).getTime() < ahora : false,
      usuarios: Number(fila.usuarios ?? 0),
      clientesCuentaCorriente: Number(fila.clientes_cc ?? 0),
      productos: Number(fila.productos ?? 0),
      maxUsuarios:
        fila.max_usuarios === null ? null : Number(fila.max_usuarios),
      maxClientesCuentaCorriente:
        fila.max_clientes_cc === null ? null : Number(fila.max_clientes_cc),
      maxProductos:
        fila.max_productos === null ? null : Number(fila.max_productos),
      rubro: (fila.rubro as string | null) ?? null,
      ventas7d: Number(fila.ventas_7d ?? 0),
      monto7d: Number(fila.monto_7d ?? 0),
      acceso: estadoAcceso({
        emailConfirmadoEn: (fila.email_confirmado_en as string | null) ?? null,
        ultimoIngreso: (fila.ultimo_ingreso as string | null) ?? null,
        ultimaActividad: (fila.ultima_actividad as string | null) ?? null,
      }),
      ultimaActividad: (fila.ultima_actividad as string | null) ?? null,
      // La regla de "activado" NO se reimplementa acá: es la misma función
      // pura que arma la guía de inicio del comerciante, así que el panel no
      // puede decir 5/6 mientras él ve 4/6.
      onboarding: fila.activacion
        ? (() => {
            const progreso = calcularProgresoActivacion(
              fila.activacion as unknown as EstadoActivacion,
            );
            return {
              completados: progreso.completados,
              total: progreso.total,
              activado: progreso.activado,
            };
          })()
        : null,
      whatsapp: (fila.whatsapp as string | null) ?? null,
      moduloPresupuestos: conPresupuestos.has(fila.id as string),
    };
  });
}
