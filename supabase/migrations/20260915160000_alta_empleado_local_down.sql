-- Deshace el alta local de empleados. Los usuarios ya creados quedan.
drop function if exists public.alta_empleado_local(uuid, uuid, text, text);
