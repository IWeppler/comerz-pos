-- Reversión de 20261012133049_tienda_ordenes_y_pagos.sql
-- Falla a propósito si ya hay movimientos de stock de órdenes: esos
-- movimientos son historia real y el CHECK viejo no los admite. En ese caso
-- primero hay que decidir qué hacer con ellos (no borrarlos a ciegas).

do $$
begin
  if exists (select 1 from public.movimientos_stock
              where origen in ('ORDEN_TIENDA', 'ORDEN_TIENDA_LIBERADA')) then
    raise exception 'REVERSION_PAGOS: hay movimientos de stock de órdenes de la tienda';
  end if;
  if exists (select 1 from public.ordenes_tienda) then
    raise exception 'REVERSION_PAGOS: hay órdenes de la tienda';
  end if;
end $$;

do $$
declare
  v_def text;
  v_buscar constant text := E'''BAJA'', ''BAJA_PRODUCTO'', ''DESCONOCIDO'',\n    ''ORDEN_TIENDA'', ''ORDEN_TIENDA_LIBERADA''\n  ) then';
  v_nuevo constant text := E'''BAJA'', ''BAJA_PRODUCTO'', ''DESCONOCIDO''\n  ) then';
  v_veces int;
begin
  v_def := pg_get_functiondef('public.registrar_movimiento_stock()'::regprocedure);
  v_veces := (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar);
  if v_veces <> 1 then
    raise exception 'REVERSION_PAGOS_TRIGGER: matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_buscar, v_nuevo);
end $$;

alter table public.movimientos_stock drop constraint movimientos_stock_origen_check;
alter table public.movimientos_stock add constraint movimientos_stock_origen_check
  check (origen = any (array['VENTA', 'ANULACION_VENTA', 'DEVOLUCION_PARCIAL', 'REVERSO_VENTA',
    'REMITO', 'CARGA_RAPIDA', 'IMPORTACION', 'EDICION_VARIANTES', 'BAJA', 'BAJA_PRODUCTO',
    'FOTO_INICIAL', 'DESCONOCIDO']));

delete from public.rol_permisos
 where permiso_id in (select id from public.permisos where clave = 'tienda.ver_ordenes');
delete from public.permisos where clave = 'tienda.ver_ordenes';

drop table public.mercadopago_oauth_estados;
drop table public.mercadopago_conexiones;
drop table public.eventos_pago;
drop table public.ordenes_tienda_items;
drop table public.ordenes_tienda;
drop table public.ordenes_tienda_numeradores;

drop index public.metodos_pago_negocio_uso_tienda_uidx;
alter table public.metodos_pago drop column uso_tienda;

alter table public.configuracion_pos
  drop column alias_mercadopago_tienda,
  drop column transferencia_titular,
  drop column cobro_online_transferencia,
  drop column cobro_online_mp,
  drop column minutos_vence_transferencia,
  drop column minutos_vence_mp;

alter table public.negocios drop column pagos_online_habilitado;
