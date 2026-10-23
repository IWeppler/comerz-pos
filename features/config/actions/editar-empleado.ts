"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { adminConfigurado, createAdminClient } from "@/shared/config/supabase/admin";
import { PASSWORD_MIN } from "@/shared/lib/password";

export interface EditarEmpleadoState {
  error: string | null;
  success: boolean;
  aviso?: string | null;
}

function mensajeDeRpc(mensaje: string | undefined): string | null {
  const m = mensaje ?? "";
  if (m.includes("ULTIMO_ADMIN")) return "Es el único administrador: asigná otro ADMIN primero.";
  if (m.includes("NO_ES_MIEMBRO")) return "Esa persona no es empleada de este negocio.";
  if (m.includes("ROL_INVALIDO")) return "El rol elegido no es de este negocio.";
  if (m.includes("NO_A_SI_MISMO")) return "No podés quitarte a vos mismo.";
  if (m.includes("SIN_PERMISO")) return "Solo un administrador puede hacer esto.";
  return null;
}

/**
 * Edita nombre, mail, rol y (opcional) contraseña de un empleado.
 *
 * El perfil y el rol los escribe `editar_empleado` (SECURITY DEFINER acotada
 * a admin + miembro). Mail y contraseña en Auth solo si la base dice
 * `gestiona_acceso`: cuentas que este negocio creó en el mostrador y no
 * trabajan en otro. La que se sumó por invitación, la de un dueño, la que
 * entra con Google o la del super admin es de la persona, y cambiarle la clave
 * con service_role era quedarse con su cuenta (auditoría del 22/10/2026). Sin
 * el dato no se toca Auth. Cambiar la clave cierra las sesiones abiertas — es
 * el caso del celular robado.
 */
export async function editarEmpleadoAction(
  _prev: EditarEmpleadoState,
  formData: FormData,
): Promise<EditarEmpleadoState> {
  const usuarioId = String(formData.get("usuario_id") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const rolId = String(formData.get("rol_id") ?? "");

  if (!usuarioId || !nombre || !email || !rolId) {
    return { error: "Faltan datos.", success: false };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "El correo no tiene un formato válido.", success: false };
  }
  if (password && password.length < PASSWORD_MIN) {
    return {
      error: `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`,
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Para saber si el mail cambió (y si tiene sentido tocarlo en Auth).
  const { data: perfilActual } = await supabase
    .from("perfiles")
    .select("email")
    .eq("id", usuarioId)
    .maybeSingle();

  const { data, error } = await supabase.rpc("editar_empleado", {
    p_usuario_id: usuarioId,
    p_nombre: nombre,
    p_email: email,
    p_rol_id: rolId,
    p_cerrar_sesiones: Boolean(password),
  });

  if (error) {
    console.error("[EDITAR EMPLEADO]", error);
    return { error: mensajeDeRpc(error.message) ?? "No se pudo guardar.", success: false };
  }

  const resultado = data as { otras_membresias?: number; gestiona_acceso?: boolean } | null;
  const otras = Number(resultado?.otras_membresias ?? 0);
  // Fail-closed: solo `true` explícito de la base habilita tocar Auth.
  const gestionaAcceso = resultado?.gestiona_acceso === true;
  const cambiaMail = perfilActual?.email?.toLowerCase() !== email;
  const quiereAuth = cambiaMail || Boolean(password);

  if (quiereAuth && !gestionaAcceso) {
    revalidatePath("/configuracion");
    return {
      error: null,
      success: true,
      aviso:
        otras > 0
          ? "Nombre y rol guardados. El mail y la contraseña no se cambiaron: esa cuenta también trabaja en otro negocio y solo la persona puede cambiarlos desde su perfil."
          : "Nombre y rol guardados. El mail y la contraseña no se cambiaron: esa cuenta es de la persona (entró con una invitación o con Google) y solo ella puede cambiarlos.",
    };
  }

  if (quiereAuth) {
    if (!adminConfigurado) {
      return {
        error: null,
        success: true,
        aviso: "Nombre y rol guardados, pero sin clave de servicio no se puede cambiar mail ni contraseña.",
      };
    }
    const admin = createAdminClient();
    const { error: errorAuth } = await admin.auth.admin.updateUserById(usuarioId, {
      ...(cambiaMail ? { email, email_confirm: true } : {}),
      ...(password ? { password } : {}),
    });
    if (errorAuth) {
      console.error("[EDITAR EMPLEADO] auth:", errorAuth);
      const enUso = /already|exists|registered/i.test(errorAuth.message);
      return {
        error: enUso
          ? "Ese correo ya lo usa otra cuenta de Comerz."
          : "Se guardaron nombre y rol, pero no se pudo cambiar el acceso.",
        success: false,
      };
    }
  }

  revalidatePath("/configuracion");
  return {
    error: null,
    success: true,
    aviso: password
      ? "Guardado. Se cerraron las sesiones abiertas: tiene que volver a entrar con la contraseña nueva."
      : null,
  };
}

/**
 * Saca al empleado del negocio. NO borra la cuenta (sus ventas quedan a su
 * nombre); sin membresía no puede entrar, y si este era su único negocio se
 * le cierran las sesiones.
 */
export async function quitarEmpleadoAction(
  usuarioId: string,
): Promise<{ success: boolean; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.rpc("quitar_empleado", { p_usuario_id: usuarioId });
  if (error) {
    console.error("[QUITAR EMPLEADO]", error);
    return { success: false, error: mensajeDeRpc(error.message) ?? "No se pudo quitar." };
  }
  revalidatePath("/configuracion");
  return { success: true, error: null };
}
