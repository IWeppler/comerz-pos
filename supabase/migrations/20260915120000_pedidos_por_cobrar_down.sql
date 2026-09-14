-- Deshace los pedidos por cobrar. Los pedidos ya cobrados tienen su venta
-- registrada aparte: borrar la tabla no toca ninguna venta.
drop function if exists public.cobrar_pedido(uuid, uuid);
drop function if exists public.crear_pedido(jsonb, uuid, numeric, text);
drop table if exists public.pedidos_numeracion;
drop table if exists public.pedidos;
delete from public.rol_permisos
 where permiso_id in (select id from public.permisos where clave = 'ventas.cobrar');
delete from public.permisos where clave = 'ventas.cobrar';
alter table public.configuracion_pos drop column if exists pedidos_a_caja;
