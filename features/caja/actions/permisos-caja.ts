"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

/**
 * ¿El usuario de esta sesión puede ver la Vista Gerencial de Caja (resumen
 * agregado del día: ventas totales, breakdown por medio de pago y
 * esperado/real/diferencia de TODAS las cajeras)?
 *
 * Server-side siempre: el resultado sirve para decidir qué renderizar, pero
 * cualquier acción o query que devuelva esos datos agregados tiene que volver
 * a chequear el permiso por su cuenta — esconder la UI no es un control de
 * acceso.
 */
export async function puedeVerVistaGerencialAction(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.CAJA_VER_GERENCIAL);
}

/**
 * ¿Puede ver la tabla general de movimientos de dinero (todas las cuentas,
 * todos los orígenes) y el detalle de cada cuenta? Mismo criterio que
 * arriba: server-side, y la RPC (`movimientos_financieros_negocio`,
 * `movimientos_de_cuenta`) vuelve a chequear el permiso por su cuenta.
 */
export async function puedeVerMovimientosAction(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.CAJA_VER_MOVIMIENTOS);
}

/**
 * ¿Puede anular un gasto o revertir una transferencia? Es la única forma de
 * hacer desaparecer plata ya registrada, así que el permiso es más angosto
 * que ver los movimientos: hoy solo ADMIN. Las dos RPCs (`anular_egreso`,
 * `revertir_transferencia_financiera`) vuelven a chequearlo por su cuenta.
 */
export async function puedeAnularMovimientoAction(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.CAJA_ANULAR_MOVIMIENTO);
}

/**
 * ¿Puede registrar un ingreso que no viene de una venta (aporte, préstamo,
 * otro)? Solo ADMIN por defecto (`20260922100000`): es la segunda forma de
 * hacer aparecer plata sin una venta, y con ese botón se "cuadra" un
 * faltante. La RPC `registrar_ingreso_financiero` vuelve a chequearlo.
 */
export async function puedeRegistrarIngresoAction(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  return tienePermiso(supabase, PERMISOS.CAJA_REGISTRAR_INGRESO);
}
