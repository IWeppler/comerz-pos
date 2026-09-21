"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import type { MovimientoCuenta } from "../lib/movimiento-financiero";

export type CuentaFinanciera = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  es_efectivo: boolean;
  requiere_arqueo: boolean;
  es_sistema: boolean;
  activa: boolean;
  saldo?: number;
};

export type TransferenciaFinanciera = {
  id: string;
  monto: number;
  concepto: string;
  fecha: string;
  origen_nombre: string;
  destino_nombre: string;
  registrado_por_nombre: string | null;
  /** Si esta fila es la reversa de otra, el id de la original. */
  revierte_a: string | null;
  /** Si esta fila ya fue revertida, el id de su reversa. */
  revertida_por: string | null;
};

export async function getCuentasFinancierasAction(): Promise<CuentaFinanciera[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("cuentas_financieras")
    .select("id, codigo, nombre, tipo, es_efectivo, requiere_arqueo, es_sistema, activa")
    .eq("activa", true)
    .order("es_sistema", { ascending: false })
    .order("nombre");

  if (error) {
    console.error("Error cargando cuentas financieras:", error);
    return [];
  }
  return (data ?? []) as CuentaFinanciera[];
}

export async function getEstadoCuentasFinancierasAction() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("estado_cuentas_financieras");
  if (error) {
    console.error("Error cargando saldos financieros:", error);
    return { data: null, error: "No se pudieron cargar las cuentas." };
  }
  return { data: data as { cuentas: CuentaFinanciera[]; transferencias: TransferenciaFinanciera[] }, error: null };
}

