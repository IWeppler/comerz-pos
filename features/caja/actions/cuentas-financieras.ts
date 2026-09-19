"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";

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
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_VER_GERENCIAL))) {
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
