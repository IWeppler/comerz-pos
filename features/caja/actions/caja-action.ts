"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { CajaActionState } from "@/entities/caja/types";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { normalizarTipoEgreso } from "@/features/caja/lib/tipo-egreso";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

const SIN_PERMISO_CAJA = "No tenés permiso para operar la caja.";

// ============================================================================
// 2. ABRIR TURNO SEGÚN MODO
// ============================================================================
export async function abrirTurnoAction(
  prevState: CajaActionState,
  formData: FormData,
) {
  const montoInicial = Number(formData.get("monto_inicial"));

  if (isNaN(montoInicial) || montoInicial < 0) {
    return { error: "Ingresa un monto inicial válido.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autorizado.", success: false };

  // Un server action es un endpoint: el botón escondido no es control.
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_OPERAR))) {
    return { error: SIN_PERMISO_CAJA, success: false };
  }

  const { turnoId: turnoColisionId, modoCaja } = await resolverTurnoActivo(
    supabase,
    user.id,
  );

  if (turnoColisionId) {
    return {
      error: `Ya existe una caja abierta en modo ${modoCaja.replace("_", " ")}.`,
      success: false,
    };
  }

  const { error } = await supabase.from("turnos_caja").insert({
    modo: modoCaja,
    usuario_id: modoCaja === "POR_USUARIO" ? user.id : null,
    vendedor_id: user.id,
    abierta_por: user.id,
    monto_inicial: montoInicial,
    efectivo_esperado: montoInicial,
    estado: "ABIERTO",
  });

  if (error) {
    console.error("Error abriendo caja:", error);
    return { error: "Ocurrió un error al abrir la caja.", success: false };
  }

  revalidatePath("/caja");
  revalidatePath("/");
  revalidatePath("/", "layout");
  revalidatePath("/pos");
  return { error: null, success: true };
}

// ============================================================================
// 3. CERRAR TURNO
// ============================================================================
export async function cerrarTurnoAction(
  prevState: CajaActionState,
  formData: FormData,
) {
  const turnoId = formData.get("turno_id") as string;
  const montoDeclarado = Number(formData.get("monto_final"));

  if (!turnoId || isNaN(montoDeclarado)) {
    return { error: "Faltan datos para cerrar la caja.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autorizado.", success: false };

  if (!(await tienePermiso(supabase, PERMISOS.CAJA_OPERAR))) {
    return { error: SIN_PERMISO_CAJA, success: false };
  }

  const { data: turno, error: turnoError } = await supabase
    .from("turnos_caja")
    .select("monto_inicial, estado, vendedor_id, modo")
    .eq("id", turnoId)
    .single();

  if (turnoError || !turno) {
    return { error: "No se encontró el turno a cerrar.", success: false };
  }
  if (turno.estado !== "ABIERTO") {
    return { error: "Esta caja ya fue cerrada.", success: false };
  }
  if (turno.vendedor_id !== user.id) {
    // POR_USUARIO: cada vendedor tiene su propia caja — cerrar la de otro
    // requiere el permiso granular (que ya incluye a los admins, ver
    // definición SQL de tiene_permiso). ÚNICA: la caja es una sola
    // compartida por todo el local; ahí la regla sigue siendo la de
    // siempre — solo admin puede cerrar la que abrió otro vendedor, el
    // permiso granular no la reemplaza.
    const { data: autorizado } =
      turno.modo === "POR_USUARIO"
        ? await supabase.rpc("tiene_permiso", {
            clave: "caja.cerrar_ajena",
          })
        : await supabase.rpc("is_admin");

    if (!autorizado) {
      return {
        error: "No podés cerrar una caja que no es tuya.",
        success: false,
      };
    }
  }

  // Recalculamos el efectivo esperado server-side. El cliente ya no envía
  // este valor: se ignora cualquier dato de efectivo_esperado que llegue
  // por formData.
  //
  // El total de egresos se calcula vía RPC (SECURITY DEFINER) en vez de un
  // SELECT directo: en modo_caja='UNICA' varios cajeros no-admin comparten
  // el mismo turno_caja_id, y la policy egresos_select_propio_o_admin solo
  // deja ver a cada uno sus propios egresos. Un SUM corrido con la sesión
  // del cajero que cierra subestimaría el total e inflaría el esperado.
  const [ventaPagosRes, egresosSumRes] = await Promise.all([
    supabase
      .from("venta_pagos")
      .select("monto_bruto")
      .eq("turno_caja_id", turnoId)
      .eq("metodo_tipo", "EFECTIVO")
      .neq("estado_pago_operacion", "ANULADO"),
    supabase.rpc("calcular_egresos_turno", { p_turno_id: turnoId }),
  ]);

  if (egresosSumRes.error) {
    console.error("Error calculando egresos del turno:", egresosSumRes.error);
    return { error: "Ocurrió un error al calcular el cierre.", success: false };
  }

  const ingresosEfectivo = (ventaPagosRes.data || []).reduce(
    (acc, p) => acc + Number(p.monto_bruto),
    0,
  );
  const totalEgresos = Number(egresosSumRes.data ?? 0);

  const efectivoEsperado =
    Number(turno.monto_inicial) + ingresosEfectivo - totalEgresos;
  const diferenciaCaja = montoDeclarado - efectivoEsperado;

  const { data: turnoCerrado, error } = await supabase
    .from("turnos_caja")
    .update({
      monto_final: montoDeclarado,
      monto_declarado: montoDeclarado,
      efectivo_esperado: efectivoEsperado,
      diferencia: diferenciaCaja,
      cerrada_por: user?.id,
      fecha_cierre: new Date().toISOString(),
      estado: "CERRADO",
    })
    .eq("id", turnoId)
    .eq("estado", "ABIERTO")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Error cerrando caja:", error);
    return { error: "Ocurrió un error al cerrar la caja.", success: false };
  }
  if (!turnoCerrado) {
    // El SELECT previo ya validó dueño/admin y estado === "ABIERTO"; si el
    // UPDATE igual afectó 0 filas es porque otra sesión cerró este turno
    // en el intervalo (carrera de concurrencia), no un problema de permisos.
    return { error: "Esta caja ya fue cerrada.", success: false };
  }

  revalidatePath("/caja");
  revalidatePath("/");
  revalidatePath("/", "layout");
  revalidatePath("/pos");
  return { error: null, success: true };
}