export async function crearCuentaFinancieraAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "");
  const tipos = new Set(["CAJA_GENERAL", "BANCO", "BILLETERA", "OTRA"]);
  if (!nombre || !tipos.has(tipo)) {
    return { error: "Ingresá un nombre y un tipo válidos.", success: false };
  }

  const supabase = createClient(await cookies());
  const { data: admin } = await supabase.rpc("is_admin");
  if (!admin) return { error: "Solo una administradora puede crear cuentas.", success: false };

  const codigoBase = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "CUENTA";
  const codigo = `${codigoBase}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const { error } = await supabase.from("cuentas_financieras").insert({
    codigo,
    nombre,
    tipo,
    es_efectivo: tipo === "CAJA_GENERAL",
    requiere_arqueo: false,
    es_sistema: false,
  });
  if (error) {
    console.error("Error creando cuenta financiera:", error);
    return { error: "No se pudo crear la cuenta.", success: false };
  }
  revalidatePath("/caja");
  return { error: null, success: true };
}

export async function registrarTransferenciaFinancieraAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  const cuentaOrigenId = String(formData.get("cuenta_origen_id") ?? "");
  const cuentaDestinoId = String(formData.get("cuenta_destino_id") ?? "");
  const concepto = String(formData.get("concepto") ?? "").trim();
  const monto = Number(formData.get("monto"));
  if (!cuentaOrigenId || !cuentaDestinoId || cuentaOrigenId === cuentaDestinoId || !concepto || !Number.isFinite(monto) || monto <= 0) {
    return { error: "Completá origen, destino, concepto y un monto válido.", success: false };
  }

  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado.", success: false };
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_TRANSFERIR))) {
    return { error: "No tenés permiso para transferir entre cuentas.", success: false };
  }

  const { turnoId } = await resolverTurnoActivo(supabase, user.id);
  const { error } = await supabase.rpc("registrar_transferencia_financiera", {
    p_cuenta_origen_id: cuentaOrigenId,
    p_cuenta_destino_id: cuentaDestinoId,
    p_monto: monto,
    p_concepto: concepto,
    p_turno_caja_id: turnoId,
  });
  if (error) {
    console.error("Error registrando transferencia:", error);
    const mensaje = error.message.includes("CAJA_DIARIA_REQUIERE_TURNO_ABIERTO")
      ? "Abrí la caja antes de mover dinero hacia o desde Caja diaria."
      : "No se pudo registrar la transferencia.";
    return { error: mensaje, success: false };
  }

  revalidatePath("/caja");
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/**
 * Declarar la plata que una cuenta YA tenía cuando el comercio empezó a
 * usarla en Comerz.
 *
 * Existe por un caso concreto: "Caja Grande" de El Nono Cacho quedó en
 * −$750.000 porque sus 7 movimientos son egresos (sueldos del 19/9) y ninguna
 * entrada. La cuenta nunca recibió plata en el sistema. El negativo es correcto
 * como registro y confuso como pantalla.
 *
 * Toda la regla vive en la RPC (`20260921140000`): una sola vez por cuenta,
 * nunca para una cuenta con arqueo —ahí el saldo inicial es el fondo del
 * turno— y solo ADMIN. Acá se traducen los códigos a algo que se pueda leer.
 */
const MENSAJES_SALDO_INICIAL: Record<string, string> = {
  SIN_PERMISO: "Solo una administradora puede declarar el saldo de una cuenta.",
  MONTO_INVALIDO: "Ingresá un monto mayor a cero.",
  CUENTA_NO_DISPONIBLE: "Esa cuenta no existe o está desactivada.",
  CUENTA_PUENTE_RESERVADA:
    "«Por acreditar» es una cuenta técnica del sistema: no se le declara saldo.",
  CAJA_ARQUEADA_USA_FONDO_DE_TURNO:
    "En la caja diaria el saldo inicial es el fondo con el que abrís el turno, no un ajuste.",
  SALDO_INICIAL_YA_REGISTRADO:
    "Esta cuenta ya tiene su saldo inicial declarado. Para moverle plata usá una transferencia.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
};

export async function registrarSaldoInicialCuentaAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData,
) {
  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const monto = Number(formData.get("monto"));
  const detalle = String(formData.get("detalle") ?? "").trim() || null;

  if (!cuentaId || !Number.isFinite(monto) || monto <= 0) {
    return { error: "Elegí la cuenta e ingresá un monto válido.", success: false };
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("registrar_saldo_inicial_cuenta", {
    p_cuenta_id: cuentaId,
    p_monto: monto,
    p_detalle: detalle,
  });

  if (error) {
    const codigo = Object.keys(MENSAJES_SALDO_INICIAL).find((clave) =>
      error.message?.includes(clave),
    );
    console.error("Error registrando el saldo inicial:", error);
    return {
      error: codigo
        ? MENSAJES_SALDO_INICIAL[codigo]
        : "No se pudo declarar el saldo de la cuenta.",
      success: false,
    };
  }

  revalidatePath("/caja");
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/**
 * Los últimos movimientos de una cuenta: qué entró, qué salió y por qué.
 *
 * El tope lo recorta también la RPC (200): el número que viaja desde el
 * navegador no puede decidir cuánto lee la base.
 *
 * Ante cualquier error devuelve lista vacía en vez de romper: esto abre un
 * panel de detalle, no una pantalla crítica, y el saldo de arriba ya está.
 */
export async function getMovimientosCuentaAction(
  cuentaId: string,
  limite = 50,
): Promise<{ data: MovimientoCuenta[]; error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("movimientos_de_cuenta", {
    p_cuenta_id: cuentaId,
    p_limite: limite,
  });

  if (error) {
    if (error.code === "42501") {
      return { data: [], error: "No tenés permiso para ver estos movimientos." };
    }
    console.error("Error cargando los movimientos de la cuenta:", error);
    return { data: [], error: "No se pudieron cargar los movimientos." };
  }

  return { data: (data ?? []) as MovimientoCuenta[], error: null };
}

/**
 * Revertir una transferencia (`20260921200000`): registra la compensatoria
 * destino → origen por el mismo monto, con `revierte_a` apuntando a la
 * original. Las dos quedan en el ledger; nada se borra. Una vez por original,
 * y una reversa no se revierte. Permiso `caja.anular_movimiento`.
 *
 * Si alguna de las dos cuentas es la caja diaria, la plata vuelve al turno
 * ABIERTO de quien revierte, no al turno original: ese ya se cerró y se firmó.
 */
const MENSAJES_REVERSA: Record<string, string> = {
  SIN_PERMISO: "Solo una administradora puede revertir una transferencia.",
  MOTIVO_REQUERIDO: "Contá por qué se revierte.",
  TRANSFERENCIA_NO_ENCONTRADA: "Esa transferencia no existe.",
  ES_UNA_REVERSA:
    "Esa fila ya es una reversa. Si hace falta, registrá la transferencia de nuevo.",
  TRANSFERENCIA_YA_REVERTIDA: "Esa transferencia ya fue revertida.",
  CAJA_DIARIA_REQUIERE_TURNO_ABIERTO:
    "Para devolver plata a la caja diaria tenés que tener tu turno abierto.",
  CUENTA_NO_DISPONIBLE: "Una de las cuentas de la transferencia ya no está disponible.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
};

export async function revertirTransferenciaFinancieraAction(
  transferenciaId: string,
  motivo: string,
): Promise<{ error: string | null; reversaId: string | null }> {
  if (!transferenciaId || !motivo.trim()) {
    return { error: MENSAJES_REVERSA.MOTIVO_REQUERIDO, reversaId: null };
  }
  const supabase = createClient(await cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado.", reversaId: null };
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_ANULAR_MOVIMIENTO))) {
    return { error: MENSAJES_REVERSA.SIN_PERMISO, reversaId: null };
  }

  const { turnoId } = await resolverTurnoActivo(supabase, user.id);
  const { data, error } = await supabase.rpc("revertir_transferencia_financiera", {
    p_transferencia_id: transferenciaId,
    p_motivo: motivo.trim(),
    p_turno_caja_id: turnoId,
  });
  if (error) {
    console.error("Error revirtiendo transferencia:", error);
    const codigo = Object.keys(MENSAJES_REVERSA).find((c) => error.message.includes(c));
    return {
      error: codigo ? MENSAJES_REVERSA[codigo] : "No se pudo revertir la transferencia.",
      reversaId: null,
    };
  }

  revalidatePath("/caja");
  revalidatePath("/", "layout");
  return { error: null, reversaId: (data as string) ?? null };
}
