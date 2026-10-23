"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { rangoMesComercial } from "@/shared/lib/mes-comercial";

/**
 * Uso real de los límites del plan, para la sección "Uso de tu plan".
 *
 * Cada número replica EXACTAMENTE lo que cuenta la base al aplicar el límite,
 * no una aproximación parecida. Si la UI contara distinto, alguien vería
 * "3 de 5" y recibiría un error de límite alcanzado.
 *
 * - Usuarios: `validar_limite_usuarios` suma los miembros de
 *   `usuarios_negocios` MÁS las invitaciones en estado PENDIENTE, porque una
 *   invitación ya reserva el lugar. Acá se devuelven separados para poder
 *   explicarlo en la UI.
 * - Clientes con cuenta corriente: `puede_fiar` / la validación del trigger
 *   cuentan los clientes con `saldo_pendiente > 0`, no los clientes cargados.
 *   El plan vende "fiarle a N clientes", no "tener N contactos".
 *
 * `max_sucursales` NO se devuelve: todavía no existe tabla de sucursales, así
 * que no hay nada que contar. Antes que mostrar un número inventado, la UI lo
 * muestra como límite del plan sin barra de uso.
 */
export interface UsoDelPlan {
  usuariosActivos: number;
  invitacionesPendientes: number;
  clientesConCuentaCorriente: number;
  /** Productos cargados. El tope (`max_productos`) frena el alta y nada más,
   * así que este número puede quedar POR ENCIMA del límite sin que sea un
   * error: pasa con quien venía de un plan sin tope. */
  productos: number;
  /** Ventas del mes comercial argentino, sin anuladas. Es el uso de
   * `max_ventas_mensuales`, un tope BLANDO: pasarlo avisa y no frena. */
  ventasDelMes: number;
}

export async function getUsoDelPlanAction(): Promise<UsoDelPlan | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: negocioId } = await supabase.rpc("negocio_actual");
  if (!negocioId) return null;

  const mes = rangoMesComercial();

  const [usuarios, invitaciones, clientesCc, productos, ventasMes] = await Promise.all([
    supabase
      .from("usuarios_negocios")
      .select("id", { count: "exact", head: true })
      .eq("negocio_id", negocioId),
    supabase
      .from("invitaciones")
      .select("id", { count: "exact", head: true })
      .eq("negocio_id", negocioId)
      .eq("estado", "PENDIENTE"),
    supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("negocio_id", negocioId)
      .gt("saldo_pendiente", 0),
    supabase
      .from("productos")
      .select("id", { count: "exact", head: true })
      .eq("negocio_id", negocioId),
    // Índice (negocio_id, fecha_venta). Mismo filtro de anuladas que reportes.
    supabase
      .from("ventas")
      .select("id", { count: "exact", head: true })
      .eq("negocio_id", negocioId)
      .neq("estado_operacion", "ANULADA")
      .gte("fecha_venta", mes.desde)
      .lt("fecha_venta", mes.hasta),
  ]);

  return {
    usuariosActivos: usuarios.count ?? 0,
    invitacionesPendientes: invitaciones.count ?? 0,
    clientesConCuentaCorriente: clientesCc.count ?? 0,
    productos: productos.count ?? 0,
    ventasDelMes: ventasMes.count ?? 0,
  };
}