// ============================================================================
// 4. OBTENER DETALLES DEL TURNO (Cierre Z / Auditoría)
// ============================================================================
export async function getDetallesTurnoAction(turnoId: string) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const [ventasRes, pagosSueltosRes, egresosRes] = await Promise.all([
      supabase
        .from("ventas")
        .select(
          `
          id, total, metodo_pago, fecha_venta, cliente_id, clientes(nombre),
          monto_cobrado, monto_pendiente, estado_pago, estado_operacion, perfiles(nombre),
          ventas_items(producto:productos(nombre)),
          venta_pagos(metodo_nombre, metodo_tipo, monto_base, recargo_porcentaje, recargo_monto, monto_bruto, comision_porcentaje, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento)
        `,
        )
        .eq("turno_caja_id", turnoId)
        // Las ANULADAS vienen TAMBIÉN, y es la corrección de un bug que mostró
        // −320.000 de efectivo esperado en un cajón al que le faltaban 25.000.
        //
        // Acá había un `.neq("estado_operacion", "ANULADA")`, pero los egresos
        // de abajo se traen sin filtro. Anular una venta en efectivo genera un
        // egreso "Devolución en efectivo" (ver `anular_venta`), así que con el
        // filtro puesto la misma anulación pegaba DOS veces contra el arqueo:
        // una porque se le quitaba el ingreso y otra porque se le restaba el
        // egreso. Con 6 devoluciones seguidas en Ninja Camisetas eso fueron
        // 295.000 de más.
        //
        // El ingreso de una venta anulada tiene que seguir contando: la plata
        // entró al cajón de verdad, y lo que la saca es su egreso. Quien
        // decide qué hacer con cada una es el consumidor —el arqueo las suma,
        // el total facturado no— y para eso viaja `estado_operacion`.
        .order("fecha_venta", { ascending: false }),
      supabase
        .from("venta_pagos")
        .select(
          "id, metodo_nombre, metodo_tipo, monto_base, recargo_porcentaje, recargo_monto, monto_bruto, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento, creado_en, clientes(nombre)",
        )
        .eq("turno_caja_id", turnoId)
        .is("venta_id", null)
        .neq("estado_pago_operacion", "ANULADO")
        .order("creado_en", { ascending: false }),
      supabase
        .from("egresos")
        .select("id, concepto, monto, fecha, tipo, orden_compra_id, perfiles(nombre)")
        .eq("turno_caja_id", turnoId)
        .order("fecha", { ascending: false }),
    ]);

    if (ventasRes.error) {
      console.error("Error fetching detalles ventas:", ventasRes.error);
      return { data: null, error: "No se pudieron cargar los movimientos." };
    }

    return {
      data: {
        ventas: ventasRes.data || [],
        pagosSueltos: pagosSueltosRes.data || [],
        egresos: egresosRes.data || [],
      },
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error:", err);
    return { data: null, error: "Error inesperado en auditoría." };
  }
}

export async function registrarEgresoAction(
  prevState: CajaActionState,
  formData: FormData,
) {
  const concepto = formData.get("concepto") as string;
  const monto = Number(formData.get("monto"));
  const tipo = normalizarTipoEgreso(formData.get("tipo"));
  const ordenCompraId = (formData.get("orden_compra_id") as string) || null;

  if (!concepto || !monto || monto <= 0) {
    return { error: "Ingresa un concepto y un monto válido.", success: false };
  }
  // Espejo del CHECK de la base: un retiro colgado de un remito no tiene
  // sentido y la base lo rechazaría con un error feo.
  if (ordenCompraId && tipo !== "COMPRA_MERCADERIA") {
    return {
      error: "Solo una compra de mercadería puede asociarse a un remito.",
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "No autorizado.", success: false };
  }

  if (!(await tienePermiso(supabase, PERMISOS.CAJA_OPERAR))) {
    return { error: SIN_PERMISO_CAJA, success: false };
  }

  const { turnoId, requiereCajaAbierta } = await resolverTurnoActivo(
    supabase,
    user.id,
  );

  if (requiereCajaAbierta && !turnoId) {
    return {
      error: "Necesitas abrir la caja antes de registrar un gasto.",
      success: false,
    };
  }

  const { error } = await supabase.from("egresos").insert({
    concepto,
    monto,
    tipo,
    orden_compra_id: tipo === "COMPRA_MERCADERIA" ? ordenCompraId : null,
    creado_por: user.id,
    turno_caja_id: turnoId,
  });

  if (error) {
    console.error("Error al registrar egreso:", error);
    return { error: "Ocurrió un error al guardar el gasto.", success: false };
  }

  revalidatePath("/");
  revalidatePath("/caja");

  return { error: null, success: true };
}
