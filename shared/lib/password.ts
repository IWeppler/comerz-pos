/**
 * Largo mínimo de una contraseña de Comerz, en TODOS los lugares donde se crea
 * o se cambia una: alta, recuperación, perfil y empleados.
 *
 * 8 y no 6 (el default de Supabase): auditoría de seguridad del 22/10/2026. El
 * login corre en una server action, así que Supabase ve la IP de Vercel y su
 * límite por IP no frena a quien prueba claves; con 6 caracteres el espacio es
 * chico. El mismo número tiene que estar en Supabase (Authentication → Sign In
 * / Providers → Email → Minimum password length): si la base pide menos, una
 * clave corta entra por la API directa.
 *
 * Solo se exige al crear o cambiar: una cuenta con una clave vieja de 6 sigue
 * entrando.
 */
export const PASSWORD_MIN = 8;

export const mensajePasswordCorta = `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
