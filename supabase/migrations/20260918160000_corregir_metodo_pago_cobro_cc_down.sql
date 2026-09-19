-- Rollback de 20260918160000. Antes de ejecutarlo, respaldar
-- cobros_cc_correcciones: eliminarla borra el historial de cambios, aunque los
-- cobros permanecen con su último medio de pago.

begin;

drop function if exists public.efectivo_actual_turnos(uuid[]);
drop function if exists public.corregir_metodo_pago_cobro_cc(uuid, uuid, text);
drop table if exists public.cobros_cc_correcciones;

delete from public.rol_permisos
 where permiso_id in (
   select id from public.permisos
    where clave = ''clientes.corregir_cobro_cc''
 );

delete from public.permisos
 where clave = ''clientes.corregir_cobro_cc'';

commit;
