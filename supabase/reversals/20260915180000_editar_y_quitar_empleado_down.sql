-- Deshace editar/quitar empleados.
drop function if exists public.quitar_empleado(uuid);
drop function if exists public.editar_empleado(uuid, text, text, uuid, boolean);
drop function if exists public.cerrar_sesiones_usuario(uuid);
