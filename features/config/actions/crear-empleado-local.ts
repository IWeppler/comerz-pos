"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { adminConfigurado, createAdminClient } from "@/shared/config/supabase/admin";

export interface CrearEmpleadoLocalState {
  error: string | null;
  success: boolean;
  /** Distinto en cada alta exitosa: el form lo usa como key para vaciarse. */
  nonce?: number;
}

const PASSWORD_MIN = 8;

/**
 * Da de alta a un empleado con contraseña, sin mail ni invitación.
 *
 * Es el alta "en el mostrador": la dueña carga nombre, correo, clave y rol,
 * y la vendedora entra con eso. Dos escrituras que no comparten transacción
 * —el usuario en Auth (service_role) y el perfil + membresía en la base
 * (`alta_empleado_local`, con la sesión del admin)— así que si la segunda
 * falla (tope del plan, rol inválido) se borra el usuario recién creado
 * para no dejar una cuenta huérfana que después nadie puede invitar.
 *
 * Un correo que YA tiene cuenta no se toca: es de otra persona (o de esta
 * misma en otro negocio) y ponerle una contraseña nueva sería robarle la
 * cuenta. Para ese caso está invitar.
 */
export async function crearEmpleadoLocalAction(
  _prev: CrearEmpleadoLocalState,
  formData: FormData,
): Promise<CrearEmpleadoLocalState> {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const rolId = String(formData.get("rol_id") ?? "");

  if (!nombre || !email || !password || !rolId) {
    return { error: "Faltan datos: nombre, correo, contraseña y rol.", success: false };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "El correo no tiene un formato válido.", success: false };
  }
  if (password.length < PASSWORD_MIN) {
    return {
      error: `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`,
      success: false,
    };
  }
  if (!adminConfigurado) {
    return {
      error: "El servidor no tiene clave de servicio: no se pueden crear usuarios.",
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: esAdmin } = await supabase.rpc("is_admin");
  if (!esAdmin) {
    return { error: "Solo un administrador puede crear empleados.", success: false };
  }

  const admin = createAdminClient();
  const { data: creado, error: errorAuth } = await admin.auth.admin.createUser({
    email,
    password,
    // Sin mail de confirmación: la dueña lo está dando de alta en persona.
    email_confirm: true,
    user_metadata: { nombre },
  });

  if (errorAuth || !creado.user) {
    const yaExiste =
      errorAuth?.status === 422 ||
      /already|registered|exists/i.test(errorAuth?.message ?? "");
    if (yaExiste) {
      return {
        error:
          "Ese correo ya tiene cuenta en Comerz. Para sumarlo a este negocio usá Invitar: no se le puede cambiar la contraseña desde acá.",
        success: false,
      };
    }
    console.error("[CREAR EMPLEADO LOCAL] auth:", errorAuth);
    return { error: "No se pudo crear el usuario.", success: false };
  }

  const { error: errorAlta } = await supabase.rpc("alta_empleado_local", {
    p_usuario_id: creado.user.id,
    p_rol_id: rolId,
    p_nombre: nombre,
    p_email: email,
  });

  if (errorAlta) {
    console.error("[CREAR EMPLEADO LOCAL] alta:", errorAlta);
    // Sin membresía el usuario no sirve para nada y bloquea el mail para
    // siempre: se borra, y la dueña puede reintentar.
    await admin.auth.admin.deleteUser(creado.user.id);

    if (errorAlta.code === "23514") {
      return {
        error: `${errorAlta.message} Para sumar gente hay que pasar a un plan mayor.`,
        success: false,
      };
    }
    if (errorAlta.message?.includes("ROL_INVALIDO")) {
      return { error: "El rol elegido no es de este negocio.", success: false };
    }
    return { error: "No se pudo dar de alta al empleado.", success: false };
  }

  revalidatePath("/configuracion");
  return { error: null, success: true, nonce: Date.now() };
}
