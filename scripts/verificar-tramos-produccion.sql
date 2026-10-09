-- Auditoría de 8/10/2026, TODO en una transacción revertida.
-- Requiere la migración aplicada; todos los cambios de prueba se revierten.
-- Los IDs son del Kiosco Demo. Nunca ejecutar sin el BEGIN / ROLLBACK completo.
begin;

do $$ begin
  if public.precios_por_cantidad_validos('[{"desde":10,"precio":"220"}]') or
     public.precios_por_cantidad_validos('[{"desde":10.5,"precio":220}]') or
     public.precios_por_cantidad_validos('[{"desde":10,"precio":220.001}]') or
     public.precios_por_cantidad_validos('[{"desde":10,"precio":220,"extra":1}]')
  then raise exception 'VALIDACION_INVALIDA'; end if;
end $$;
set local request.jwt.claims = '{"sub":"560d496c-dcdd-49d9-85be-fcc7e25f583e","role":"authenticated"}';
set local request.headers = '{"x-negocio-activo":"9e63a7e6-a692-4312-9105-6205aef00300"}';
set local role authenticated;
do $$ declare v_id uuid; v_rows int; begin
  if not public.tiene_permiso('stock.editar_producto') then raise exception 'ADMIN_SIN_PERMISO'; end if;
  select id into v_id from public.productos order by id limit 1;
  if v_id is null then raise exception 'DEMO_SIN_PRODUCTOS'; end if;
  update public.productos set precios_por_cantidad='[{"desde":10,"precio":220},{"desde":50,"precio":200},{"desde":100,"precio":180}]' where id=v_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'ADMIN_NO_GUARDO'; end if;
  update public.productos set precios_por_cantidad='[]' where negocio_id <> '9e63a7e6-a692-4312-9105-6205aef00300';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FUGA_TENANT'; end if;
end $$;
reset role;
-- Retirar el permiso del rol de prueba sólo ADENTRO de esta transacción revertida.
delete from public.rol_permisos rp using public.permisos p, public.usuarios_negocios un
where rp.permiso_id=p.id and p.clave='stock.editar_producto' and rp.rol_id=un.rol_id
and un.usuario_id='5029846a-ddae-4530-829a-cc9f843f3447'
and un.negocio_id='9e63a7e6-a692-4312-9105-6205aef00300';
set local request.jwt.claims = '{"sub":"5029846a-ddae-4530-829a-cc9f843f3447","role":"authenticated"}';
set local role authenticated;
do $$ declare v_id uuid; begin
  if public.tiene_permiso('stock.editar_producto') then raise exception 'VENDEDOR_CON_PERMISO'; end if;
  select id into v_id from public.productos order by id limit 1;
  begin
    update public.productos set precios_por_cantidad='[{"desde":10,"precio":150}]' where id=v_id;
    raise exception 'VENDEDOR_PUDO_GUARDAR';
  exception when insufficient_privilege then
    if sqlerrm <> 'SIN_PERMISO_PRECIOS_POR_CANTIDAD' then raise; end if;
  end;
end $$;
reset role;
set local request.jwt.claims='{}';
set local request.headers='{"x-negocio-slug":"kiosco-demo"}';
set local role anon;
do $$ declare n int; begin
  select count(precios_por_cantidad) into n from public.productos;
  if n = 0 then raise exception 'ANON_SIN_CATALOGO'; end if;
  begin
    perform precio_costo from public.productos;
    raise exception 'COSTO_PUBLICO';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Migración y permisos verificados; transacción revertida' as resultado;
