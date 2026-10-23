"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { PASSWORD_MIN, mensajePasswordCorta } from "@/shared/lib/password";

// --- 1. ACTUALIZAR PERFIL (Nombre y Correo) ---
export async function updateProfileAction(formData: FormData) {
  const nombre = formData.get("nombre") as string;
  const email = formData.get("email") as string;

  if (!nombre || !email) {
    return { success: false, error: "El nombre y el correo son obligatorios." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. Actualizamos los datos en Supabase Auth
  const { data, error } = await supabase.auth.updateUser({
    email: email,
    data: { full_name: nombre }, // Guardamos el nombre en los metadatos de Auth
  });

  if (error) {
    console.error("Error al actualizar perfil auth:", error);
    return { success: false, error: error.message };
  }

  /* 
   * OPCIONAL: Si tienes una tabla "usuarios" o "perfiles" en tu base de datos 
   * pública vinculada al ID del usuario, deberías actualizarla aquí también:
   * 
   * await supabase.from("usuarios").update({ nombre, email }).eq("id", data.user.id);
   */

  revalidatePath("/cuenta");
  
  // Verificamos si el email está esperando confirmación
  if (data.user?.new_email) {
    return { 
      success: true, 
      message: "Perfil actualizado. Te enviamos un link al nuevo correo para confirmarlo." 
    };
  }

  return { success: true, message: "Perfil actualizado correctamente." };
}

// --- 2. ACTUALIZAR CONTRASEÑA ---
export async function updatePasswordAction(formData: FormData) {
  const currentPassword = formData.get("current_password") as string;
  const newPassword = formData.get("new_password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { success: false, error: "Todos los campos son obligatorios." };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: "Las contraseñas nuevas no coinciden." };
  }

  if (newPassword.length < PASSWORD_MIN) {
    return { success: false, error: mensajePasswordCorta };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. Obtener el usuario actual
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { success: false, error: "No se pudo verificar la sesión actual." };
  }

  // 2. Verificar la contraseña actual haciendo un intento de login
  // (Esta es la forma más segura de validar la contraseña vieja en Supabase)
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: userData.user.email!,
    password: currentPassword,
  });

  if (signInError) {
    return { success: false, error: "La contraseña actual es incorrecta." };
  }

  // 3. Si la contraseña actual es correcta, actualizamos a la nueva
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword
  });

  if (updateError) {
    console.error("Error cambiando contraseña:", updateError);
    return { success: false, error: "Hubo un problema al actualizar la contraseña." };
  }

  return { success: true, message: "Contraseña actualizada exitosamente." };
}