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

/**
 * Renombrar una cuenta.
 *
 * Es lo único editable: el TIPO, el código y `es_sistema` deciden cómo se
 * comporta la cuenta (si se arquea, si recibe el cierre del turno, si es el
 * puente), y cambiarlos desde una pantalla sería reescribir el modelo por
 * accidente. El nombre, en cambio, es lo que la dueña lee, y hoy no había
 * forma de corregir un typo salvo creando una cuenta nueva — que es
 * exactamente cómo se fabrican cuentas duplicadas.
 *
 * `.select("id")` y chequeo de filas: sin eso, un UPDATE que la RLS filtra
 * vuelve con 0 filas y `error: null`, o sea "guardado" en la pantalla y nada
 * en la base. Costó 35 fotos el 5/9.
 */
export async function renombrarCuentaFinancieraAction(
  cuentaId: string,
  nombre: string,
): Promise<{ error: string | null }> {
  const limpio = nombre.trim();
  if (!cuentaId || limpio === "") return { error: "Ingresá un nombre." };
  if (limpio.length > 60) return { error: "El nombre es demasiado largo." };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("cuentas_financieras")
    .update({ nombre: limpio })
    .eq("id", cuentaId)
    .select("id");

  if (error) {
    console.error("Error renombrando la cuenta:", error);
    return { error: "No se pudo renombrar la cuenta." };
  }
  if (!data || data.length === 0) {
    return { error: "Solo una administradora puede renombrar cuentas." };
  }

  revalidatePath("/caja");
  return { error: null };
}

/**
 * Dar de baja una cuenta que ya no se usa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE DESACTIVA, NO SE BORRA — Y NUNCA CON PLATA ADENTRO
 *
 * Desactivar conserva la historia: `movimientos_financieros` es append-only y
 * sus filas siguen explicando de dónde salió cada saldo. Borrar la fila
 * dejaría movimientos colgando de una cuenta que no existe.
 *
 * El freno que importa es el SALDO. `registrar_transferencia_financiera`
 * exige que las dos cuentas estén `activa`, así que desactivar una cuenta con
 * plata deja esa plata INALCANZABLE: no se puede mover a ningún lado nunca
 * más. Por eso primero se transfiere el saldo y después se desactiva, y el
 * mensaje lo dice con el número puesto.
 *
 * Es justo el caso de El Nono Cacho: "Mercado Pago Posnet" quedó sin ningún
 * método apuntándole pero con $110.112 de cobros viejos adentro.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function desactivarCuentaFinancieraAction(
  cuentaId: string,
): Promise<{ error: string | null }> {
  if (!cuentaId) return { error: "Elegí una cuenta." };

  const supabase = createClient(await cookies());

  const { data: cuenta, error: errorCuenta } = await supabase
    .from("cuentas_financieras")
    .select("id, nombre, es_sistema, activa")
    .eq("id", cuentaId)
    .single();

  if (errorCuenta || !cuenta) return { error: "Esa cuenta no existe." };
  if (!cuenta.activa) return { error: "Esa cuenta ya está dada de baja." };

  // Las de sistema (caja diaria, caja general, el puente) las crea y las usa
  // el propio modelo: sin ellas no se puede abrir un turno ni cobrar.
  if (cuenta.es_sistema) {
    return {
      error: "Las cajas del sistema no se dan de baja: el turno y los cobros las necesitan.",
    };
  }

  // El saldo se calcula acá y no se recibe del navegador: es el dato que
  // decide si se puede perder plata.
  const { data: movimientos, error: errorSaldo } = await supabase
    .from("movimientos_financieros")
    .select("importe")
    .eq("cuenta_financiera_id", cuentaId);

  if (errorSaldo) {
    console.error("Error calculando el saldo de la cuenta:", errorSaldo);
    return { error: "No se pudo verificar el saldo de la cuenta." };
  }

  const saldo = (movimientos ?? []).reduce(
    (acc, m) => acc + Number(m.importe ?? 0),
    0,
  );
  if (Math.abs(saldo) >= 0.01) {
    return {
      error: `${cuenta.nombre} todavía tiene ${formatearPesos(saldo)}. Transferí ese saldo a otra cuenta antes de darla de baja, o esa plata queda sin forma de moverse.`,
    };
  }

  // Un método apuntando a una cuenta inactiva deja los cobros sin destino, que
  // es el agujero que cerró `20260920200000`.
  const { data: metodos, error: errorMetodos } = await supabase
    .from("metodos_pago")
    .select("nombre")
    .eq("cuenta_destino_id", cuentaId);

  if (errorMetodos) {
    console.error("Error verificando los métodos de la cuenta:", errorMetodos);
    return { error: "No se pudo verificar qué métodos usan la cuenta." };
  }
  if (metodos && metodos.length > 0) {
    const nombres = metodos.map((m) => m.nombre).join(", ");
    return {
      error: `Todavía cobrás con ${nombres} en esta cuenta. Cambiales la cuenta de destino antes de darla de baja.`,
    };
  }

  const { data, error } = await supabase
    .from("cuentas_financieras")
    .update({ activa: false })
    .eq("id", cuentaId)
    .select("id");

  if (error) {
    console.error("Error dando de baja la cuenta:", error);
    return { error: "No se pudo dar de baja la cuenta." };
  }
  if (!data || data.length === 0) {
    return { error: "Solo una administradora puede dar de baja una cuenta." };
  }

  revalidatePath("/caja");
  return { error: null };
}

/** Formato mínimo para un mensaje de error del server (no hay Intl del
 * cliente acá y el mensaje viaja como texto). */
function formatearPesos(monto: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(monto);
}

export type MetodoDeCuenta = { cuentaId: string; nombre: string; tipo: string };

/**
 * Qué métodos de pago caen en cada cuenta.
 *
 * Es el dato que faltaba para poder limpiar cuentas duplicadas sin adivinar.
 * En El Nono Cacho se ve de un vistazo que "Mercado Pago" y "Mercado Pago
 * Posnet" —dos métodos con comisiones distintas, 0% y 7%— ya caen los dos en
 * la MISMA cuenta, que es lo correcto: la comisión y los días de acreditación
 * viven en el método, no en la cuenta. Una cuenta puede tener varios flujos
 * de ingreso.
 */
export async function getMetodosPorCuentaAction(): Promise<MetodoDeCuenta[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("metodos_pago")
    .select("nombre, tipo, cuenta_destino_id")
    .not("cuenta_destino_id", "is", null)
    .order("nombre");

  if (error) {
    console.error("Error cargando los métodos por cuenta:", error);
    return [];
  }

  return (data ?? []).map((m) => ({
    cuentaId: m.cuenta_destino_id as string,
    nombre: m.nombre as string,
    tipo: m.tipo as string,
  }));
}
